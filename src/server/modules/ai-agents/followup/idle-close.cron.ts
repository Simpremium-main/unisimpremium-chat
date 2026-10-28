import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConversationStatus, MessageDirection } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { KvStore } from '../../../runtime/kv-store';
import { SendFlowMessagesTool } from '../tools/builtin/send-flow-messages.tool';
import { PlaybooksService } from '../playbooks/playbooks.service';
import { SimpremiumToolsService } from '../tools/simpremium/simpremium-tools.service';
import { aiVisibleMessagesWhere } from '../runner/ai-context';
import { FollowupMessage } from './quote-followup';
import {
  DEFAULT_IDLE_CLOSE_MESSAGES,
  IDLE_CLOSE_DELAY_MS,
  IDLE_CLOSE_FLOW_SLUG,
  IDLE_CLOSE_MAX_LATE_MS,
  decideIdleClose,
} from './idle-close';

export const IDLE_CLOSE_QUEUE = 'idle-close';
const IDLE_CLOSE_JOB = 'scan-idle';
const claimKey = (messageId: string) => `idle-close:${messageId}`;

/**
 * A cada minuto: dúvida respondida pela IA, sem pergunta pendente e 5 min
 * sem mensagem do cliente → mensagem de encerramento e atendimento encerrado.
 */
@Processor(IDLE_CLOSE_QUEUE, { concurrency: 1 })
export class IdleCloseCron extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(IdleCloseCron.name);
  private readonly kv = new KvStore();

  constructor(
    private readonly prisma: PrismaService,
    private readonly flows: SendFlowMessagesTool,
    private readonly playbooks: PlaybooksService,
    private readonly simpremium: SimpremiumToolsService,
    @InjectQueue(IDLE_CLOSE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue
      .add(
        IDLE_CLOSE_JOB,
        {},
        { repeat: { pattern: '* * * * *' }, jobId: 'idle-close-cron', removeOnComplete: 10, removeOnFail: 10 },
      )
      .catch((err) => this.logger.error(`Falha registrando o encerramento de dúvidas: ${(err as Error).message}`));
  }

  async process(_job: Job): Promise<{ scanned: number; closed: number }> {
    const now = new Date();
    const conversations = await this.prisma.conversation.findMany({
      where: {
        status: { not: ConversationStatus.CLOSED },
        OR: [{ aiEnabled: null }, { aiEnabled: true }],
        isGroup: false,
        assignedToId: null,
        lastMessageAt: {
          lte: new Date(now.getTime() - IDLE_CLOSE_DELAY_MS),
          gte: new Date(now.getTime() - IDLE_CLOSE_DELAY_MS - IDLE_CLOSE_MAX_LATE_MS),
        },
      },
      select: { id: true, organizationId: true, contactId: true, channelId: true, metadata: true },
      take: 300,
    });

    let closed = 0;
    for (const conv of conversations) {
      try {
        if (await this.closeIfIdle(conv, now)) closed++;
      } catch (err) {
        this.logger.warn(`encerramento de dúvida falhou (conv ${conv.id}): ${(err as Error).message}`);
      }
    }
    if (closed) this.logger.log(`idle_close closed=${closed} scanned=${conversations.length}`);
    return { scanned: conversations.length, closed };
  }

  private async closeIfIdle(
    conv: { id: string; organizationId: string; contactId: string; channelId: string; metadata: unknown },
    now: Date,
  ): Promise<boolean> {
    const rows = await this.prisma.message.findMany({
      where: { ...aiVisibleMessagesWhere(conv.id, conv.metadata), type: { notIn: ['REACTION', 'SYSTEM'] } },
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
    const decision = decideIdleClose(messages, now);
    if (!decision.close) return false;
    // Marca antes de enviar: dois ticks ao mesmo tempo não mandam duas vezes.
    const claimed = await this.kv.set(claimKey(decision.lastMessageId), now.toISOString(), {
      nx: true,
      ttlMs: 24 * 3_600_000,
    });
    if (!claimed) return false;

    const ctx = {
      organizationId: conv.organizationId,
      conversationId: conv.id,
      contactId: conv.contactId,
      channelId: conv.channelId,
      agentId: decision.agentId,
      runId: '',
    };
    if (decision.sendMessage) {
      const flow = await this.playbooks.findBySlug(conv.organizationId, decision.agentId, IDLE_CLOSE_FLOW_SLUG);
      const playbook =
        flow && flow.steps.length
          ? flow
          : ({
              slug: IDLE_CLOSE_FLOW_SLUG,
              steps: DEFAULT_IDLE_CLOSE_MESSAGES.map((content) => ({ type: 'TEXT', content, caption: null })),
            } as never);
      const res = await this.flows.sendSteps(playbook, ctx);
      if ((res.output as { ok?: unknown })?.ok !== true) return false;
    }
    await this.simpremium.closeConversation(ctx, 'Dúvida respondida, sem nova mensagem do cliente em 5 minutos');
    this.logger.log(`idle_close conv=${conv.id} after=${decision.lastMessageId} message=${decision.sendMessage}`);
    return true;
  }
}
