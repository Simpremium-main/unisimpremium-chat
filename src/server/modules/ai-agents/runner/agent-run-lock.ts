/**
 * Uma conversa, um run de agente por vez. Compartilhado entre o fluxo de
 * mensagens (debounce) e o runner — que também é chamado direto pelo
 * watchdog e por "ativar agente" no inbox.
 *
 *  - lock     `ai:agent-run:lock:<conv>` (SET NX PX)
 *  - followup `ai:agent-run:followup:<conv>`: chegou mensagem durante o run;
 *    quem terminar o run re-arma o debounce pra responder tudo de uma vez.
 */
export const AGENT_DEBOUNCE_MS = 10_000;
export const RUN_LOCK_TTL_MS = 15 * 60_000;
export const FOLLOWUP_TTL_MS = 60 * 60_000;

export const runLockKey = (conversationId: string) => `ai:agent-run:lock:${conversationId}`;
export const followupKey = (conversationId: string) => `ai:agent-run:followup:${conversationId}`;

/** Job do debounce (fila AGENT_DEBOUNCE_QUEUE): cada mensagem nova reinicia o timer. */
export function debouncedRunJob(conversationId: string, triggerMessageId: string) {
  return {
    name: 'debounced-run',
    data: { conversationId, triggerMessageId },
    opts: {
      delay: AGENT_DEBOUNCE_MS,
      deduplication: {
        id: `agent-run:${conversationId}`,
        ttl: AGENT_DEBOUNCE_MS,
        extend: true,
        replace: true,
      },
      removeOnComplete: true,
      removeOnFail: { age: 86_400, count: 1_000 },
    },
  } as const;
}

/** Última mensagem que a IA ignorou por parecer spam/ruído (id da mensagem). */
export const spamSkipKey = (conversationId: string) => `ai:spam-skip:${conversationId}`;
