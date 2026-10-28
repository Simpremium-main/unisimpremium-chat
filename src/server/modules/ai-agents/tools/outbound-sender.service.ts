import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Message, MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ToolContext } from './tool.types';
import { OUTBOUND_JOB_OPTS } from '../../messaging/pipeline/outbound-message.processor';

export type OutboundContent =
  | { type: 'TEXT'; text: string }
  | { type: 'IMAGE' | 'VIDEO'; mediaUrl: string; caption?: string | null };

/**
 * Envia mensagens do agente pelo mesmo caminho do atendente humano (fila
 * `outbound-messages`): grava a Message, avisa o realtime e enfileira pro
 * provedor do canal, com retry/backoff.
 */
@Injectable()
export class OutboundSenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  /** ID do contato no canal; null quando o contato não tem vínculo com o canal. */
  async contactExternalId(ctx: ToolContext): Promise<string | null> {
    const link = await this.prisma.contactChannel.findFirst({
      where: { contactId: ctx.contactId, channelId: ctx.channelId },
      select: { externalId: true },
    });
    return link?.externalId ?? null;
  }

  /** Uma mensagem, com a pausa de "digitando..." do processador de envio. */
  async send(
    ctx: ToolContext,
    contactExternalId: string,
    item: OutboundContent,
    senderName: string,
  ): Promise<Message> {
    return (await this.sendSequence(ctx, contactExternalId, [item], senderName))[0];
  }

  /**
   * Várias mensagens de uma vez (fluxo, cotação em 2 partes): saem na ordem,
   * uma logo depois da outra e sem pausa de digitação. Um único job leva a
   * sequência — o processador só enfileira a próxima depois de entregar a atual.
   */
  async sendSequence(
    ctx: ToolContext,
    contactExternalId: string,
    items: OutboundContent[],
    senderName: string,
  ): Promise<Message[]> {
    const created: Array<{ message: Message; payload: { type: MessageContentType; content: object } }> = [];
    for (const item of items) {
      const type = MessageContentType[item.type];
      const content =
        item.type === 'TEXT'
          ? { text: item.text }
          : { mediaUrl: item.mediaUrl, ...(item.caption ? { caption: item.caption } : {}) };
      const message = await this.prisma.message.create({
        data: {
          conversationId: ctx.conversationId,
          direction: MessageDirection.OUTBOUND,
          type,
          content,
          status: MessageStatus.QUEUED,
          senderName,
          metadata: { aiAgentId: ctx.agentId, runId: ctx.runId },
        },
      });
      created.push({ message, payload: { type, content } });
      this.realtime.emitToChannel(ctx.channelId, 'message:new', {
        message,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
      });
      this.realtime.emitToConversation(ctx.conversationId, 'message:new', { message });
    }
    if (created.length === 0) return [];

    await this.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { lastMessageAt: new Date() },
    });

    const [first, ...rest] = created;
    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: first.message.id,
        channelId: ctx.channelId,
        contactExternalId,
        message: first.payload,
        ...(created.length > 1
          ? {
              skipTyping: true,
              then: rest.map((r) => ({ messageId: r.message.id, message: r.payload })),
            }
          : {}),
      },
      OUTBOUND_JOB_OPTS,
    );
    return created.map((c) => c.message);
  }
}
