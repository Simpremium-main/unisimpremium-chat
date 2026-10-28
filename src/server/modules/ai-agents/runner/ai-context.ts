/**
 * "Limpar contexto da IA" de uma conversa: as mensagens continuam no
 * histórico para a equipe, mas a IA só lê o que veio depois deste instante
 * (gravado em `Conversation.metadata.aiContextResetAt`).
 */
export const AI_CONTEXT_RESET_KEY = 'aiContextResetAt';

export function aiContextResetAt(metadata: unknown): Date | null {
  const raw =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)[AI_CONTEXT_RESET_KEY]
      : null;
  const date = typeof raw === 'string' ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Filtro de mensagens que a IA pode ler nesta conversa. */
export function aiVisibleMessagesWhere(conversationId: string, metadata: unknown) {
  const since = aiContextResetAt(metadata);
  return { conversationId, ...(since ? { createdAt: { gt: since } } : {}) };
}
