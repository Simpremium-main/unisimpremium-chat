/**
 * Push pro celular quando uma conversa entra ou recebe mensagem nas inboxes
 * "Não respondidas", "IA para Humano" ou "IA Aguardando".
 *
 * Quem muda a conversa (mensagem do cliente, fim de run da IA, robô
 * passando pro humano) só enfileira este job; o processador decide se ela
 * está numa dessas inboxes para cada usuário. Debounce por conversa:
 * rajada de mensagens (ou mensagem + transferência da IA logo em seguida)
 * vira um push só.
 */
export const INBOX_PUSH_QUEUE = 'inbox-push';
export const INBOX_PUSH_DEBOUNCE_MS = 5_000;

export interface InboxPushJobData {
  organizationId: string;
  conversationId: string;
}

export function inboxPushJob(organizationId: string, conversationId: string) {
  return {
    name: 'inbox-push',
    data: { organizationId, conversationId } satisfies InboxPushJobData,
    opts: {
      delay: INBOX_PUSH_DEBOUNCE_MS,
      deduplication: {
        id: `inbox-push:${conversationId}`,
        ttl: INBOX_PUSH_DEBOUNCE_MS,
        extend: true,
        replace: true,
      },
      removeOnComplete: true,
      removeOnFail: { age: 86_400, count: 1_000 },
    },
  } as const;
}
