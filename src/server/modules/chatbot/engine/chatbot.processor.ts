import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import {
  ChannelType,
  ConversationStatus,
  MessageContentType,
  MessageDirection,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ChatbotEngineService, ChatbotHandoff } from './chatbot-engine.service';
import { OUTBOUND_JOB_OPTS } from '../../messaging/pipeline/outbound-message.processor';
import { AGENT_DEBOUNCE_QUEUE } from '../../messaging/pipeline/agent-debounce.constants';
import { debouncedRunJob } from '../../ai-agents/runner/agent-run-lock';
import { ChatbotCompletion, chatbotSessionKey } from '../session/chatbot-session.keys';
import { toChannelMessages } from './chatbot-message';
import { INBOX_PUSH_QUEUE, inboxPushJob } from '../../push/inbox-push.job';
import { KvStore } from '../../../runtime/kv-store';
import { randomUUID } from 'crypto';

interface ChatbotJobData {
  conversationId: string;
  channelId: string;
  contactExternalId: string;
  organizationId: string;
  messageText: string;
  /** Atendente acionou este fluxo pelo inbox: recomeça do início. */
  startFlowId?: string;
}

/** Nome que aparece nas mensagens do robô no inbox. */
export const CHATBOT_SENDER_NAME = 'Robô';

@Processor('chatbot-processor', { concurrency: 5 })
export class ChatbotProcessor extends WorkerHost {
  private readonly logger = new Logger(ChatbotProcessor.name);
  private readonly kv = new KvStore();

  constructor(
    private readonly engine: ChatbotEngineService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
    @InjectQueue(AGENT_DEBOUNCE_QUEUE) private readonly agentDebounceQueue: Queue,
    @InjectQueue(INBOX_PUSH_QUEUE) private readonly inboxPushQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ChatbotJobData>): Promise<any> {
    const { conversationId } = job.data;
    // Uma mensagem por vez por conversa: duas respostas rápidas do cliente
    // em paralelo avançariam o fluxo duas vezes. Ocupado → o job tenta de
    // novo (backoff da fila).
    const lockKey = `bot:lock:${conversationId}`;
    const token = randomUUID();
    if (!(await this.kv.set(lockKey, token, { ttlMs: 30_000, nx: true }))) {
      throw new Error(`chatbot busy for conv ${conversationId}`);
    }
    try {
      return await this.handle(job.data);
    } finally {
      await this.kv.delIfEquals(lockKey, token).catch(() => undefined);
    }
  }

  private async handle(data: ChatbotJobData) {
    const { conversationId, channelId, contactExternalId, messageText, startFlowId } = data;

    if (startFlowId) await this.kv.del(chatbotSessionKey(conversationId));
    const result = await this.engine.processMessage(
      conversationId,
      channelId,
      contactExternalId,
      messageText,
      startFlowId,
    );

    // Fluxo saiu do canal entre o roteamento e agora: a IA segue normal.
    if (result.notApplicable) {
      await this.triggerAi(conversationId);
      return { notApplicable: true };
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { type: true },
    });
    await this.sendSequence(
      conversationId,
      channelId,
      contactExternalId,
      channel?.type ?? null,
      result.messages,
      result.flowId ?? null,
    );

    if (result.sessionEnded && result.handoff) {
      await this.applyHandoff(conversationId, result.handoff, result.flowId ?? null, result.transferDepartmentId, {
        flowName: result.flowName,
        choices: result.choices,
      });
    }

    return { messagesCount: result.messages.length, handoff: result.handoff };
  }

  /**
   * Mensagens do robô saem na ordem (um job leva a sequência: o processador
   * de envio só manda a próxima depois de entregar a atual) e aparecem na
   * hora no inbox.
   */
  private async sendSequence(
    conversationId: string,
    channelId: string,
    contactExternalId: string,
    channelType: ChannelType | null,
    messages: { type: string; content: Record<string, any>; delayMs?: number }[],
    flowId: string | null,
  ) {
    if (messages.length === 0) return;
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true },
    });
    const created: Array<{
      id: string;
      payload: { type: string; content: Record<string, any> };
      delayMs?: number;
    }> = [];
    for (const { delayMs, ...msg } of messages.flatMap((raw) => toChannelMessages(raw, channelType))) {
      const saved = await this.prisma.message.create({
        data: {
          conversationId,
          direction: MessageDirection.OUTBOUND,
          type: msg.type as MessageContentType,
          content: msg.content as Prisma.InputJsonValue,
          status: MessageStatus.QUEUED,
          senderName: CHATBOT_SENDER_NAME,
          metadata: { chatbotFlowId: flowId },
        },
      });
      created.push({ id: saved.id, payload: msg, ...(delayMs ? { delayMs } : {}) });
      this.realtime.emitToChannel(channelId, 'message:new', {
        message: saved,
        conversationId,
        contactId: conv?.contactId,
      });
      this.realtime.emitToConversation(conversationId, 'message:new', { message: saved });
    }
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    const [first, ...rest] = created;
    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: first.id,
        channelId,
        contactExternalId,
        message: first.payload,
        skipTyping: true,
        ...(first.delayMs ? { delayMs: first.delayMs } : {}),
        ...(rest.length > 0
          ? {
              then: rest.map((r) => ({
                messageId: r.id,
                message: r.payload,
                ...(r.delayMs ? { delayMs: r.delayMs } : {}),
              })),
            }
          : {}),
      },
      OUTBOUND_JOB_OPTS,
    );
  }

  /**
   * Fim do fluxo: grava a conclusão (o robô não recomeça neste atendimento)
   * e entrega a conversa pra IA — que responde na hora, com o histórico do
   * fluxo — ou pro humano (IA pausada, conversa na fila).
   */
  private async applyHandoff(
    conversationId: string,
    handoff: ChatbotHandoff,
    flowId: string | null,
    departmentId?: string,
    context: Pick<ChatbotCompletion, 'flowName' | 'choices'> = {},
  ) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true, metadata: true, channelId: true, aiEnabled: true, organizationId: true },
    });
    if (!conv) return;

    const completion: ChatbotCompletion = {
      flowId,
      completedAt: new Date().toISOString(),
      handoff,
      reason: 'flow',
      ...context,
    };
    const metadata = {
      ...((conv.metadata as Record<string, unknown>) ?? {}),
      chatbot: completion,
    } as unknown as Prisma.InputJsonValue;
    const nextStatus =
      conv.status === ConversationStatus.BOT ? ConversationStatus.PENDING : conv.status;

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        metadata,
        status: nextStatus,
        ...(handoff === 'HUMAN'
          ? {
              aiEnabled: false,
              aiDisabledBy: null,
              aiDisabledAt: new Date(),
              activeAgentId: null,
              ...(departmentId ? { departmentId } : {}),
            }
          : // Fim → IA vale mesmo se um atendente tinha pausado a IA (robô
            // acionado à mão no meio do atendimento).
            conv.aiEnabled === false
            ? { aiEnabled: null, aiDisabledBy: null, aiDisabledAt: null }
            : {}),
      },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId,
        action: 'STATUS_CHANGED',
        fromValue: conv.status,
        toValue: nextStatus,
        metadata: { trigger: 'chatbot_end', handoff, flowId },
      },
    });

    this.realtime.emitToChannel(conv.channelId, 'conversation:updated', { conversation: updated });
    this.realtime.emitToConversation(conversationId, 'conversation:updated', { conversation: updated });
    this.logger.log(`Chatbot ended for conv ${conversationId} → ${handoff}`);

    if (handoff === 'AI') await this.triggerAi(conversationId);
    else {
      // Foi pro atendente: entra em "IA para Humano" → push no celular.
      const push = inboxPushJob(conv.organizationId, conversationId);
      await this.inboxPushQueue.add(push.name, push.data, push.opts).catch((err) =>
        this.logger.warn(`inbox push enqueue failed for conv ${conversationId}: ${err?.message ?? err}`),
      );
    }
  }

  /** Agenda a IA na última mensagem do cliente (mesmo debounce do inbound). */
  private async triggerAi(conversationId: string) {
    const lastInbound = await this.prisma.message.findFirst({
      where: { conversationId, direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!lastInbound) return;
    const job = debouncedRunJob(conversationId, lastInbound.id);
    await this.agentDebounceQueue.add(job.name, job.data, job.opts).catch((err) =>
      this.logger.warn(`AI trigger after chatbot failed for conv ${conversationId}: ${err?.message ?? err}`),
    );
  }
}
