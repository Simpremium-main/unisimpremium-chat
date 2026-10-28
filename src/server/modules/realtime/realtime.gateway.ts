import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { createHmac } from 'crypto';
import { PresenceService } from './presence.service';
import { PrismaService } from '../../database/prisma.service';
import { ChannelAccessService } from '../iam/channel-access/channel-access.service';
import { trackBackground } from '../../runtime/background';

type RoomKind = 'user' | 'org' | 'channel' | 'conv';

interface BroadcastMessage {
  topic: string;
  event: string;
  payload: unknown;
  private: boolean;
}

export interface RealtimeSession {
  userId: string;
  /** Nome exibido no Presence da conversa ("quem está com ela aberta"). */
  userName: string;
  organizationId: string | null;
  channelIds: string[];
  /** null quando o Supabase Realtime não está configurado (dev sem Supabase). */
  supabase: { url: string; anonKey: string } | null;
  topics: {
    user: string;
    org: string | null;
    channels: Record<string, string>;
  };
}

export type JoinConversationResult =
  | { ok: true; conversationId: string; topic: string }
  | { ok: false; conversationId: string; reason: 'org-mismatch' | 'no-channel-grant' };

/**
 * Realtime sobre Supabase Realtime (Broadcast) — substitui o gateway
 * Socket.io, que não roda em serverless (Vercel não mantém conexões).
 *
 * As "rooms" do Socket.io viram tópicos de broadcast. Cada tópico leva uma
 * assinatura HMAC (`rt:<kind>:<id>:<sig>`) derivada de um segredo do
 * servidor, então só quem recebeu o nome do tópico pela API — depois das
 * mesmas checagens que o handshake do socket fazia (JWT, membership da org,
 * grant de canal) — consegue assinar o tópico.
 *
 * A API pública desta classe (emitToOrg/Channel/Conversation/User,
 * grant/revokeChannelToUser) é a mesma do gateway antigo, então nenhum
 * chamador precisou mudar.
 */
@Injectable()
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly supabaseUrl: string | null;
  private readonly serviceKey: string | null;
  private readonly anonKey: string | null;
  private readonly topicSecret: string;
  private queue: BroadcastMessage[] = [];
  private flushScheduled = false;
  private warnedDisabled = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly presence: PresenceService,
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
  ) {
    this.supabaseUrl =
      (this.configService.get<string>('SUPABASE_URL') || '').replace(/\/$/, '') || null;
    this.serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') || null;
    this.anonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || null;
    this.topicSecret =
      this.configService.get<string>('REALTIME_TOPIC_SECRET') ||
      this.configService.get<string>('JWT_SECRET')!;
  }

  private get enabled(): boolean {
    return !!(this.supabaseUrl && this.serviceKey && this.anonKey);
  }

  topicFor(kind: RoomKind, id: string): string {
    const sig = createHmac('sha256', this.topicSecret)
      .update(`${kind}:${id}`)
      .digest('base64url')
      .slice(0, 22);
    return `rt:${kind}:${id}:${sig}`;
  }

  // ─── Sessão / join (substituem handshake + join:conversation) ──────

  /**
   * Equivalente ao `handleConnection` do gateway Socket.io: valida a
   * membership e resolve os canais visíveis. Retorna null se o usuário não
   * é membro da org pedida (o socket antigo era desconectado nesse caso).
   */
  async buildSession(userId: string, orgId: string | null): Promise<RealtimeSession | null> {
    let channelIds: string[] = [];
    if (orgId) {
      const membership = await this.prisma.userOrganization.findUnique({
        where: { userId_organizationId: { userId, organizationId: orgId } },
        select: { id: true, role: true },
      });
      if (!membership) {
        this.logger.warn(`Realtime session: user ${userId} is not a member of org ${orgId}`);
        return null;
      }
      channelIds = await this.resolveChannelRoomsForMembership(
        orgId,
        membership.id,
        membership.role,
      );
      await this.presence.setOnline(userId, orgId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    return {
      userId,
      userName: user?.name ?? '',
      organizationId: orgId,
      channelIds,
      supabase: this.enabled ? { url: this.supabaseUrl!, anonKey: this.anonKey! } : null,
      topics: {
        user: this.topicFor('user', userId),
        org: orgId ? this.topicFor('org', orgId) : null,
        channels: Object.fromEntries(channelIds.map((id) => [id, this.topicFor('channel', id)])),
      },
    };
  }

  /** Equivalente ao `@SubscribeMessage('join:conversation')`. */
  async joinConversation(
    userId: string,
    orgId: string,
    role: OrgRole,
    userOrganizationId: string,
    conversationId: string,
  ): Promise<JoinConversationResult> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channelId: true, organizationId: true },
    });
    // Diferente do socket antigo, OWNER/ADMIN também passam pela checagem de
    // org: o tópico é uma credencial, não pode vazar entre organizações.
    if (!conv || conv.organizationId !== orgId) {
      this.logger.warn(`join:conversation rejected: conv ${conversationId} not in org ${orgId}`);
      return { ok: false, conversationId, reason: 'org-mismatch' };
    }
    if (!this.channelAccess.isBypassRole(role)) {
      const channelIds = await this.resolveChannelRoomsForMembership(
        orgId,
        userOrganizationId,
        role,
      );
      if (!channelIds.includes(conv.channelId)) {
        this.logger.warn(
          `join:conversation rejected: user ${userId} has no grant on channel ${conv.channelId}`,
        );
        return { ok: false, conversationId, reason: 'no-channel-grant' };
      }
    }
    await this.presence.setActiveConversation(userId, orgId, conversationId);
    return { ok: true, conversationId, topic: this.topicFor('conv', conversationId) };
  }

  /** Equivalente ao `@SubscribeMessage('leave:conversation')`. */
  async leaveConversation(userId: string, orgId: string): Promise<void> {
    await this.presence.setActiveConversation(userId, orgId, null);
  }

  /** Equivalente ao `@SubscribeMessage('typing')`. */
  typing(userId: string, conversationId: string, isTyping: boolean): void {
    this.emitToConversation(conversationId, 'agent:typing', {
      userId,
      conversationId,
      isTyping,
    });
  }

  private async resolveChannelRoomsForMembership(
    organizationId: string,
    userOrganizationId: string,
    role: OrgRole,
  ): Promise<string[]> {
    if (this.channelAccess.isBypassRole(role)) {
      const channels = await this.prisma.channel.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true },
      });
      return channels.map((c) => c.id);
    }
    const grants = await this.prisma.channelAgent.findMany({
      where: { userOrganizationId },
      select: { channelId: true },
    });
    return grants.map((g) => g.channelId);
  }

  // ─── Emissão (mesma API do gateway Socket.io) ──────────────────────

  emitToOrg(orgId: string, event: string, data: any) {
    this.broadcast(this.topicFor('org', orgId), event, data);
  }

  /**
   * Channel-scoped emit. OWNER/ADMIN of the org and AGENTs explicitly granted
   * access to the channel receive the channel topic in their realtime
   * session, so everyone who should see the event receives it — and AGENTs
   * without grant never learn the topic. Use this for any event tied to a
   * specific channel (message, conversation update, sync progress).
   */
  emitToChannel(channelId: string, event: string, data: any) {
    this.broadcast(this.topicFor('channel', channelId), event, data);
  }

  emitToConversation(conversationId: string, event: string, data: any) {
    this.broadcast(this.topicFor('conv', conversationId), event, data);
  }

  emitToUser(userId: string, event: string, data: any) {
    this.broadcast(this.topicFor('user', userId), event, data);
  }

  /**
   * Avisa as sessões abertas do usuário que o acesso ao canal mudou. O
   * client reage a `permissions:updated` buscando uma sessão nova (que já
   * inclui / exclui o tópico do canal) — sem relogin.
   */
  async grantChannelToUser(userId: string, channelId: string): Promise<void> {
    this.emitToUser(userId, 'permissions:updated', { channelId, granted: true });
  }

  async revokeChannelFromUser(userId: string, channelId: string): Promise<void> {
    this.emitToUser(userId, 'permissions:updated', { channelId, granted: false });
  }

  /**
   * Enfileira e envia em lote (uma chamada HTTP por tick do event loop).
   * O envio é registrado em `trackBackground` para a função serverless não
   * congelar antes de entregar.
   */
  private broadcast(topic: string, event: string, payload: unknown) {
    if (!this.enabled) {
      if (!this.warnedDisabled) {
        this.warnedDisabled = true;
        this.logger.warn(
          'Supabase Realtime não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY) — eventos realtime descartados',
        );
      }
      return;
    }
    // JSON round-trip: mesmo formato que o socket.io serializava (Date → ISO).
    this.queue.push({ topic, event, payload: JSON.parse(JSON.stringify(payload ?? null)), private: false });
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    trackBackground(
      new Promise<void>((resolve) => setImmediate(resolve)).then(() => this.flush()),
    );
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.serviceKey!,
    };
    // Chaves legadas (JWT) vão também no Authorization; as novas `sb_secret_*`
    // não são JWT e só são aceitas no header apikey.
    if (this.serviceKey!.startsWith('eyJ')) {
      headers.Authorization = `Bearer ${this.serviceKey}`;
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${this.supabaseUrl}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ messages: batch }),
        });
        if (res.ok) return;
        const text = await res.text().catch(() => '');
        this.logger.warn(`Realtime broadcast HTTP ${res.status} (try ${attempt}): ${text.slice(0, 300)}`);
        if (res.status < 500 && res.status !== 429) return;
      } catch (err: any) {
        this.logger.warn(`Realtime broadcast failed (try ${attempt}): ${err?.message ?? err}`);
      }
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
    this.logger.error(`Realtime broadcast dropped ${batch.length} event(s) after 3 tries`);
  }
}
