import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Conversation, ConversationStatus, Prisma } from '@prisma/client';
import { KvStore } from '../../../runtime/kv-store';
import {
  ChatbotCompletion,
  chatbotSessionKey,
} from '../../chatbot/session/chatbot-session.keys';
import { ConversationsRepository, InboxFilters } from './conversations.repository';
import { ConversationFsmService } from './conversation-fsm.service';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { PrismaService } from '../../../database/prisma.service';
import { ChannelAdapterRegistry } from '../../channel-hub/channel-adapter.registry';
import { HistoryImportService } from '../pipeline/history-import.service';
import {
  ChannelAccess,
  ChannelAccessService,
} from '../../iam/channel-access/channel-access.service';
import { AgentRouterService } from '../../ai-agents/router/agent-router.service';
import { AiAgentRunnerService } from '../../ai-agents/runner/agent-runner.service';
import { SegmentReadService } from '../../segments/segment-read.service';
import { ProjectsService } from '../../projects/projects.service';
import { deriveGroupJid } from '../../segments/group-jid.util';
import { trackBackground } from '../../../runtime/background';
import { AI_CONTEXT_RESET_KEY } from '../../ai-agents/runner/ai-context';
import { QUOTE_HANDOFF_KEY, isQuoteText } from '../../ai-agents/followup/quote-followup';

const SYNC_MESSAGE_PAGE_SIZE = 50;
const SYNC_MAX_PAGES = 4;

/** Filtros da lista do inbox (tela geral e inboxes salvas). */
export interface InboxQueryFilters {
  status?: string;
  channelId?: string;
  channelIds?: string[];
  conversationIds?: string[];
  kind?: 'INDIVIDUAL' | 'GROUP';
  tagIds?: string[];
  assignedToId?: string;
  search?: string;
  archived?: 'exclude' | 'only' | 'any';
  unreadOnly?: boolean;
  /** Última mensagem é do cliente (inbox "Não respondidas"). */
  unansweredOnly?: boolean;
  stuckOnly?: boolean;
  segmentId?: string;
  hoppeId?: string;
  responsibleUserId?: string;
  projectStatus?: string;
  /** Só conversas em que a IA está ativa (inbox "IA Ativo"). */
  aiActive?: boolean;
  /** Transferidas da IA/robô pra humano, ainda sem resposta de atendente. */
  aiToHuman?: boolean;
  /** IA pediu ajuda e o caso espera orientação do admin (Jarvis → Aprendizado). */
  aiWaiting?: boolean;
  /** Esconde conversas em que a IA está ativa (inbox "Não respondidas"). */
  excludeAiActive?: boolean;
  /** Esconde as transferidas pra humano (inbox "IA Ativo"). */
  excludeAiToHuman?: boolean;
  /** Esconde as que esperam o admin (inboxes "IA Ativo" e "IA para Humano"). */
  excludeAiWaiting?: boolean;
  /** Esconde as que estão em "Não respondidas" (inbox "Aberto"). */
  excludeUnanswered?: boolean;
}

/** Resultados caros compartilhados entre contagens de uma mesma request. */
export type InboxMemo = Map<string, Promise<unknown>>;

@Injectable()
export class ConversationsService {
  private readonly kv = new KvStore();
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly repository: ConversationsRepository,
    private readonly fsm: ConversationFsmService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: ChannelAdapterRegistry,
    private readonly historyImporter: HistoryImportService,
    private readonly channelAccess: ChannelAccessService,
    private readonly agentRouter: AgentRouterService,
    private readonly agentRunner: AiAgentRunnerService,
    private readonly segmentRead: SegmentReadService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Anexa o `project` (resumo) às conversas de grupo — uma consulta em lote por
   * JID. Mutação in-place (mesma referência) para reusar nos vários retornos.
   */
  private async attachProjects<
    T extends {
      organizationId: string;
      isGroup: boolean;
      channelId: string;
      contact?: { channels?: { channelId: string; externalId: string }[] } | null;
    },
  >(organizationId: string, conversations: T[]): Promise<T[]> {
    const jidByConv = new Map<T, string>();
    for (const c of conversations) {
      if (!c.isGroup) continue;
      const jid = deriveGroupJid(c);
      if (jid) jidByConv.set(c, jid);
    }
    if (jidByConv.size === 0) return conversations;
    const map = await this.projects.attachByJids(
      organizationId,
      Array.from(new Set(jidByConv.values())),
    );
    for (const [conv, jid] of jidByConv) {
      (conv as Record<string, unknown>).project = map.get(jid) ?? null;
    }
    return conversations;
  }

  private broadcastUpdate(conversation: Conversation | null): void {
    if (!conversation) return;
    this.realtimeGateway.emitToChannel(
      conversation.channelId,
      'conversation:updated',
      { conversation },
    );
    this.realtimeGateway.emitToConversation(
      conversation.id,
      'conversation:updated',
      { conversation },
    );
  }

  async findInbox(
    organizationId: string,
    filters: InboxQueryFilters,
    page: number,
    limit: number,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
  ) {
    const inboxFilters = await this.resolveInboxFilters(organizationId, filters, access);
    if (!inboxFilters) {
      return { conversations: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }

    const skip = (page - 1) * limit;
    const { conversations, total } = await this.repository.findInbox(
      inboxFilters,
      skip,
      limit,
      currentUserId,
    );

    await this.attachProjects(organizationId, conversations as any[]);

    // Bolinha "IA" na lista: a IA responderia nesta conversa agora?
    const aiActive = await this.agentRouter.aiActiveMap(conversations as any[]);
    for (const conv of conversations as any[]) conv.aiActive = aiActive.get(conv.id) ?? false;

    return {
      conversations,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Só o total de conversas (bolinhas do menu). `memo` compartilha entre
   * várias contagens da mesma request os conjuntos caros (IA ativa, IA para
   * humano, IA aguardando) em vez de recalcular um por inbox.
   */
  async countInbox(
    organizationId: string,
    filters: InboxQueryFilters,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    memo?: InboxMemo,
  ): Promise<number> {
    const inboxFilters = await this.resolveInboxFilters(organizationId, filters, access, memo);
    return inboxFilters ? this.repository.countInbox(inboxFilters, currentUserId) : 0;
  }

  /** Filtros da tela → filtros do repositório; null quando o resultado é vazio. */
  private async resolveInboxFilters(
    organizationId: string,
    filters: InboxQueryFilters,
    access: ChannelAccess,
    memo?: InboxMemo,
  ): Promise<InboxFilters | null> {
    const once = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (!memo) return fn();
      if (!memo.has(key)) memo.set(key, fn());
      return memo.get(key) as Promise<T>;
    };
    const validStatuses = new Set(Object.values(ConversationStatus));
    const parsedStatuses = filters.status
      ?.split(',')
      .map((s) => s.trim() as ConversationStatus)
      .filter((s) => validStatuses.has(s));

    // Filtros que unificam por grupo POR LEITURA (Segmento ou Projeto): pegam
    // uma conversa representante por grupo (JID) e listam só essas — uma linha
    // por grupo, sem duplicar. Resolvem para conversationIds + channelIds; o
    // channelIds dá ao planner o índice (org,channel) e evita varrer o índice
    // de last_message_at (query O(segundos)).
    let conversationIds = filters.conversationIds;
    let resolvedChannelIds: string[] | undefined;
    let isGroupResolved = false;
    const projectFilter =
      filters.hoppeId || filters.responsibleUserId || filters.projectStatus
        ? {
            hoppeId: filters.hoppeId,
            responsibleUserId: filters.responsibleUserId,
            status: filters.projectStatus,
          }
        : null;

    if (filters.segmentId || projectFilter) {
      const { representativeIds, memberChannelIds } = filters.segmentId
        ? await this.segmentRead.groupRepresentativeIds(
            organizationId,
            filters.segmentId,
          )
        : await this.projects.resolveFilter(organizationId, projectFilter!);
      conversationIds = filters.conversationIds
        ? representativeIds.filter((id) => filters.conversationIds!.includes(id))
        : representativeIds;
      resolvedChannelIds = memberChannelIds;
      isGroupResolved = true;
      if (conversationIds.length === 0) return null;
    }

    const aiToHumanIds = () => once('aiToHuman', () => this.aiToHumanIds(organizationId));
    const aiWaitingIds = () => once('aiWaiting', () => this.aiWaitingIds(organizationId));
    const parts: Prisma.ConversationWhereInput[] = [];
    if (filters.aiActive) {
      const aiActiveWhere = await once('aiActiveWhere', () => this.agentRouter.aiActiveWhere(organizationId));
      if (!aiActiveWhere) return null;
      parts.push(aiActiveWhere);
    }
    if (filters.aiToHuman) {
      const ids = await aiToHumanIds();
      if (ids.length === 0) return null;
      parts.push({ id: { in: ids } });
    }
    if (filters.aiWaiting) {
      const ids = await aiWaitingIds();
      if (ids.length === 0) return null;
      parts.push({ id: { in: ids } });
    }
    // Uma conversa da IA fica numa inbox só: Aguardando > para Humano > Ativo.
    if (filters.excludeAiToHuman) {
      const ids = await aiToHumanIds();
      if (ids.length) parts.push({ id: { notIn: ids } });
    }
    if (filters.excludeAiWaiting) {
      // Sem a tabela de casos (SQL não aplicado) não há o que esconder.
      const ids = await aiWaitingIds().catch(() => []);
      if (ids.length) parts.push({ id: { notIn: ids } });
    }
    if (filters.excludeAiActive) {
      // Esconde exatamente as conversas que "IA Ativo" mostra. NOT(regra) no
      // SQL falha com campos nulos (ai_enabled/active_agent_id NULL → NULL,
      // nem verdadeiro nem falso) e a conversa sumia das duas inboxes.
      const ids = await once('aiActiveIds', () => this.aiActiveIds(organizationId));
      if (ids.length) parts.push({ id: { notIn: ids } });
    }
    if (filters.excludeUnanswered) {
      const ids = await once('unanswered', () => this.repository.unansweredIds(organizationId));
      if (ids.length) parts.push({ id: { notIn: ids } });
    }
    const extraWhere = parts.length > 1 ? { AND: parts } : parts[0];

    return {
      organizationId,
      status: parsedStatuses?.length ? parsedStatuses : undefined,
      // Em filtro de grupo (segmento/projeto) o canal vira o conjunto de
      // canais resolvidos (necessário pro plano da query); senão, o do usuário.
      channelId: isGroupResolved ? undefined : filters.channelId,
      channelIds: isGroupResolved ? resolvedChannelIds : filters.channelIds,
      conversationIds,
      kind: isGroupResolved ? 'GROUP' : filters.kind,
      tagIds: filters.tagIds,
      assignedToId: filters.assignedToId,
      search: filters.search,
      accessibleChannelIds: access === 'ALL' ? undefined : [...access],
      archived: filters.archived,
      unreadOnly: filters.unreadOnly,
      unansweredOnly: filters.unansweredOnly,
      stuckOnly: filters.stuckOnly,
      extraWhere: extraWhere ?? undefined,
    };
  }

  /** Conversas abertas em que a IA está ativa agora (mesma regra da inbox "IA Ativo"). */
  async aiActiveIds(organizationId: string): Promise<string[]> {
    const w = await this.agentRouter.aiActiveWhere(organizationId);
    if (!w) return [];
    const rows = await this.prisma.conversation.findMany({
      where: { organizationId, deletedAt: null, status: { not: ConversationStatus.CLOSED }, ...w },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Conversas com caso aberto em Jarvis → Aprendizado (IA esperando o admin). */
  async aiWaitingIds(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.aiHelpRequest.findMany({
      where: { organizationId, status: 'PENDING' },
      select: { conversationId: true },
      distinct: ['conversationId'],
    });
    return rows.map((r) => r.conversationId);
  }

  /**
   * Conversas abertas que a IA (último run = transferiu) ou o robô (fluxo
   * terminou indo pro atendente) passaram pra humano e em que nenhum
   * atendente mandou mensagem depois da transferência.
   */
  async aiToHumanIds(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH open_conv AS (
        SELECT id, metadata FROM conversations
         WHERE organization_id = ${organizationId} AND status <> 'CLOSED' AND deleted_at IS NULL
      ),
      last_run AS (
        SELECT DISTINCT ON (r.conversation_id)
               r.conversation_id, r.final_action, COALESCE(r.finished_at, r.started_at) AS at
          FROM ai_agent_runs r
          JOIN open_conv c ON c.id = r.conversation_id
         ORDER BY r.conversation_id, r.started_at DESC
      ),
      handoff AS (
        SELECT conversation_id, at FROM last_run WHERE final_action = 'TRANSFERRED_TO_HUMAN'
        UNION ALL
        SELECT id, ((metadata->'chatbot'->>'completedAt')::timestamptz AT TIME ZONE 'UTC')
          FROM open_conv
         WHERE metadata->'chatbot'->>'handoff' = 'HUMAN' AND metadata->'chatbot'->>'reason' = 'flow'
      )
      SELECT DISTINCT h.conversation_id AS id
        FROM handoff h
        JOIN open_conv oc ON oc.id = h.conversation_id
       -- Transferência antes do "Limpar contexto"/"Reiniciar" não conta mais.
       WHERE (oc.metadata->>'aiContextResetAt' IS NULL
              OR h.at > ((oc.metadata->>'aiContextResetAt')::timestamptz AT TIME ZONE 'UTC'))
         AND NOT EXISTS (
         SELECT 1 FROM messages m
          WHERE m.conversation_id = h.conversation_id
            AND m.direction = 'OUTBOUND'
            AND m.sender_id IS NOT NULL
            AND m.created_at > h.at
       )`;
    return rows.map((r) => r.id);
  }

  async findOne(id: string, organizationId: string, access: ChannelAccess = 'ALL') {
    const conversation = await this.repository.findById(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    this.channelAccess.assertChannelAccess(access, conversation.channelId);
    await this.attachProjects(organizationId, [conversation as any]);
    return conversation;
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateConversationDto,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ) {
    const conversation = await this.findOne(id, organizationId, access);

    if (dto.assignedToId) {
      await this.fsm.assign(id, dto.assignedToId, actorId);
    }

    if (dto.status && dto.status !== conversation.status) {
      await this.fsm.transition(id, dto.status, actorId);
    }

    if (dto.departmentId) {
      await this.repository.update(id, { department: { connect: { id: dto.departmentId } } });
    }

    if (dto.subject !== undefined) {
      const trimmed = dto.subject.trim();
      await this.repository.update(id, {
        subject: trimmed.length > 0 ? trimmed : null,
      });
    }

    const updated = await this.repository.findById(id);
    this.broadcastUpdate(updated as Conversation | null);
    return updated;
  }

  async toggleAi(
    id: string,
    organizationId: string,
    enabled: boolean | null,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ) {
    await this.findOne(id, organizationId, access);

    // Tri-state:
    //   null  = limpa override, conversa volta a seguir regras globais
    //   true  = força ON (sobrepõe kill switch e horário)
    //   false = força OFF
    const updated = await this.prisma.conversation.update({
      where: { id },
      data:
        enabled === null
          ? {
              aiEnabled: null,
              aiDisabledBy: null,
              aiDisabledAt: null,
            }
          : enabled === true
            ? {
                aiEnabled: true,
                aiDisabledBy: null,
                aiDisabledAt: null,
              }
            : {
                aiEnabled: false,
                aiDisabledBy: actorId,
                aiDisabledAt: new Date(),
                activeAgentId: null,
              },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action:
          enabled === null
            ? 'AI_OVERRIDE_CLEARED'
            : enabled
              ? 'AI_FORCED_ON'
              : 'AI_FORCED_OFF',
        metadata: {},
      },
    });
    this.realtimeGateway.emitToConversation(id, 'conversation:ai-toggle', {
      conversationId: id,
      aiEnabled: enabled,
      actorId,
    });
    return updated;
  }

  /**
   * Manually trigger the AI agent to engage with this conversation right now.
   * Reads the latest inbound (or any latest message if no inbound) as the
   * trigger, calls the runner, and returns whatever final action the agent
   * decided. Skipped silently if the router rejects (paused, no agent, etc).
   */
  async engageAi(
    id: string,
    organizationId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ): Promise<{ engaged: boolean; reason?: string }> {
    const conversation = await this.findOne(id, organizationId, access);

    // "Engajar IA" é pedido explícito: tira o robô (se estiver no fluxo).
    if (await this.kv.del(chatbotSessionKey(id))) {
      await this.prisma.conversation.update({
        where: { id },
        data: {
          metadata: {
            ...((conversation.metadata as Record<string, unknown>) ?? {}),
            chatbot: {
              flowId: null,
              completedAt: new Date().toISOString(),
              handoff: 'AI',
              reason: 'engaged-ai',
            } satisfies ChatbotCompletion,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const decision = await this.agentRouter.shouldHandle(
      conversation as Conversation,
    );
    if (!decision.handle) {
      this.logger.log(
        `engageAi skipped for conv ${id}: ${decision.reason} (actor=${actorId})`,
      );
      return { engaged: false, reason: decision.reason };
    }

    // Pick the most recent inbound as the trigger so the agent has something
    // concrete to react to. Fall back to the latest message of any direction
    // (covers the case where the conversation was opened by the human).
    const triggerMessage =
      (await this.prisma.message.findFirst({
        where: { conversationId: id, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await this.prisma.message.findFirst({
        where: { conversationId: id },
        orderBy: { createdAt: 'desc' },
      }));

    if (!triggerMessage) {
      return { engaged: false, reason: 'no-messages' };
    }

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action: 'AI_ENGAGED_MANUALLY',
        metadata: { triggerMessageId: triggerMessage.id },
      },
    });

    // Runner is async — kick it off in the background. The response payload
    // (new outbound message) will arrive via realtime + the run record will
    // appear in /ai-agents stats. Frontend can refetch right after the call.
    trackBackground(this.agentRunner
      .run({ conversation: conversation as Conversation, triggerMessage, manual: true })
      .catch((err) =>
        this.logger.error(
          `engageAi run failed for conv ${id}: ${err?.message ?? err}`,
        ),
      ));

    return { engaged: true };
  }

  /**
   * Manually pin a specific AI agent to this conversation and immediately
   * engage it. Use case: human says "vou te passar pra Lívia" via manual
   * message — the system can't infer that intent from text, so the operator
   * picks the agent in the UI and we (a) flip activeAgentId, (b) clear any
   * paused state (force AI on for this conversation), (c) fire the runner.
   */
  /**
   * Limpa o contexto da IA nesta conversa: a partir de agora ela só lê as
   * mensagens novas (o histórico continua visível para a equipe), esquece o
   * que aprendeu sobre o contato e o agente ativo é escolhido de novo.
   */
  async resetAiContext(
    id: string,
    organizationId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ): Promise<{ ok: true; resetAt: string; memoriesCleared: number }> {
    const conversation = await this.findOne(id, organizationId, access);
    const resetAt = new Date();
    const metadata = {
      ...((conversation.metadata as Record<string, unknown> | null) ?? {}),
      [AI_CONTEXT_RESET_KEY]: resetAt.toISOString(),
    };

    const [updated, memories] = await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id },
        data: { metadata: metadata as Prisma.InputJsonValue, activeAgentId: null },
      }),
      this.prisma.aiAgentMemory.deleteMany({ where: { contactId: conversation.contactId } }),
      this.prisma.conversationAuditLog.create({
        data: {
          conversationId: id,
          actorId,
          action: 'AI_CONTEXT_RESET',
          fromValue: conversation.activeAgentId,
          toValue: null,
          metadata: { resetAt: resetAt.toISOString() },
        },
      }),
    ]);

    // Busca na memória (RAG): a tabela só existe onde o pgvector foi ligado.
    const [{ exists }] = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('ai_vector_entries') IS NOT NULL AS exists`;
    if (exists) {
      await this.prisma.$executeRaw`
        DELETE FROM ai_vector_entries WHERE conversation_id = ${id} OR contact_id = ${conversation.contactId}`;
    }

    // Estado guardado pelas ferramentas da IA nesta conversa: pedidos já
    // confirmados (order-ok) e fretes calculados (frete:<conv>:<cep>).
    const freteKeys = await this.kv.keysWithPrefix(`frete:${id}:`).catch(() => [] as string[]);
    await this.kv.del(`order-ok:${id}`, ...freteKeys).catch(() => 0);

    this.broadcastUpdate(updated as Conversation);
    this.realtimeGateway.emitToConversation(id, 'conversation:ai-context-reset', {
      conversationId: id,
      resetAt: resetAt.toISOString(),
    });
    return { ok: true, resetAt: resetAt.toISOString(), memoriesCleared: memories.count };
  }

  /**
   * Reiniciar (teste, só admin): tudo do "Limpar contexto" + a conversa volta
   * ao estado de nova para a IA — IA no padrão, robô pode recomeçar, casos
   * abertos em Aprendizado descartados e transferência anterior esquecida.
   */
  /** "Sugerir resposta": a mensagem que a IA mandaria agora (não envia nada). */
  async draftAiReply(
    id: string,
    organizationId: string,
    body: { extraInfo?: string; useHistory?: boolean },
    access: ChannelAccess = 'ALL',
  ) {
    await this.findOne(id, organizationId, access);
    try {
      return await this.agentRunner.draftReply(id, {
        extraInfo: typeof body.extraInfo === 'string' ? body.extraInfo.slice(0, 2000) : undefined,
        useHistory: body.useHistory !== false,
      });
    } catch (err) {
      throw new BadRequestException((err as Error)?.message ?? 'Erro ao sugerir a resposta');
    }
  }

  /**
   * "Tirar do Não respondidas": a conversa sai da inbox sem resposta ao
   * cliente e volta sozinha quando ele mandar mensagem nova.
   */
  async dismissUnanswered(id: string, organizationId: string, actorId: string, access: ChannelAccess = 'ALL') {
    const conversation = await this.findOne(id, organizationId, access);
    const at = new Date().toISOString();
    await this.prisma.conversation.update({
      where: { id },
      data: {
        metadata: {
          ...((conversation.metadata as Record<string, unknown>) ?? {}),
          unansweredDismissedAt: at,
        } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.conversationAuditLog.create({
      data: { conversationId: id, actorId, action: 'UNANSWERED_DISMISSED', metadata: {} },
    });
    return { ok: true, unansweredDismissedAt: at };
  }

  /**
   * Atendente mandou a cotação e devolve a conversa para a IA: ela cobra o
   * retorno em 2h (como nas cotações dela) e continua quando o cliente
   * responder. Não roda a IA agora — não há mensagem nova do cliente.
   */
  async handoffQuoteToAi(id: string, organizationId: string, actorId: string, access: ChannelAccess = 'ALL') {
    const conversation = await this.findOne(id, organizationId, access);
    const recent = await this.prisma.message.findMany({
      where: { conversationId: id, direction: 'OUTBOUND', type: { notIn: ['REACTION', 'SYSTEM'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, content: true },
    });
    const quote = recent.find((m) => isQuoteText(String((m.content as { text?: unknown } | null)?.text ?? '')));
    if (!quote) throw new BadRequestException('Nenhuma cotação enviada nesta conversa');

    const at = new Date().toISOString();
    await this.prisma.conversation.update({
      where: { id },
      data: {
        aiEnabled: null,
        aiDisabledBy: null,
        aiDisabledAt: null,
        metadata: {
          ...((conversation.metadata as Record<string, unknown>) ?? {}),
          [QUOTE_HANDOFF_KEY]: { messageId: quote.id, at, by: actorId },
        } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.conversationAuditLog.create({
      data: { conversationId: id, actorId, action: 'AI_QUOTE_HANDOFF', metadata: { messageId: quote.id } },
    });
    this.realtimeGateway.emitToConversation(id, 'conversation:ai-toggle', { conversationId: id, aiEnabled: null, actorId });
    return { ok: true, quoteMessageId: quote.id, at };
  }

  async restartAi(id: string, organizationId: string, actorId: string, access: ChannelAccess = 'ALL') {
    const result = await this.resetAiContext(id, organizationId, actorId, access);
    const conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { id } });
    const { chatbot: _chatbot, ...metadata } = (conversation.metadata as Record<string, unknown> | null) ?? {};
    const [updated] = await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id },
        data: { aiEnabled: null, metadata: metadata as Prisma.InputJsonValue },
      }),
      this.prisma.aiHelpRequest.updateMany({
        where: { conversationId: id, status: 'PENDING' },
        data: { status: 'DISMISSED', resolvedById: actorId, resolvedAt: new Date() },
      }),
    ]);
    await this.kv.del(chatbotSessionKey(id)).catch(() => 0);
    this.broadcastUpdate(updated as Conversation);
    return result;
  }

  async setActiveAgent(
    id: string,
    organizationId: string,
    agentId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ): Promise<{ engaged: boolean; reason?: string; agentName?: string }> {
    const conversation = await this.findOne(id, organizationId, access);

    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, organizationId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found or not active in this org');
    }

    // Pin agent + force AI on for this conversation (override any pause).
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: {
        activeAgentId: agentId,
        aiEnabled: true,
        aiDisabledBy: null,
        aiDisabledAt: null,
      },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action: 'AI_AGENT_SET',
        fromValue: conversation.activeAgentId,
        toValue: agentId,
        metadata: { agentName: agent.name },
      },
    });

    this.broadcastUpdate(updated as Conversation);
    this.realtimeGateway.emitToConversation(id, 'conversation:ai-toggle', {
      conversationId: id,
      aiEnabled: true,
      activeAgentId: agentId,
      reason: 'agent-pinned',
    });

    // Pick latest inbound (preferred) or fallback to any latest message.
    const triggerMessage =
      (await this.prisma.message.findFirst({
        where: { conversationId: id, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await this.prisma.message.findFirst({
        where: { conversationId: id },
        orderBy: { createdAt: 'desc' },
      }));

    if (!triggerMessage) {
      return {
        engaged: false,
        reason: 'no-messages',
        agentName: agent.name,
      };
    }

    trackBackground(this.agentRunner
      .run({
        conversation: updated as Conversation,
        triggerMessage,
        manual: true,
      })
      .catch((err) =>
        this.logger.error(
          `setActiveAgent run failed for conv ${id}: ${err?.message ?? err}`,
        ),
      ));

    return { engaged: true, agentName: agent.name };
  }

  async close(
    id: string,
    organizationId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ) {
    const current = await this.findOne(id, organizationId, access);
    // Já encerrada (ex.: outra pessoa fechou, ou ação em lote repetida): ok.
    if (current.status === ConversationStatus.CLOSED) return current;
    await this.fsm.transition(id, ConversationStatus.CLOSED, actorId);
    const updated = await this.repository.findById(id);
    this.broadcastUpdate(updated as Conversation | null);
    return updated;
  }

  async reopen(
    id: string,
    organizationId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ) {
    const conversation = await this.findOne(id, organizationId, access);
    const target = conversation.assignedToId
      ? ConversationStatus.OPEN
      : ConversationStatus.PENDING;
    await this.fsm.transition(id, target, actorId);
    const updated = await this.repository.findById(id);
    this.broadcastUpdate(updated as Conversation | null);
    return updated;
  }

  /**
   * Hard delete — apaga a conversa de verdade. Cascade nas FKs (messages,
   * tags, audit logs, AI runs, reads, internal notes, rating, cards) cuida
   * dos dependentes. Operação irreversível: exige confirmação digitando o
   * nome ou telefone exato do contato.
   */
  async hardDelete(
    id: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
    confirm?: string,
  ) {
    const conversation = await this.findOne(id, organizationId, access);
    const expectedName = (conversation as any).contact?.name?.trim();
    const expectedPhone = (conversation as any).contact?.phone?.trim();
    const provided = (confirm ?? '').trim();
    if (!provided) {
      throw new BadRequestException(
        'Confirmação obrigatória: passe ?confirm=<nome ou telefone exato do contato>.',
      );
    }
    if (provided !== expectedName && provided !== expectedPhone) {
      throw new BadRequestException(
        'Confirmação não confere com o nome ou telefone do contato — apagamento abortado.',
      );
    }

    // FKs estão com onDelete: Cascade nos relacionados (messages,
    // conversation_tags, ai_agent_runs, conversation_reads, etc.) então
    // basta apagar a conversa que o resto cai junto.
    await this.prisma.conversation.delete({ where: { id } });

    this.realtimeGateway.emitToChannel(
      conversation.channelId,
      'conversation:deleted',
      { conversationId: id },
    );
    return { ok: true, id };
  }

  async setArchived(
    id: string,
    organizationId: string,
    archived: boolean,
    actorId: string,
    access: ChannelAccess = 'ALL',
  ) {
    await this.findOne(id, organizationId, access);
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: archived
        ? { isArchived: true, archivedAt: new Date(), archivedById: actorId }
        : { isArchived: false, archivedAt: null, archivedById: null },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: id,
        actorId,
        action: archived ? 'CONVERSATION_ARCHIVED' : 'CONVERSATION_UNARCHIVED',
        metadata: {},
      },
    });

    this.broadcastUpdate(updated as Conversation);
    return updated;
  }

  async assignToMe(
    id: string,
    organizationId: string,
    userId: string,
    access: ChannelAccess = 'ALL',
  ) {
    await this.findOne(id, organizationId, access);
    await this.fsm.assign(id, userId, userId);
    const updated = await this.repository.findById(id);
    this.broadcastUpdate(updated as Conversation | null);
    return updated;
  }

  async getStatusCounts(organizationId: string, access: ChannelAccess = 'ALL') {
    const accessibleIds = access === 'ALL' ? undefined : [...access];
    return this.repository.countByStatus(organizationId, accessibleIds);
  }

  /**
   * Marks a conversation as read for the current user. Upserts the
   * ConversationRead row with lastReadAt = now and emits a realtime
   * `conversation:read` event so any open client (other tab, mobile)
   * zeros the badge in real time.
   */
  async markAsRead(
    conversationId: string,
    organizationId: string,
    userId: string,
    access: ChannelAccess = 'ALL',
    lastReadMessageId?: string,
  ) {
    await this.findOne(conversationId, organizationId, access);
    const read = await this.repository.markAsRead(
      userId,
      conversationId,
      lastReadMessageId,
    );

    this.realtimeGateway.emitToUser(userId, 'conversation:read', {
      conversationId,
      userId,
      lastReadAt: read.lastReadAt,
    });

    // Sync bidirecional: canais que suportam (GMAIL) espelham o "lido"
    // no provider. Fire-and-forget — nunca bloqueia o mark-read local.
    trackBackground(this.syncProviderRead(conversationId).catch((err) =>
      this.logger.warn(
        `Provider read-sync failed for conv ${conversationId}: ${err?.message ?? err}`,
      ),
    ));

    return { ok: true, lastReadAt: read.lastReadAt };
  }

  /**
   * Espelha a leitura no provider quando o adapter do canal expõe
   * `markConversationRead` (hoje só GMAIL — remove o label UNREAD na
   * caixa). Limita às últimas mensagens inbound pra não estourar quota.
   */
  private async syncProviderRead(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { channel: true },
    });
    if (!conversation?.channel) return;

    const adapter = this.adapterRegistry.hasAdapter(conversation.channel.type)
      ? this.adapterRegistry.getOutbound(conversation.channel.type)
      : null;
    if (!adapter || typeof adapter.markConversationRead !== 'function') return;

    const recentInbound = await this.prisma.message.findMany({
      where: {
        conversationId,
        direction: 'INBOUND',
        externalId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { externalId: true },
    });
    const externalIds = recentInbound
      .map((m) => m.externalId)
      .filter((id): id is string => !!id);
    if (externalIds.length === 0) return;

    await adapter.markConversationRead(conversation.channel, externalIds);
  }

  /**
   * Per-user "mark as unread". Pushes lastReadAt before the latest inbound so
   * the conversation re-surfaces as unread for THIS user only. Other users'
   * read state is untouched.
   */
  async markAsUnread(
    conversationId: string,
    organizationId: string,
    userId: string,
    access: ChannelAccess = 'ALL',
  ) {
    await this.findOne(conversationId, organizationId, access);
    const result = await this.repository.markAsUnread(userId, conversationId);

    this.realtimeGateway.emitToUser(userId, 'conversation:unread', {
      conversationId,
      userId,
      unreadCount: result.unreadCount,
    });

    return { ok: true, unreadCount: result.unreadCount };
  }

  /**
   * On-demand sync of a single conversation: pulls the latest messages from
   * the channel provider (e.g. Zappfy) and merges them with what we already
   * have locally. The webhook covers the steady state — this is the recovery
   * path for when an event was missed (provider downtime, webhook hiccup,
   * channel reconnected, etc.).
   */
  async syncMessages(id: string, organizationId: string, access: ChannelAccess = 'ALL') {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        channel: true,
        contact: {
          include: {
            channels: true,
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    this.channelAccess.assertChannelAccess(access, conversation.channelId);

    const adapter = this.adapterRegistry.getHistorySync(conversation.channel.type);
    if (!adapter) {
      throw new BadRequestException(
        `Channel type ${conversation.channel.type} does not support sync`,
      );
    }

    const externalId = this.resolveExternalConversationId(conversation);
    if (!externalId) {
      throw new BadRequestException(
        'Cannot sync: conversation has no external chat id',
      );
    }

    let cursor: string | undefined;
    let imported = 0;
    let fetched = 0;
    let pages = 0;

    try {
      do {
        const result = await adapter.fetchMessages(
          conversation.channel,
          externalId,
          {},
          cursor,
          SYNC_MESSAGE_PAGE_SIZE,
        );
        fetched += result.messages.length;
        if (result.messages.length === 0) break;

        const res = await this.historyImporter.importMessages(
          conversation.channel,
          conversation.id,
          result.messages,
        );
        imported += res.imported;
        cursor = result.nextCursor;
        pages++;

        // Stop early once we hit a page where everything was already known —
        // the provider returns newest-first, so older pages can only be older
        // than what we already imported.
        if (res.imported === 0) break;
      } while (cursor && pages < SYNC_MAX_PAGES);
    } catch (err: any) {
      this.logger.error(
        `Failed to sync conversation ${id}: ${err.message}`,
        err.stack,
      );
      throw new BadRequestException(
        `Sync failed: ${err.response?.data?.message || err.message}`,
      );
    }

    if (imported > 0) {
      await this.historyImporter.notifyConversationImported(
        organizationId,
        conversation.id,
      );
    }

    this.logger.log(
      `Conversation ${id} synced: ${imported} new, ${fetched - imported} already known`,
    );

    return {
      imported,
      fetched,
      syncedAt: new Date().toISOString(),
    };
  }

  private resolveExternalConversationId(conversation: {
    channelId: string;
    metadata: any;
    contact: { channels: { channelId: string; externalId: string }[] };
  }): string | null {
    const fromMetadata =
      conversation.metadata &&
      typeof conversation.metadata === 'object' &&
      'externalConversationId' in conversation.metadata
        ? String((conversation.metadata as any).externalConversationId)
        : null;
    if (fromMetadata) return fromMetadata;

    const contactChannel = conversation.contact.channels.find(
      (c) => c.channelId === conversation.channelId,
    );
    return contactChannel?.externalId ?? null;
  }
}
