import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  MessageContentType,
  StatusUpdate,
} from '../../ports/types';

@Injectable()
export class WhatsAppOfficialMessageMapper {
  normalizeInbound(
    message: Record<string, any>,
    contact: Record<string, any>,
  ): NormalizedInboundMessage | null {
    if (!message) return null;

    const result: NormalizedInboundMessage = {
      externalMessageId: message.id,
      externalContactId: message.from,
      contactName: contact?.profile?.name,
      contactPhone: message.from,
      channelType: ChannelType.WHATSAPP_OFFICIAL,
      timestamp: new Date(parseInt(message.timestamp, 10) * 1000),
      type: this.resolveContentType(message),
      content: this.extractContent(message),
      isForwarded: !!message.context?.forwarded,
      rawPayload: message,
    };

    if (message.context?.id) {
      result.replyTo = { externalMessageId: message.context.id };
    }

    return result;
  }

  normalizeStatus(status: Record<string, any>): StatusUpdate | null {
    if (!status?.id) return null;

    const statusMap: Record<string, StatusUpdate['status']> = {
      sent: 'sent',
      delivered: 'delivered',
      read: 'read',
      failed: 'failed',
    };

    const mapped = statusMap[status.status];
    if (!mapped) return null;

    return {
      externalMessageId: status.id,
      status: mapped,
      timestamp: new Date(parseInt(status.timestamp, 10) * 1000),
      errorMessage: status.errors?.[0]?.message,
    };
  }

  denormalize(
    message: NormalizedOutboundMessage,
    contactExternalId: string,
  ): Record<string, any> {
    const base: Record<string, any> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: contactExternalId,
    };
    // Meta Cloud API: replyTo vira `context.message_id` no payload top-level.
    // O WhatsApp do cliente renderiza nossa msg com a "bolha-resposta" sobre
    // a mensagem original, exatamente como uma reply nativa.
    // Nota: 'reaction' e 'template' não aceitam context — evitamos abaixo.
    if (message.replyTo?.externalMessageId) {
      base.context = { message_id: message.replyTo.externalMessageId };
    }

    switch (message.type) {
      case MessageContentType.TEXT:
        return { ...base, type: 'text', text: { body: message.content.text } };

      case MessageContentType.IMAGE:
        return {
          ...base,
          type: 'image',
          image: {
            link: message.content.mediaUrl,
            caption: message.content.caption,
          },
        };

      case MessageContentType.AUDIO:
        return {
          ...base,
          type: 'audio',
          audio: { link: message.content.mediaUrl },
        };

      case MessageContentType.VIDEO:
        return {
          ...base,
          type: 'video',
          video: {
            link: message.content.mediaUrl,
            caption: message.content.caption,
          },
        };

      case MessageContentType.DOCUMENT:
        return {
          ...base,
          type: 'document',
          document: {
            link: message.content.mediaUrl,
            filename: message.content.fileName,
            caption: message.content.caption,
          },
        };

      case MessageContentType.STICKER:
        return {
          ...base,
          type: 'sticker',
          sticker: { link: message.content.mediaUrl },
        };

      case MessageContentType.LOCATION:
        return {
          ...base,
          type: 'location',
          location: {
            latitude: message.content.latitude,
            longitude: message.content.longitude,
          },
        };

      case MessageContentType.REACTION: {
        // Cloud API reaction NÃO aceita context — strip antes de enviar.
        const { context, ...withoutCtx } = base;
        void context;
        return {
          ...withoutCtx,
          type: 'reaction',
          reaction: {
            message_id: message.content.reaction?.targetMessageId,
            emoji: message.content.reaction?.emoji,
          },
        };
      }

      case MessageContentType.INTERACTIVE: {
        // Menu do robô: botões de resposta (até 3) ou lista (até 10).
        // Limites da Meta: título do botão 20, da linha 24, botão da lista 20.
        const c = message.content as any;
        const options: Array<{ id: string; title: string }> = c?.interactive?.options ?? [];
        const body = String(c?.text || 'Escolha uma opção:').slice(0, 1024);
        if (options.length === 0 || options.length > 10) {
          return { ...base, type: 'text', text: { body: c?.fallbackText || body } };
        }
        if (c.interactive.kind === 'buttons' && options.length <= 3) {
          return {
            ...base,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: body },
              action: {
                buttons: options.map((o) => ({
                  type: 'reply',
                  reply: { id: String(o.id).slice(0, 256), title: String(o.title).slice(0, 20) },
                })),
              },
            },
          };
        }
        return {
          ...base,
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: body },
            action: {
              button: String(c.interactive.listButton || 'Ver opções').slice(0, 20),
              sections: [
                {
                  title: 'Opções',
                  rows: options.map((o) => ({
                    id: String(o.id).slice(0, 200),
                    title: String(o.title).slice(0, 24),
                    ...(String(o.title).length > 24 ? { description: String(o.title).slice(0, 72) } : {}),
                  })),
                },
              ],
            },
          },
        };
      }

      case MessageContentType.TEMPLATE: {
        // Templates HSM também não aceitam context.
        const { context, ...withoutCtx } = base;
        void context;
        return {
          ...withoutCtx,
          type: 'template',
          template: message.content as any,
        };
      }

      default:
        return { ...base, type: 'text', text: { body: message.content.text || '' } };
    }
  }

  private resolveContentType(msg: Record<string, any>): MessageContentType {
    const type = msg.type;
    const map: Record<string, MessageContentType> = {
      text: MessageContentType.TEXT,
      image: MessageContentType.IMAGE,
      audio: MessageContentType.AUDIO,
      video: MessageContentType.VIDEO,
      document: MessageContentType.DOCUMENT,
      sticker: MessageContentType.STICKER,
      location: MessageContentType.LOCATION,
      reaction: MessageContentType.REACTION,
      interactive: MessageContentType.INTERACTIVE,
      button: MessageContentType.INTERACTIVE,
      template: MessageContentType.TEMPLATE,
    };
    return map[type] || MessageContentType.TEXT;
  }

  private extractContent(msg: Record<string, any>): NormalizedInboundMessage['content'] {
    switch (msg.type) {
      case 'text':
        return { text: msg.text?.body };
      case 'image':
        return {
          mediaId: msg.image?.id,
          mimeType: msg.image?.mime_type,
          caption: msg.image?.caption,
        };
      case 'audio':
        return {
          mediaId: msg.audio?.id,
          mimeType: msg.audio?.mime_type,
        };
      case 'video':
        return {
          mediaId: msg.video?.id,
          mimeType: msg.video?.mime_type,
          caption: msg.video?.caption,
        };
      case 'document':
        return {
          mediaId: msg.document?.id,
          mimeType: msg.document?.mime_type,
          fileName: msg.document?.filename,
          caption: msg.document?.caption,
        };
      case 'sticker':
        return {
          mediaId: msg.sticker?.id,
          mimeType: msg.sticker?.mime_type,
        };
      case 'location':
        return {
          latitude: msg.location?.latitude,
          longitude: msg.location?.longitude,
          text: msg.location?.name || msg.location?.address,
        };
      case 'reaction':
        return {
          reaction: {
            emoji: msg.reaction?.emoji,
            targetMessageId: msg.reaction?.message_id,
          },
        };
      case 'interactive':
        if (msg.interactive?.type === 'button_reply') {
          return {
            interactive: { type: 'button', buttonId: msg.interactive.button_reply?.id },
            text: msg.interactive.button_reply?.title,
          };
        }
        if (msg.interactive?.type === 'list_reply') {
          return {
            interactive: { type: 'list', listRowId: msg.interactive.list_reply?.id },
            text: msg.interactive.list_reply?.title,
          };
        }
        return { text: '[Interactive message]' };
      default:
        return { text: `[${msg.type || 'unknown'}]` };
    }
  }
}
