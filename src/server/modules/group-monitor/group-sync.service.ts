import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { HistoryImportService } from '../messaging/pipeline/history-import.service';
import { ZappfyHttpClient } from '../channel-hub/adapters/zappfy/zappfy.http-client';
import { pickAvatar } from '../channel-hub/adapters/zappfy/zappfy-contact-enricher.service';
import { GROUP_JID_SUFFIX, deriveGroupJid } from '../segments/group-jid.util';

export interface ListedGroup {
  jid: string;
  name: string;
  participants: number | null;
  avatarUrl?: string;
}

export interface GroupSyncResult {
  channels: number;
  groups: number;
  created: number;
  left: number;
  errors: Array<{ channel: string; message: string }>;
}

/**
 * Lê um grupo da uazapi/Zappfy. `/group/list` devolve o GroupInfo do
 * whatsmeow (JID, Name, Participants) e `/chat/find` o chat (wa_chatid,
 * wa_name) — aceita os dois.
 */
export function normalizeGroup(raw: Record<string, any>): ListedGroup | null {
  const jid = String(raw?.JID ?? raw?.jid ?? raw?.wa_chatid ?? raw?.chatid ?? raw?.id ?? '');
  if (!jid.endsWith(GROUP_JID_SUFFIX)) return null;
  const name = [raw.Name, raw.name, raw.Subject, raw.subject, raw.wa_name, raw.wa_contactName]
    .find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const list = raw.Participants ?? raw.participants;
  const participants = Array.isArray(list)
    ? list.length
    : typeof raw.Size === 'number'
      ? raw.Size
      : typeof raw.size === 'number'
        ? raw.size
        : null;
  return { jid, name: name?.trim() || jid, participants, avatarUrl: pickAvatar(raw) };
}

/**
 * "Atualizar grupos": traz todos os grupos em que o número conectado está,
 * mesmo os que ainda não tiveram mensagem, e marca os grupos de onde ele saiu.
 * Cada grupo vira (ou reaproveita) a conversa de grupo do canal.
 */
@Injectable()
export class GroupSyncService {
  private readonly logger = new Logger(GroupSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zappfy: ZappfyHttpClient,
    private readonly historyImport: HistoryImportService,
  ) {}

  async syncAll(organizationId: string, access: ChannelAccess): Promise<GroupSyncResult> {
    const channels = await this.prisma.channel.findMany({
      where: {
        organizationId,
        type: ChannelType.WHATSAPP_ZAPPFY,
        isActive: true,
        deletedAt: null,
        ...(access === 'ALL' ? {} : { id: { in: [...access] } }),
      },
    });
    const result: GroupSyncResult = { channels: channels.length, groups: 0, created: 0, left: 0, errors: [] };
    for (const channel of channels) {
      try {
        const r = await this.syncChannel(channel);
        result.groups += r.groups;
        result.created += r.created;
        result.left += r.left;
      } catch (err: any) {
        this.logger.warn(`Group sync failed for channel ${channel.id}: ${err?.message ?? err}`);
        result.errors.push({ channel: channel.name, message: err?.message ?? String(err) });
      }
    }
    return result;
  }

  async syncChannel(channel: Channel): Promise<{ groups: number; created: number; left: number }> {
    const groups = await this.listGroups(channel);
    const now = new Date().toISOString();
    let created = 0;

    for (const g of groups) {
      // Grupo já conhecido (em qualquer status, inclusive encerrado) mantém a
      // mesma conversa: o importador abriria outra para conversa encerrada.
      const existing = await this.existingGroupConversation(channel, g.jid);
      const imported =
        existing ??
        (await this.historyImport.importConversation(channel, {
          externalConversationId: g.jid,
          externalContactId: g.jid,
          contactName: g.name,
          contactAvatarUrl: g.avatarUrl,
          isGroup: true,
          unreadCount: 0,
        }));
      if (!existing && imported.isNew) created++;
      // O nome do grupo muda; o contato guarda o nome exibido nas telas.
      await this.prisma.contact.updateMany({
        where: { id: imported.contactId, NOT: { name: g.name } },
        data: { name: g.name, ...(g.avatarUrl ? { avatarUrl: g.avatarUrl } : {}) },
      });
      await this.mergeMetadata(imported.conversationId, {
        groupParticipants: g.participants,
        groupLeft: false,
        groupSyncedAt: now,
      });
    }

    // Grupo que não veio na lista: o número saiu (ou foi removido).
    const listed = new Set(groups.map((g) => g.jid));
    const known = await this.prisma.conversation.findMany({
      where: { organizationId: channel.organizationId, channelId: channel.id, isGroup: true, deletedAt: null },
      select: {
        id: true,
        channelId: true,
        metadata: true,
        contact: { select: { channels: { select: { channelId: true, externalId: true } } } },
      },
    });
    let left = 0;
    for (const conv of known) {
      const jid = deriveGroupJid(conv);
      if (!jid || listed.has(jid)) continue;
      if ((conv.metadata as Record<string, unknown> | null)?.groupLeft === true) continue;
      await this.mergeMetadata(conv.id, { groupLeft: true, groupSyncedAt: now });
      left++;
    }

    return { groups: groups.length, created, left };
  }

  private async existingGroupConversation(channel: Channel, jid: string) {
    const link = await this.prisma.contactChannel.findUnique({
      where: { uq_contact_channel_external: { channelId: channel.id, externalId: jid } },
      select: { contactId: true },
    });
    if (!link) return null;
    const conv = await this.prisma.conversation.findFirst({
      where: { channelId: channel.id, contactId: link.contactId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    return conv ? { conversationId: conv.id, contactId: link.contactId, isNew: false } : null;
  }

  /** `/group/list`; em versões sem esse endpoint, os chats de grupo do `/chat/find`. */
  private async listGroups(channel: Channel): Promise<ListedGroup[]> {
    let raw: any[];
    try {
      raw = await this.zappfy.listGroups(channel);
    } catch (err: any) {
      this.logger.warn(`/group/list failed for channel ${channel.id} (${err?.message ?? err}); using /chat/find`);
      raw = [];
      for (let offset = 0, page = 0; page < 20; page++) {
        const res = await this.zappfy.fetchChats(channel, { limit: 100, offset, isGroup: true });
        const chats: any[] = res?.chats ?? [];
        raw.push(...chats);
        if (chats.length < 100) break;
        offset += chats.length;
      }
    }
    const byJid = new Map<string, ListedGroup>();
    for (const r of raw) {
      const g = normalizeGroup(r);
      if (g) byJid.set(g.jid, g);
    }
    return [...byJid.values()];
  }

  private async mergeMetadata(conversationId: string, patch: Record<string, unknown>) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { metadata: true },
    });
    const current = (conv?.metadata ?? {}) as Record<string, unknown>;
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: { ...current, ...patch } as Prisma.InputJsonValue },
    });
  }
}
