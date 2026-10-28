import { Injectable, Logger } from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { ZappfyHttpClient } from './zappfy.http-client';

/** Link da foto do WhatsApp expira em poucos dias: renova antes. */
const AVATAR_REFRESH_MS = 3 * 24 * 3_600_000;
/** Sem foto (privacidade, API sem o campo): não pergunta de novo a cada mensagem. */
const RETRY_MS = 6 * 3_600_000;

/** Campos de foto que a uazapi/Zappfy já usou (variam entre versões e endpoints). */
const IMAGE_KEYS = ['image', 'imagePreview', 'wa_profilePicUrl', 'profilePicUrl', 'profilePictureUrl', 'picture'];

export function pickAvatar(chat: Record<string, unknown> | null | undefined): string | undefined {
  for (const k of IMAGE_KEYS) {
    const v = chat?.[k];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return undefined;
}

export function pickName(chat: Record<string, unknown> | null | undefined): string | undefined {
  for (const k of ['wa_contactName', 'wa_name', 'name']) {
    const v = chat?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Foto de perfil (e nome, se o contato não tiver) de um contato do WhatsApp
 * via Zappfy/uazapi. Roda em segundo plano no inbound: busca quando o contato
 * ainda não tem foto (no máximo a cada 6h) ou quando o link tem mais de 3 dias.
 */
@Injectable()
export class ZappfyContactEnricherService {
  private readonly logger = new Logger(ZappfyContactEnricherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpClient: ZappfyHttpClient,
  ) {}

  async enrich(channel: Channel, externalContactId: string): Promise<void> {
    try {
      const contactChannel = await this.prisma.contactChannel.findUnique({
        where: {
          uq_contact_channel_external: {
            channelId: channel.id,
            externalId: externalContactId,
          },
        },
        include: { contact: true },
      });
      if (!contactChannel) return;
      const contact = contactChannel.contact;
      const meta = (contact.metadata as Record<string, unknown> | null) ?? {};
      const ago = (k: string) => {
        const t = typeof meta[k] === 'string' ? Date.parse(meta[k] as string) : NaN;
        return Number.isNaN(t) ? Infinity : Date.now() - t;
      };
      const stale = contact.avatarUrl ? ago('avatarFetchedAt') > AVATAR_REFRESH_MS : true;
      if (!stale || ago('avatarCheckedAt') < RETRY_MS) return;

      const chat = await this.fetchChat(channel, externalContactId);
      const avatarUrl = pickAvatar(chat);
      const profileName = pickName(chat);
      const now = new Date().toISOString();

      if (avatarUrl || profileName) {
        const ccUpdates: Prisma.ContactChannelUpdateInput = {};
        if (profileName && profileName !== contactChannel.profileName) ccUpdates.profileName = profileName;
        if (avatarUrl && avatarUrl !== contactChannel.profileAvatarUrl) ccUpdates.profileAvatarUrl = avatarUrl;
        if (Object.keys(ccUpdates).length > 0) {
          await this.prisma.contactChannel.update({ where: { id: contactChannel.id }, data: ccUpdates });
        }
      }
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: {
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(profileName && !contact.name ? { name: profileName } : {}),
          metadata: {
            ...meta,
            avatarCheckedAt: now,
            ...(avatarUrl ? { avatarFetchedAt: now } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      if (avatarUrl) {
        this.logger.log(`Zappfy contact enriched: ${externalContactId} → ${profileName ?? '(no name)'} + avatar`);
      } else {
        // Ajuda a descobrir o campo certo se a Zappfy mudar o formato.
        this.logger.warn(
          `Zappfy: sem foto para ${externalContactId} (campos: ${chat ? Object.keys(chat).slice(0, 40).join(',') : 'nenhum'})`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`Zappfy contact enrichment failed for ${externalContactId}: ${err.message}`);
    }
  }

  /** `/chat/details` (traz a foto) e, se falhar ou vier sem foto, `/chat/find`. */
  private async fetchChat(channel: Channel, chatId: string): Promise<Record<string, unknown> | null> {
    const number = chatId.split('@')[0];
    let details: Record<string, unknown> | null = null;
    try {
      const res = await this.httpClient.sendRequest(channel, '/chat/details', { number, preview: false });
      details = (res?.chat ?? res?.data ?? res) as Record<string, unknown> | null;
      if (pickAvatar(details)) return details;
    } catch (err: any) {
      this.logger.warn(`Zappfy /chat/details failed for ${chatId}: ${err.message}`);
    }
    try {
      const res = await this.httpClient.sendRequest(channel, '/chat/find', { wa_chatid: chatId, limit: 1 });
      const chats = res?.chats ?? res?.data ?? res;
      const found = (Array.isArray(chats) ? chats[0] : null) as Record<string, unknown> | null;
      return found && pickAvatar(found) ? found : (details ?? found);
    } catch (err: any) {
      this.logger.warn(`Zappfy /chat/find failed for ${chatId}: ${err.message}`);
      return details;
    }
  }
}
