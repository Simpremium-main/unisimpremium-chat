import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { api } from './api';

/**
 * Realtime do app sobre Supabase Realtime (Broadcast).
 *
 * Substitui o socket.io-client mantendo a mesma interface que o app usa
 * (`getSocket().on/off/emit`, `connected`, eventos `connect` / `ready` /
 * `disconnect`), então os componentes não mudaram.
 *
 * Mapeamento do protocolo antigo:
 *  - handshake (auth + rooms)  → GET  /realtime/session devolve os tópicos
 *    (usuário, org, canais) já autorizados pelo servidor; `ready` dispara
 *    quando todos estão assinados.
 *  - emit('join:conversation') → POST /realtime/conversations/:id/join e
 *    assinatura do tópico da conversa; responde com
 *    `join:conversation:ack` / `join:conversation:error` como antes.
 *  - emit('leave:conversation') / emit('typing') → POSTs equivalentes.
 *  - eventos server→client     → broadcasts nos tópicos.
 */

type Handler = (...args: any[]) => void;

interface RealtimeSession {
  userId: string;
  userName?: string;
  organizationId: string | null;
  channelIds: string[];
  supabase: { url: string; anonKey: string } | null;
  topics: {
    user: string;
    org: string | null;
    channels: Record<string, string>;
  };
}

/** Membro com a conversa aberta agora (Presence do tópico da conversa). */
export interface ConversationViewer {
  userId: string;
  name: string;
}

type JoinResult =
  | { ok: true; conversationId: string; topic: string }
  | { ok: false; conversationId: string; reason: string };

export interface Socket {
  readonly connected: boolean;
  on(event: string, handler: Handler): Socket;
  off(event: string, handler?: Handler): Socket;
  emit(event: string, data?: any): Socket;
  connect(): Socket;
  disconnect(): Socket;
}

const MAX_BACKOFF_MS = 30_000;

class RealtimeSocket implements Socket {
  private handlers = new Map<string, Set<Handler>>();
  private client: SupabaseClient | null = null;
  private clientKey: string | null = null;
  private session: RealtimeSession | null = null;
  /** tópico → canal assinado (usuário, org, canais e conversas). */
  private channels = new Map<string, RealtimeChannel>();
  private subscribed = new Set<string>();
  /** conversationId → tópico (salas de conversa ativas). */
  private conversations = new Map<string, string>();
  /** conversationId → quem está com ela aberta (último sync do Presence). */
  private viewers = new Map<string, ConversationViewer[]>();
  private _connected = false;
  private stopped = false;
  private starting: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  get connected(): boolean {
    return this._connected;
  }

  viewersOf(conversationId: string): ConversationViewer[] {
    return this.viewers.get(conversationId) ?? [];
  }

  on(event: string, handler: Handler): Socket {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return this;
  }

  off(event: string, handler?: Handler): Socket {
    if (!handler) this.handlers.delete(event);
    else this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, data?: any): Socket {
    switch (event) {
      case 'join:conversation':
        void this.joinConversation(data?.conversationId);
        break;
      case 'leave:conversation':
        void this.leaveConversation(data?.conversationId);
        break;
      case 'typing':
        if (data?.conversationId) {
          void api
            .post(`/realtime/conversations/${data.conversationId}/typing`, {
              isTyping: !!data.isTyping,
            })
            .catch(() => undefined);
        }
        break;
      default:
        console.warn(`[realtime] emit('${event}') não suportado`);
    }
    return this;
  }

  connect(): Socket {
    this.stopped = false;
    void this.start();
    return this;
  }

  disconnect(): Socket {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const ch of this.channels.values()) void this.client?.removeChannel(ch);
    this.channels.clear();
    this.subscribed.clear();
    this.conversations.clear();
    this.viewers.clear();
    this.setConnected(false, 'io client disconnect');
    return this;
  }

  // ─── internos ──────────────────────────────────────────────────────

  private dispatch(event: string, ...args: any[]) {
    for (const h of [...(this.handlers.get(event) ?? [])]) {
      try {
        h(...args);
      } catch (err) {
        console.error(`[realtime] handler de '${event}' falhou`, err);
      }
    }
  }

  private setConnected(value: boolean, reason?: string) {
    if (this._connected === value) return;
    this._connected = value;
    if (value) {
      this.attempts = 0;
      this.dispatch('connect');
      const s = this.session;
      this.dispatch('ready', {
        userId: s?.userId,
        organizationId: s?.organizationId,
        channelIds: s?.channelIds ?? [],
      });
    } else {
      this.dispatch('disconnect', reason ?? 'transport close');
    }
  }

  private start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        const { data } = await api.get('/realtime/session');
        if (this.stopped) return;
        this.session = data.data as RealtimeSession;
        this.syncTopics();
        this.checkHealthy();
      } catch (err: any) {
        if (this.stopped) return;
        // 401 sem refresh possível: o interceptor do axios já redireciona
        // para /login. Outros erros (rede, deploy): tenta de novo com backoff.
        this.setConnected(false, 'io server disconnect');
        this.scheduleRetry();
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  private scheduleRetry() {
    if (this.stopped || this.retryTimer) return;
    const delay = Math.min(1000 * 2 ** this.attempts, MAX_BACKOFF_MS);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, delay);
  }

  private ensureClient(): SupabaseClient | null {
    const cfg = this.session?.supabase;
    if (!cfg) return null;
    const key = `${cfg.url}|${cfg.anonKey}`;
    if (this.client && this.clientKey === key) return this.client;
    this.client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    this.clientKey = key;
    return this.client;
  }

  /** Tópicos que devem estar assinados agora (sessão + conversas abertas). */
  private desiredTopics(): Set<string> {
    const s = this.session;
    const topics = new Set<string>();
    if (!s) return topics;
    topics.add(s.topics.user);
    if (s.topics.org) topics.add(s.topics.org);
    for (const t of Object.values(s.topics.channels)) topics.add(t);
    for (const t of this.conversations.values()) topics.add(t);
    return topics;
  }

  private syncTopics() {
    const client = this.ensureClient();
    const desired = this.desiredTopics();
    for (const [topic, ch] of [...this.channels]) {
      if (desired.has(topic)) continue;
      this.channels.delete(topic);
      this.subscribed.delete(topic);
      void client?.removeChannel(ch);
    }
    if (!client) return;
    for (const topic of desired) {
      if (this.channels.has(topic)) continue;
      // Tópico de conversa também leva Presence: cada aba que abre a
      // conversa se anuncia, e o Supabase tira sozinho quem fechou/caiu.
      const conversationId = this.conversationIdOf(topic);
      const userId = this.session?.userId;
      const withPresence = !!(conversationId && userId);
      const ch = client
        .channel(topic, {
          config: {
            broadcast: { self: false, ack: false },
            ...(withPresence ? { presence: { key: userId } } : {}),
          },
        })
        .on('broadcast', { event: '*' }, (msg) => {
          if (msg.event === 'permissions:updated') void this.refreshSession();
          this.dispatch(msg.event, msg.payload);
        });
      if (withPresence) {
        ch.on('presence', { event: 'sync' }, () => {
          const state = ch.presenceState<{ name?: string }>();
          const list = Object.entries(state).map(([key, metas]) => ({
            userId: key,
            name: metas[0]?.name ?? '',
          }));
          this.viewers.set(conversationId!, list);
          this.dispatch('conversation:viewers', { conversationId, viewers: list });
        });
      }
      this.channels.set(topic, ch);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.subscribed.add(topic);
          if (withPresence) {
            void ch.track({ name: this.session?.userName ?? '' }).catch(() => undefined);
          }
        } else this.subscribed.delete(topic);
        this.checkHealthy();
      });
    }
  }

  private conversationIdOf(topic: string): string | null {
    for (const [id, t] of this.conversations) if (t === topic) return id;
    return null;
  }

  /**
   * "Conectado" = tópicos centrais (usuário + org) assinados. Uma queda do
   * websocket (rede, laptop dormindo) derruba todos juntos → `disconnect`;
   * quando o supabase-js reassina sozinho, voltamos a disparar `connect` +
   * `ready` — os consumidores usam esse segundo `ready` para refazer fetch
   * do que perderam. Tópicos de canal/conversa entrando e saindo (join,
   * permissões) não mexem nesse estado, como os rooms do socket.io.
   */
  private checkHealthy() {
    if (this.stopped || !this.session) return;
    if (!this.session.supabase) {
      // Realtime desligado no servidor: segue "pronto" para não travar joins.
      this.setConnected(true);
      return;
    }
    const core = [this.session.topics.user, this.session.topics.org].filter(
      (t): t is string => !!t,
    );
    const healthy = core.every((t) => this.subscribed.has(t));
    this.setConnected(healthy, 'transport close');
  }

  private async refreshSession() {
    try {
      const { data } = await api.get('/realtime/session');
      if (this.stopped) return;
      this.session = data.data as RealtimeSession;
      this.syncTopics();
    } catch {
      // mantém os tópicos atuais; o próximo reconnect tenta de novo
    }
  }

  private async joinConversation(conversationId?: string) {
    if (!conversationId) return;
    try {
      const { data } = await api.post(`/realtime/conversations/${conversationId}/join`);
      const result = data.data as JoinResult;
      if (!result.ok) {
        this.dispatch('join:conversation:error', {
          conversationId,
          reason: result.reason,
        });
        return;
      }
      this.conversations.set(conversationId, result.topic);
      this.syncTopics();
      this.dispatch('join:conversation:ack', { conversationId });
    } catch {
      this.dispatch('join:conversation:error', { conversationId, reason: 'request-failed' });
    }
  }

  private async leaveConversation(conversationId?: string) {
    if (!conversationId) return;
    this.conversations.delete(conversationId);
    this.viewers.delete(conversationId);
    this.syncTopics();
    await api.post(`/realtime/conversations/${conversationId}/leave`).catch(() => undefined);
  }
}

let socket: RealtimeSocket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = new RealtimeSocket();
  socket.connect();
  return socket;
}

/** Último estado conhecido do Presence da conversa (sem esperar o próximo sync). */
export function getConversationViewers(conversationId: string): ConversationViewer[] {
  return socket?.viewersOf(conversationId) ?? [];
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
