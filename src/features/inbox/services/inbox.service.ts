import { api } from '@/lib/api';
import type { ProjectSummary } from '@/features/projects/services/projects.service';

export interface TagRef {
  id: string;
  name: string;
  color: string;
}

export interface TagLink {
  tag: TagRef;
}

export interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  tags?: TagLink[];
}

export interface ChannelInfo {
  id: string;
  type: string;
  name: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Está em "Não respondidas": aberta, última mensagem do cliente e não tirada
 * de lá depois dela (metadata.unansweredDismissedAt).
 */
export function isUnanswered(
  conversation: Pick<Conversation, 'status' | 'metadata'>,
  last: { direction: string; createdAt: string } | null | undefined,
): boolean {
  if (!last || conversation.status === 'CLOSED' || last.direction !== 'INBOUND') return false;
  const dismissed = conversation.metadata?.unansweredDismissedAt;
  return typeof dismissed !== 'string' || new Date(last.createdAt) > new Date(dismissed);
}

export interface LastMessage {
  id: string;
  type: string;
  content: Record<string, any>;
  direction: 'INBOUND' | 'OUTBOUND';
  createdAt: string;
}

/** Nota interna da conversa (nunca vai pro cliente). */
export interface InternalNote {
  id: string;
  conversationId: string;
  authorType: 'USER' | 'AI';
  messageId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  agent: { id: string; name: string } | null;
}

export interface ConversationAiStatus {
  state: 'RUNNING' | 'QUEUED' | 'ACTIVE' | 'BLOCKED' | 'ERROR';
  reason: string;
  message: string;
  agent: { id: string; name: string } | null;
  runAt?: string;
  lastRun?: {
    status: string;
    finalAction: string | null;
    errorMessage: string | null;
    finishedAt: string | null;
  } | null;
}

export interface Conversation {
  id: string;
  organizationId: string;
  channelId: string;
  contactId: string;
  assignedToId: string | null;
  status: string;
  protocol: string | null;
  subject?: string | null;
  isGroup: boolean;
  isArchived?: boolean;
  archivedAt?: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  aiEnabled?: boolean | null;
  aiDisabledBy?: string | null;
  aiDisabledAt?: string | null;
  activeAgentId?: string | null;
  /** `aiContextResetAt`: a IA só lê as mensagens depois deste instante. */
  metadata?: { aiContextResetAt?: string } & Record<string, unknown>;
  /** Atendentes que responderam, do último pro primeiro (lista do inbox). */
  responderIds?: string[];
  /** IA ativa nesta conversa agora (responderia) — bolinha "IA" na lista. */
  aiActive?: boolean;
  contact: Contact;
  channel: ChannelInfo;
  assignedTo: AgentInfo | null;
  messages: LastMessage[];
  tags?: TagLink[];
  _count: { messages: number };
  /** Inbound messages newer than the current user's lastReadAt cursor. */
  unreadCount?: number;
  /** Projeto do grupo (quando isGroup). null = sem projeto ainda. */
  project?: ProjectSummary | null;
}

export interface MessageSender {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface StoryReplyContext {
  id?: string;
  url?: string;
  kind?: 'reply' | 'mention';
}

export interface ReplyContext {
  externalMessageId?: string;
  story?: StoryReplyContext;
  ad?: { id?: string; title?: string };
  /** ID interno da Message original — preenchido quando a reply foi
   *  criada pela nossa UI (botão "Responder"). Usado pelo MessageBubble
   *  pra fazer scroll/highlight da msg original ao clicar no quote. */
  messageId?: string;
  /** Trecho da msg original (até ~120 chars) — UI mostra como preview. */
  previewText?: string;
  /** Nome de quem enviou a msg original — UI mostra acima do preview. */
  senderName?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationMs?: number;
  provider: string;
  transcribedAt: string;
}

export interface MessageMetadata {
  isEcho?: boolean;
  replyTo?: ReplyContext | null;
  transcription?: TranscriptionResult | null;
  rawPayload?: any;
  [key: string]: any;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  content: Record<string, any>;
  externalId: string | null;
  status: string;
  /** Motivo do erro quando status=FAILED. Vem direto do provider WhatsApp.
   *  Ex.: "Re-engagement message" = janela 24h expirada → precisa template. */
  failedReason?: string | null;
  senderName: string | null;
  senderId: string | null;
  sender: MessageSender | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  metadata?: MessageMetadata | null;
  /** Quando setado, mensagem foi deletada pra todos. UI renderiza placeholder. */
  revokedAt?: string | null;
  revokedBy?: string | null;
  /** true = provider confirmou delete (cliente final viu sumir).
   *  false = só sumiu no nosso lado (provider não suportou). */
  revokeSucceededRemote?: boolean | null;
}

export interface PaginatedResponse<T> {
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * A Vercel limita o corpo de uma request a 4,5MB. Até este tamanho o
 * upload vai pelo multipart de sempre; acima, o arquivo sobe direto para o
 * Supabase Storage por URL assinada e a API só finaliza (mesmas validações).
 */
const MULTIPART_MAX_BYTES = 4 * 1024 * 1024;

interface UploadedFile {
  url: string;
  mimeType: string;
  size: number;
  filename: string;
}

/** Retorna null quando o servidor não tem storage remoto (usa o multipart). */
async function uploadDirect(
  kind: 'audio' | 'media',
  blob: Blob,
  filename: string,
): Promise<UploadedFile | null> {
  // Mesmo mimetype que o multipart enviaria para o servidor.
  const mimeType = blob.type || 'application/octet-stream';
  const { data } = await api.post('/messages/uploads/direct', {
    kind,
    mimeType,
    size: blob.size,
    filename,
  });
  const signed = data.data as { direct: boolean; path?: string; uploadUrl?: string };
  if (!signed.direct || !signed.path || !signed.uploadUrl) return null;

  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!put.ok) {
    throw new Error(`Falha ao enviar o arquivo (${put.status})`);
  }

  const { data: done } = await api.post(
    '/messages/uploads/direct/complete',
    { kind, path: signed.path, mimeType, filename },
    { timeout: 120000 },
  );
  return done.data;
}

/** Pedidos do contato no Pedido Central, achados pelo telefone. */
export interface CustomerOrders {
  status: 'found' | 'not-found' | 'no-phone' | 'not-configured' | 'error';
  phone: string | null;
  tried: string[];
  customer: { name: string | null; email: string | null; cpf: string | null; phone: string | null } | null;
  orders: Array<{
    id: string;
    status: string | null;
    date: string | null;
    total: string | null;
    items: Array<{
      name: string;
      quantity: number | null;
      total: string | null;
      sku: string | null;
      /** Variação escolhida: plano, dias, franquia… */
      variants: Array<{ label: string; value: string }>;
    }>;
    raw: Record<string, unknown>;
  }>;
  message?: string;
  fetchedAt: string;
}

/**
 * Ações em lote em grupos de 3: disparar todas de uma vez esgotava as
 * conexões com o banco (500 em tudo e logout).
 */
export interface BulkResult {
  ok: number;
  failed: Array<{ id: string; message: string }>;
}

async function inBatches(ids: string[], fn: (id: string) => Promise<unknown>, size = 3): Promise<BulkResult> {
  const result: BulkResult = { ok: 0, failed: [] };
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    const settled = await Promise.allSettled(chunk.map(fn));
    settled.forEach((r, j) => {
      if (r.status === 'fulfilled') result.ok++;
      else result.failed.push({ id: chunk[j], message: (r.reason as Error)?.message ?? 'erro' });
    });
  }
  return result;
}

export interface QuickQuoteInput {
  countries: string[];
  chipType: 'virtual' | 'physical';
  days?: number;
  startDate?: string;
  endDate?: string;
  franquiaApenas?: boolean;
  discountPercent?: number;
}

export const inboxService = {
  /** Cotação de chip pronta para o atendente enviar — não aciona a IA. */
  async quickQuote(id: string, input: QuickQuoteInput): Promise<{ messages: string[] }> {
    const { data } = await api.post(`/conversations/${id}/quick-quote`, input);
    return data.data;
  },

  async getCustomerOrders(id: string, refresh = false): Promise<CustomerOrders> {
    const { data } = await api.get(`/conversations/${id}/orders`, { params: refresh ? { refresh: 1 } : undefined });
    return data.data;
  },

  async getConversations(params?: Record<string, string>): Promise<{
    conversations: Conversation[];
    pagination: any;
  }> {
    const { data } = await api.get('/conversations', { params });
    return data.data;
  },

  async listNotes(conversationId: string): Promise<InternalNote[]> {
    const { data } = await api.get(`/conversations/${conversationId}/notes`);
    return data.data;
  },

  async createNote(
    conversationId: string,
    payload: { content: string; messageId?: string },
  ): Promise<InternalNote> {
    const { data } = await api.post(`/conversations/${conversationId}/notes`, payload);
    return data.data;
  },

  async updateNote(conversationId: string, noteId: string, content: string): Promise<InternalNote> {
    const { data } = await api.patch(`/conversations/${conversationId}/notes/${noteId}`, { content });
    return data.data;
  },

  async deleteNote(conversationId: string, noteId: string): Promise<void> {
    await api.delete(`/conversations/${conversationId}/notes/${noteId}`);
  },

  /** O que a IA está fazendo na conversa (ou por que não vai responder). */
  async getAiStatus(id: string): Promise<ConversationAiStatus> {
    const { data } = await api.get(`/conversations/${id}/ai-status`);
    return data.data;
  },

  async getConversation(id: string): Promise<Conversation> {
    const { data } = await api.get(`/conversations/${id}`);
    return data.data;
  },

  async getMessages(conversationId: string, page = 1, limit = 50): Promise<{
    messages: Message[];
    pagination: any;
  }> {
    const { data } = await api.get('/messages', {
      params: { conversationId, page, limit },
    });
    return data.data;
  },

  async sendMessage(payload: {
    conversationId: string;
    type: string;
    content: Record<string, any>;
    /** ID interno da Message respondida — backend resolve externalId. */
    replyToMessageId?: string;
    /** Nome da assinatura "*Nome:*"; null = sem assinatura. */
    signatureName?: string | null;
  }): Promise<Message> {
    const { data } = await api.post('/messages', payload);
    return data.data;
  },

  /**
   * Inicia uma conversa ativa com um contato (que pode nunca ter tido
   * histórico) e manda a primeira mensagem. Instagram não é suportado
   * (política da Meta não permite DM a frio) — backend retorna 400.
   */
  async startConversation(payload: {
    channelId: string;
    contact: { phone?: string; email?: string; name?: string };
    message: { type: 'TEXT' | 'TEMPLATE'; content: Record<string, any> };
    /** Só relevante pra Gmail — vira o assunto do email. */
    subject?: string;
  }): Promise<Message> {
    const { data } = await api.post('/conversations', payload);
    return data.data;
  },

  /**
   * Deleta mensagem pra todos. Tenta propagar pro provider. Resposta indica
   * se o provider aceitou (cliente final viu sumir) ou se foi só local.
   */
  async revokeMessage(messageId: string): Promise<{
    messageId: string;
    revokedAt: string;
    revokedBy: string;
    succeededRemote: boolean;
    remoteError: string | null;
  }> {
    const { data } = await api.delete(`/messages/${messageId}`);
    return data.data ?? data;
  },

  async assignToMe(conversationId: string): Promise<Conversation> {
    const { data } = await api.post(`/conversations/${conversationId}/assign-me`);
    return data.data;
  },

  /**
   * Atribui (ou desatribui com null) a conversa pra um user da org.
   * Usa o endpoint genérico de update que aceita assignedToId.
   */
  async assignTo(
    conversationId: string,
    assignedToId: string | null,
  ): Promise<Conversation> {
    const { data } = await api.patch(`/conversations/${conversationId}`, {
      assignedToId,
    });
    return data.data;
  },

  async closeConversation(conversationId: string): Promise<Conversation> {
    const { data } = await api.post(`/conversations/${conversationId}/close`);
    return data.data;
  },

  async markAsRead(
    conversationId: string,
    lastReadMessageId?: string,
  ): Promise<{ ok: boolean; lastReadAt: string }> {
    const { data } = await api.post(`/conversations/${conversationId}/read`, {
      lastReadMessageId,
    });
    return data.data ?? data;
  },

  async markAsUnread(
    conversationId: string,
  ): Promise<{ ok: boolean; unreadCount: number }> {
    const { data } = await api.post(`/conversations/${conversationId}/unread`);
    return data.data ?? data;
  },

  async reopenConversation(conversationId: string): Promise<Conversation> {
    const { data } = await api.post(`/conversations/${conversationId}/reopen`);
    return data.data;
  },

  async syncConversation(
    conversationId: string,
  ): Promise<{ imported: number; fetched: number; syncedAt: string }> {
    const { data } = await api.post(`/conversations/${conversationId}/sync`, {});
    return data.data;
  },

  async toggleAi(
    conversationId: string,
    enabled: boolean | null,
  ): Promise<Conversation> {
    const { data } = await api.patch(`/conversations/${conversationId}/ai`, {
      enabled,
    });
    return data.data ?? data;
  },

  async engageAi(
    conversationId: string,
  ): Promise<{ engaged: boolean; reason?: string }> {
    const { data } = await api.post(
      `/conversations/${conversationId}/ai/engage`,
    );
    return data.data ?? data;
  },

  /** Reiniciar (teste, só admin): conversa volta a ser nova para a IA e o robô. */
  /**
   * "Sugerir resposta": a mensagem que a IA mandaria agora (pode consultar
   * pedido e cotação — leva alguns segundos). Não envia nada.
   */
  async draftAiReply(
    conversationId: string,
    body: { extraInfo?: string; useHistory?: boolean },
  ): Promise<{ text: string; agentName: string }> {
    const { data } = await api.post(`/conversations/${conversationId}/ai/draft`, body, { timeout: 120_000 });
    return data.data ?? data;
  },

  /** Tira a conversa de "Não respondidas" até o cliente mandar mensagem nova. */
  async dismissUnanswered(conversationId: string): Promise<{ ok: true; unansweredDismissedAt: string }> {
    const { data } = await api.post(`/conversations/${conversationId}/dismiss-unanswered`);
    return data.data ?? data;
  },

  /** Atendente mandou a cotação: a IA cobra o retorno em 2h e continua a conversa. */
  async handoffQuoteToAi(conversationId: string): Promise<{ ok: true; quoteMessageId: string }> {
    const { data } = await api.post(`/conversations/${conversationId}/ai/quote-handoff`);
    return data.data ?? data;
  },

  async restartAi(conversationId: string): Promise<{ ok: true; resetAt: string }> {
    const { data } = await api.post(`/conversations/${conversationId}/ai/restart`);
    return data.data ?? data;
  },

  /** IA passa a ler só as mensagens novas e esquece o que aprendeu sobre o contato. */
  async resetAiContext(
    conversationId: string,
  ): Promise<{ ok: true; resetAt: string; memoriesCleared: number }> {
    const { data } = await api.post(`/conversations/${conversationId}/ai/reset-context`);
    return data.data ?? data;
  },

  async setActiveAgent(
    conversationId: string,
    agentId: string,
  ): Promise<{ engaged: boolean; reason?: string; agentName?: string }> {
    const { data } = await api.post(
      `/conversations/${conversationId}/ai/set-agent`,
      { agentId },
    );
    return data.data ?? data;
  },

  async getStatusCounts(): Promise<Record<string, number>> {
    const { data } = await api.get('/conversations/counts');
    return data.data;
  },

  async bulkClose(ids: string[]): Promise<BulkResult> {
    return inBatches(ids, (id) => api.post(`/conversations/${id}/close`));
  },

  async bulkAssignToMe(ids: string[]): Promise<BulkResult> {
    return inBatches(ids, (id) => api.post(`/conversations/${id}/assign-me`));
  },

  async bulkReopen(ids: string[]): Promise<BulkResult> {
    return inBatches(ids, (id) => api.post(`/conversations/${id}/reopen`));
  },

  async bulkSetAi(ids: string[], enabled: boolean | null): Promise<BulkResult> {
    return inBatches(ids, (id) => api.patch(`/conversations/${id}/ai`, { enabled }));
  },

  async bulkEngageAi(ids: string[]): Promise<BulkResult> {
    return inBatches(ids, (id) => api.post(`/conversations/${id}/ai/engage`));
  },

  async updateConversation(
    conversationId: string,
    patch: { subject?: string | null },
  ): Promise<Conversation> {
    const { data } = await api.patch(`/conversations/${conversationId}`, patch);
    return data.data ?? data;
  },

  async renameContact(contactId: string, name: string): Promise<void> {
    await api.patch(`/contacts/${contactId}`, { name });
  },

  async archive(conversationId: string): Promise<Conversation> {
    const { data } = await api.post(`/conversations/${conversationId}/archive`);
    return data.data;
  },

  async unarchive(conversationId: string): Promise<Conversation> {
    const { data } = await api.post(`/conversations/${conversationId}/unarchive`);
    return data.data;
  },

  async resolveMediaUrl(messageId: string): Promise<{ url: string; mimeType?: string }> {
    const { data } = await api.get(`/messages/${messageId}/media`);
    return data.data;
  },

  async transcribeAudio(messageId: string, force = false): Promise<TranscriptionResult> {
    // NOTE: body must be {} (not null) — express.json({ strict: true }) rejects
    // literal "null" with "Unexpected token 'n', \"null\" is not valid JSON".
    const { data } = await api.post(`/messages/${messageId}/transcribe`, {}, {
      params: force ? { force: 'true' } : undefined,
    });
    return data.data;
  },

  async uploadAudio(blob: Blob, filename = 'audio.webm'): Promise<{
    url: string;
    mimeType: string;
    size: number;
  }> {
    if (blob.size > MULTIPART_MAX_BYTES) {
      const direct = await uploadDirect('audio', blob, filename);
      if (direct) return direct;
    }
    const form = new FormData();
    form.append('file', blob, filename);
    const { data } = await api.post('/messages/uploads/audio', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data.data;
  },

  async sendAudioMessage(conversationId: string, blob: Blob): Promise<Message> {
    const upload = await this.uploadAudio(blob);
    return this.sendMessage({
      conversationId,
      type: 'AUDIO',
      content: {
        mediaUrl: upload.url,
        mimeType: upload.mimeType,
        fileSize: upload.size,
      },
    });
  },

  async uploadMedia(file: File): Promise<{
    url: string;
    mimeType: string;
    size: number;
    filename: string;
  }> {
    if (file.size > MULTIPART_MAX_BYTES) {
      const direct = await uploadDirect('media', file, file.name);
      if (direct) return direct;
    }
    const form = new FormData();
    form.append('file', file, file.name);
    const { data } = await api.post('/messages/uploads/media', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Upload de arquivo grande estoura o timeout default de 15s do client.
      timeout: 120000,
    });
    return data.data;
  },

  /**
   * Anexo do chat (clipe de papel): sobe o arquivo e envia como
   * IMAGE/VIDEO/DOCUMENT conforme o mime. Áudio gravado no app NÃO passa
   * por aqui (sendAudioMessage transcoda pra voice note).
   */
  async sendMediaMessage(
    conversationId: string,
    file: File,
    caption?: string,
    signatureName?: string | null,
  ): Promise<Message> {
    const upload = await this.uploadMedia(file);
    const mime = upload.mimeType || file.type || '';
    const type = mime.startsWith('image/')
      ? 'IMAGE'
      : mime.startsWith('video/')
        ? 'VIDEO'
        : 'DOCUMENT';
    return this.sendMessage({
      conversationId,
      type,
      content: {
        mediaUrl: upload.url,
        mimeType: mime,
        fileSize: upload.size,
        fileName: upload.filename || file.name,
        ...(caption ? { caption } : {}),
      },
      signatureName,
    });
  },
};
