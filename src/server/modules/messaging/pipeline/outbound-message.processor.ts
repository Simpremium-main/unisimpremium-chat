import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { ChannelType, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ChannelAdapterRegistry } from '../../channel-hub/channel-adapter.registry';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { NormalizedOutboundMessage } from '../../channel-hub/ports/types';
import { IdempotencyService } from './idempotency.service';

interface OutboundJobData {
  messageId: string;
  channelId: string;
  contactExternalId: string;
  message: NormalizedOutboundMessage;
  /** Sem a pausa de "digitando..." (mensagens de uma sequência saem juntas). */
  skipTyping?: boolean;
  /**
   * Resto de uma sequência (fluxo, cotação em 2 partes): a próxima só é
   * enfileirada depois que esta foi entregue — a ordem no WhatsApp é garantida.
   */
  then?: Array<Pick<OutboundJobData, 'messageId' | 'message' | 'delayMs'>>;
  /**
   * Espera antes de enviar (bloco do robô com "Aguardar"): mostra
   * "digitando..." e a mensagem volta pra fila atrasada.
   */
  delayMs?: number;
}

/** Opções dos jobs de envio (as mesmas usadas por quem enfileira). */
export const OUTBOUND_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: false,
} as const;

@Processor('outbound-messages', { concurrency: 5 })
export class OutboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundMessageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: ChannelAdapterRegistry,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly idempotency: IdempotencyService,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {
    super();
  }

  /**
   * Menu do robô (botões/lista) que o provedor recusou — comum no WhatsApp
   * não oficial, onde interativos são instáveis: manda o mesmo menu em
   * texto numerado em vez de deixar o cliente sem opções.
   */
  private async sendWithMenuFallback(
    adapter: ReturnType<ChannelAdapterRegistry['getOutbound']>,
    channel: Parameters<ReturnType<ChannelAdapterRegistry['getOutbound']>['sendMessage']>[0],
    contactExternalId: string,
    message: NormalizedOutboundMessage,
  ) {
    try {
      return await adapter.sendMessage(channel, contactExternalId, message);
    } catch (err: any) {
      const fallbackText = (message.content as any)?.fallbackText;
      if (message.type !== 'INTERACTIVE' || typeof fallbackText !== 'string' || !fallbackText) throw err;
      this.logger.warn(
        `Interactive menu rejected by ${channel.type} (${err?.message ?? err}) — sending numbered text instead`,
      );
      return adapter.sendMessage(channel, contactExternalId, {
        ...message,
        type: 'TEXT' as NormalizedOutboundMessage['type'],
        content: { text: fallbackText },
      });
    }
  }

  async process(job: Job<OutboundJobData>): Promise<any> {
    const { messageId, channelId, contactExternalId, message } = job.data;

    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
    });

    const adapter = this.adapterRegistry.getOutbound(channel.type);

    if (job.data.delayMs && job.data.delayMs > 0) {
      if (channel.type !== ChannelType.GMAIL) {
        await adapter.sendTypingIndicator(channel, contactExternalId).catch(() => undefined);
      }
      await this.outboundQueue.add(
        'send-outbound',
        { ...job.data, delayMs: undefined },
        { ...OUTBOUND_JOB_OPTS, delay: job.data.delayMs },
      );
      return { deferred: true, delayMs: job.data.delayMs };
    }

    // Email precisa de contexto de threading (threadId + In-Reply-To/
    // References) pra resposta cair no thread certo do Gmail. Montado aqui
    // — e não no adapter — porque só o processor enxerga a conversa.
    if (channel.type === ChannelType.GMAIL && !message.emailContext) {
      await this.attachEmailContext(messageId, message);
    }

    // Humanize: if this message was sent by an AI agent, simulate typing
    // delay proportional to text length before actually sending. Customers
    // perceive instant replies as bot-like; a 2-4s "typing..." gap with the
    // typing indicator on feels like a real person on the other side.
    // Email não tem "digitando..." — o delay só atrasaria a entrega.
    if (channel.type !== ChannelType.GMAIL && !job.data.skipTyping) {
      await this.simulateTypingIfAiMessage({
        messageId,
        channel,
        contactExternalId,
        message,
        adapter,
      });
    }

    try {
      const result = await this.sendWithMenuFallback(adapter, channel, contactExternalId, message);

      // Persist externalId FIRST, then mark idempotency so that a subsequent
      // echo webhook for the same externalId is recognised as a duplicate
      // instead of creating a phantom row.
      let updated;
      // Mescla com a metadata que a mensagem já tinha (replyTo da citação,
      // marca do robô/IA) — antes ela era substituída e a citação sumia
      // depois do envio.
      const previous = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { metadata: true },
      });
      const previousMeta =
        previous?.metadata && typeof previous.metadata === 'object' && !Array.isArray(previous.metadata)
          ? (previous.metadata as Record<string, unknown>)
          : {};
      try {
        updated = await this.prisma.message.update({
          where: { id: messageId },
          data: {
            status: MessageStatus.SENT,
            externalId: result.externalId || null,
            sentAt: new Date(),
            metadata: {
              ...previousMeta,
              providerResponse: safeJson(result.providerResponse),
            },
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && result.externalId) {
          // A webhook echo raced us and already inserted a row with this
          // externalId. Merge: delete our QUEUED placeholder and reuse the
          // echo row so there is a single source-of-truth.
          this.logger.warn(
            `Outbound echo race on ${result.externalId} — merging into existing row`,
          );
          const placeholder = await this.prisma.message.findUnique({
            where: { id: messageId },
          });
          const echoRow = await this.prisma.message.findFirst({
            where: {
              externalId: result.externalId,
              id: { not: messageId },
            },
          });
          if (echoRow && placeholder) {
            // Copy senderId + content from placeholder to echo row. Echo has
            // no sender, and for media messages the echo's content lacks the
            // playable mediaUrl (WhatsApp echoes an encrypted .enc CDN URL
            // that browsers cannot decrypt). Our placeholder already has the
            // locally-hosted URL we uploaded — that is the authoritative one.
            const patch: Record<string, any> = {};
            if (placeholder.senderId && !echoRow.senderId) {
              patch.senderId = placeholder.senderId;
            }
            // Também quando o payload enviado difere do placeholder (ex.:
            // assinatura "*Nome:*") — o eco traria o texto assinado.
            const placeholderContent = placeholder.content as any;
            if (
              placeholderContent?.mediaUrl ||
              JSON.stringify(message.content) !== JSON.stringify(placeholderContent)
            ) {
              patch.content = placeholderContent;
            }
            if (Object.keys(patch).length > 0) {
              await this.prisma.message.update({
                where: { id: echoRow.id },
                data: patch,
              });
            }
            await this.prisma.message
              .delete({ where: { id: messageId } })
              .catch(() => undefined);
            updated = await this.prisma.message.findUniqueOrThrow({
              where: { id: echoRow.id },
            });
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      if (result.externalId) {
        await this.idempotency.markProcessed(result.externalId, channelId);
      }

      this.emitStatusUpdate(updated.conversationId, updated.id, MessageStatus.SENT);
      this.realtimeGateway.emitToChannel(channel.id, 'message:new', {
        message: updated,
        conversationId: updated.conversationId,
      });
      // Também pra room da conversa: quem está com o chat aberto entra em
      // conv:<id>, não necessariamente em channel:<id>. No echo de mídia o
      // id da mensagem pode ter trocado (placeholder deletado), então o
      // message:status sozinho não basta — o front precisa do objeto inteiro.
      this.realtimeGateway.emitToConversation(updated.conversationId, 'message:new', {
        message: updated,
        conversationId: updated.conversationId,
      });
      this.logger.log(
        `Outbound sent: msg=${updated.id} externalId=${result.externalId}`,
      );

      const [next, ...rest] = job.data.then ?? [];
      if (next) {
        await this.outboundQueue.add(
          'send-outbound',
          { ...job.data, delayMs: undefined, ...next, then: rest },
          OUTBOUND_JOB_OPTS,
        );
      }

      return { success: true, externalId: result.externalId };
    } catch (error: any) {
      this.logger.error(
        `Outbound failed: msg=${messageId} - ${error.message}`,
      );
      const updated = await this.prisma.message.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.FAILED,
          failedReason: error.message?.slice?.(0, 500) ?? String(error),
        },
      });

      this.emitStatusUpdate(
        updated.conversationId,
        messageId,
        MessageStatus.FAILED,
      );
      // Última tentativa de uma mensagem de sequência: as seguintes não saem
      // mais (a ordem quebraria) — marca como falha em vez de ficarem na fila.
      const rest = job.data.then ?? [];
      if (rest.length > 0 && job.attemptsMade + 1 >= (job.opts?.attempts ?? 1)) {
        await this.prisma.message.updateMany({
          where: { id: { in: rest.map((r) => r.messageId) } },
          data: {
            status: MessageStatus.FAILED,
            failedReason: 'Mensagem anterior da sequência não foi entregue',
          },
        });
        for (const r of rest) {
          this.emitStatusUpdate(updated.conversationId, r.messageId, MessageStatus.FAILED);
        }
      }
      throw error;
    }
  }

  private emitStatusUpdate(
    conversationId: string,
    messageId: string,
    status: MessageStatus,
  ) {
    const payload = { messageId, status, conversationId };
    this.realtimeGateway.emitToConversation(
      conversationId,
      'message:status',
      payload,
    );
  }

  /**
   * Monta o `emailContext` da mensagem outbound (GMAIL): threadId da
   * conversa + In-Reply-To/References/Subject tirados da última mensagem
   * inbound do thread (o mapper guardou o slim context em
   * `metadata.rawPayload.gmail`). Sem inbound anterior (email novo
   * iniciado por nós) o contexto fica só com o subject da conversa —
   * o mapper cai pro modo "email novo".
   */
  private async attachEmailContext(
    messageId: string,
    message: NormalizedOutboundMessage,
  ): Promise<void> {
    try {
      const row = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { conversationId: true },
      });
      if (!row) return;

      const conversation = await this.prisma.conversation.findUnique({
        where: { id: row.conversationId },
        select: { externalThreadId: true, subject: true },
      });

      const lastInbound = await this.prisma.message.findFirst({
        where: {
          conversationId: row.conversationId,
          direction: MessageDirection.INBOUND,
          externalId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      const gmail = (lastInbound?.metadata as any)?.rawPayload?.gmail as
        | {
            threadId?: string;
            messageIdHeader?: string;
            references?: string;
            subject?: string;
          }
        | undefined;

      message.emailContext = {
        threadId: conversation?.externalThreadId ?? gmail?.threadId,
        inReplyTo: gmail?.messageIdHeader,
        references: gmail?.references,
        subject: conversation?.subject ?? gmail?.subject,
      };
    } catch (err: any) {
      // Threading é best-effort — sem contexto o email sai fora do thread,
      // mas sai. Nunca bloqueia o envio.
      this.logger.warn(
        `attachEmailContext failed for msg ${messageId}: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Pre-send humanization for AI replies: turn on the typing indicator on
   * the customer's chat and wait for a delay proportional to how long a
   * human would actually take to type the message.
   *
   * Only runs for messages flagged as coming from an AI agent — handled by
   * checking message.metadata.aiAgentId. Manual operator replies and
   * webhook echoes are sent immediately, no fake typing.
   *
   * Delay model: 900ms base + 28ms/char, clamped to [1000, 6000]ms.
   * For a 12-char "opa, beleza!" → ~1.2s. For a 100-char message → ~3.7s.
   * Caps at 6s so the customer never feels the bot froze.
   */
  private async simulateTypingIfAiMessage(args: {
    messageId: string;
    channel: { id: string; type: any };
    contactExternalId: string;
    message: NormalizedOutboundMessage;
    adapter: any;
  }): Promise<void> {
    try {
      const row = await this.prisma.message.findUnique({
        where: { id: args.messageId },
        select: { metadata: true, conversationId: true },
      });
      const aiAgentId = (row?.metadata as any)?.aiAgentId;
      if (!aiAgentId) return; // not an AI message, send immediately

      const text = (args.message?.content as any)?.text ?? '';
      if (typeof text !== 'string' || text.length === 0) return;

      const delayMs = Math.min(
        6000,
        Math.max(1000, 900 + text.length * 28),
      );

      // Fire typing indicator on the underlying channel (WhatsApp/IG).
      // Don't await — start typing AND start counting delay in parallel.
      args.adapter
        .sendTypingIndicator(args.channel, args.contactExternalId)
        .catch((err: any) =>
          this.logger.warn(`Typing indicator failed: ${err?.message ?? err}`),
        );

      // Notify the in-app UI (Hoppe) that the agent is "typing".
      if (row?.conversationId) {
        this.realtimeGateway.emitToConversation(
          row.conversationId,
          'agent:typing',
          { conversationId: row.conversationId, agentId: aiAgentId },
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err: any) {
      // Never let humanization break sending.
      this.logger.warn(`simulateTyping failed: ${err?.message ?? err}`);
    }
  }
}

function safeJson(value: unknown): any {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}
