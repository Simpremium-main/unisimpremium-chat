import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConversationStatus, MessageDirection } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { KvStore } from '../../../runtime/kv-store';
import { SendFlowMessagesTool } from '../tools/builtin/send-flow-messages.tool';
import { PlaybooksService } from '../playbooks/playbooks.service';
import { SimpremiumToolsService } from '../tools/simpremium/simpremium-tools.service';
import {
  CLOSE_FLOW_SLUG,
  DEFAULT_CLOSE_MESSAGES,
  QUOTE_HANDOFF_KEY,
  QuoteHandoff,
  DEFAULT_FOLLOWUP_MESSAGES,
  FOLLOWUP_FLOW_SLUG,
  FollowupMessage,
  FollowupState,
  QUOTE_FOLLOWUP_LIMITS,
  QuoteFollowupSettings,
  decideFollowup,
  isQuoteText,
  quoteFollowupSettings,
} from './quote-followup';

export const QUOTE_FOLLOWUP_QUEUE = 'quote-followup';
const QUOTE_FOLLOWUP_JOB = 'scan-quotes';
const sentKey = (quoteId: string) => `quote-followup:${quoteId}`;
const closeKey = (quoteId: string) => `quote-followup-close:${quoteId}`;

/**
 * A cada 10 min: conversas com cotação da IA sem retorno (ou com "vou
 * verificar") recebem a cobrança (padrão 2h); depois dela, sem resposta (padrão
 * 12h), a mensagem de encerramento e o atendimento é encerrado. Padrão das
 * 10:00 às 17:59; prazos e horário configuráveis por organização.
 */
@Processor(QUOTE_FOLLOWUP_QUEUE, { concurrency: 1 })
export class QuoteFollowupCron extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(QuoteFollowupCron.name);
  private readonly kv = new KvStore();

  constructor(
    private readonly prisma: PrismaService,
    private readonly flows: SendFlowMessagesTool,
    private readonly playbooks: PlaybooksService,
    private readonly simpremium: SimpremiumToolsService,
    @InjectQueue(QUOTE_FOLLOWUP_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue
      .add(
        QUOTE_FOLLOWUP_JOB,
        {},
        { repeat: { pattern: '*/10 * * * *' }, jobId: 'quote-followup-cron', removeOnComplete: 10, removeOnFail: 10 },
      )
      .catch((err) => this.logger.error(`Falha registrando a cobrança de cotação: ${(err as Error).message}`));
  }

  async process(_job: Job): Promise<{ scanned: number; sent: number }> {
    const now = new Date();
    // Última mensagem entre o menor prazo possível e o maior + uma noite
    // (cobre "de madrugada → na abertura do dia seguinte"); o prazo de cada
    // organização é conferido em decideFollowup.
    const minDelay = QUOTE_FOLLOWUP_LIMITS.followupDelayHours.min;
    const maxDelay = Math.max(QUOTE_FOLLOWUP_LIMITS.followupDelayHours.max, QUOTE_FOLLOWUP_LIMITS.closeDelayHours.max) + 28;
    const conversations = await this.prisma.conversation.findMany({
      where: {
        status: { not: ConversationStatus.CLOSED },
        // aiEnabled null = segue a organização (em SQL, `<> false` deixaria o null de fora).
        OR: [{ aiEnabled: null }, { aiEnabled: true }],
        isGroup: false,
        lastMessageAt: {
          lte: new Date(now.getTime() - minDelay * 3_600_000),
          gte: new Date(now.getTime() - maxDelay * 3_600_000),
        },
      },
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        channelId: true,
        activeAgentId: true,
        metadata: true,
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 500,
    });

    // Prazos e horário de cada organização (Configurações → Cobrança de cotação).
    const orgIds = [...new Set(conversations.map((c) => c.organizationId))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, settings: true } });
    const settingsOf = new Map(orgs.map((o) => [o.id, quoteFollowupSettings(o.settings)]));

    let sent = 0;
    for (const conv of conversations) {
      const cfg = settingsOf.get(conv.organizationId) ?? quoteFollowupSettings(null);
      if (!cfg.enabled) continue;
      try {
        if (await this.followUp(conv, now, cfg)) sent++;
      } catch (err) {
        this.logger.warn(`cobrança de cotação falhou (conv ${conv.id}): ${(err as Error).message}`);
      }
    }
    if (sent) this.logger.log(`quote_followup sent=${sent} scanned=${conversations.length}`);
    return { scanned: conversations.length, sent };
  }

  private async followUp(
    conv: {
      id: string;
      organizationId: string;
      contactId: string;
      channelId: string;
      activeAgentId: string | null;
      metadata: unknown;
    },
    now: Date,
    cfg: QuoteFollowupSettings,
  ): Promise<boolean> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId: conv.id, type: { notIn: ['REACTION', 'SYSTEM'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, direction: true, content: true, metadata: true, createdAt: true },
    });
    const messages: FollowupMessage[] = rows.reverse().map((m) => {
      const c = (m.content ?? {}) as { text?: unknown; caption?: unknown };
      const meta = (m.metadata ?? {}) as { aiAgentId?: unknown; chatbotFlowId?: unknown };
      return {
        id: m.id,
        direction: m.direction === MessageDirection.INBOUND ? 'INBOUND' : 'OUTBOUND',
        text: String(c.text ?? c.caption ?? ''),
        createdAt: m.createdAt,
        aiAgentId: typeof meta.aiAgentId === 'string' ? meta.aiAgentId : null,
        fromChatbot: 'chatbotFlowId' in meta,
      };
    });

    // Cotação do atendente passada para a IA: cobra em nome do agente do canal.
    const handoff = ((conv.metadata ?? {}) as Record<string, unknown>)[QUOTE_HANDOFF_KEY] as QuoteHandoff | undefined;
    const fallbackAgentId = handoff ? (conv.activeAgentId ?? (await this.channelAgentId(conv.channelId))) : null;
    // O que já saiu para cada cotação (cobrança / encerramento), do kv.
    const states = new Map<string, FollowupState>();
    for (const m of messages) {
      if (m.direction !== 'OUTBOUND' || !isQuoteText(m.text)) continue;
      const [sent, closed] = await Promise.all([
        this.kv.get(sentKey(m.id)).catch(() => null),
        this.kv.get(closeKey(m.id)).catch(() => null),
      ]);
      states.set(m.id, { followupAt: sent ? new Date(sent) : null, closedAt: closed ? new Date(closed) : null });
    }
    const decision = decideFollowup(messages, now, (id) => states.get(id) ?? {}, handoff ?? null, fallbackAgentId, cfg);
    if (!decision.send) return false;
    const closing = decision.stage === 'encerramento';
    // Marca antes de enviar: dois ticks ao mesmo tempo não mandam duas vezes.
    const claimed = await this.kv.set((closing ? closeKey : sentKey)(decision.quoteId), now.toISOString(), {
      nx: true,
      ttlMs: 30 * 24 * 3_600_000,
    });
    if (!claimed) return false;

    const slug = closing ? CLOSE_FLOW_SLUG : FOLLOWUP_FLOW_SLUG;
    const flow = await this.playbooks.findBySlug(conv.organizationId, decision.agentId, slug);
    const playbook =
      flow && flow.steps.length
        ? flow
        : ({
            slug,
            steps: (closing ? DEFAULT_CLOSE_MESSAGES : DEFAULT_FOLLOWUP_MESSAGES).map((content) => ({
              type: 'TEXT',
              content,
              caption: null,
            })),
          } as never);
    const ctx = {
      organizationId: conv.organizationId,
      conversationId: conv.id,
      contactId: conv.contactId,
      channelId: conv.channelId,
      agentId: decision.agentId,
      runId: '',
    };
    const res = await this.flows.sendSteps(playbook, ctx);
    const ok = (res.output as { ok?: unknown })?.ok === true;
    if (ok && closing) {
      await this.simpremium.closeConversation(ctx, 'Sem retorno do cliente após a cotação e a cobrança');
    }
    this.logger.log(`quote_followup ${decision.stage} conv=${conv.id} quote=${decision.quoteId} ok=${ok}`);
    return ok;
  }

  /** Agente que atende o canal (o orquestrador, se houver). */
  private async channelAgentId(channelId: string): Promise<string | null> {
    const links = await this.prisma.aiAgentChannel.findMany({
      where: { channelId, mode: 'AUTONOMOUS', agent: { isActive: true, deletedAt: null } },
      select: { agentId: true, agent: { select: { kind: true } } },
    });
    return (links.find((l) => l.agent.kind === 'ORCHESTRATOR') ?? links[0])?.agentId ?? null;
  }
}
