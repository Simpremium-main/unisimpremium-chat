/**
 * Fila do debounce do agente de IA: um job atrasado por conversa,
 * deduplicado (extend + replace) — cada mensagem nova reinicia o timer.
 */
export const AGENT_DEBOUNCE_QUEUE = 'ai-agent-debounce';
