import { KvStore } from '../../../runtime/kv-store';

/**
 * Chave da sessão do robô (fluxo de chatbot) de uma conversa. Exportada à
 * parte pra IA e o envio humano saberem se o robô está conduzindo a
 * conversa sem depender do módulo do chatbot.
 */
export const CHATBOT_SESSION_PREFIX = 'bot:session:';

export const chatbotSessionKey = (conversationId: string) =>
  `${CHATBOT_SESSION_PREFIX}${conversationId}`;

/** Conversas (destas) com o robô ativo agora. */
export async function conversationsWithActiveChatbot(
  kv: KvStore,
  conversationIds: string[],
): Promise<Set<string>> {
  const keys = await kv.existingKeys(conversationIds.map(chatbotSessionKey));
  return new Set([...keys].map((k) => k.slice(CHATBOT_SESSION_PREFIX.length)));
}

/** Todas as conversas com o robô ativo agora (poucas — sessões expiram em 24h). */
export async function allConversationsWithActiveChatbot(kv: KvStore): Promise<string[]> {
  const keys = await kv.keysWithPrefix(CHATBOT_SESSION_PREFIX);
  return keys.map((k) => k.slice(CHATBOT_SESSION_PREFIX.length));
}

/**
 * Marca do fluxo concluído na conversa (`conversation.metadata.chatbot`):
 * impede o robô de recomeçar no mesmo atendimento. Limpa ao encerrar.
 */
export interface ChatbotCompletion {
  flowId: string | null;
  completedAt: string;
  handoff: 'AI' | 'HUMAN';
  /** Quem encerrou: o próprio fluxo, um atendente que respondeu, ou "Engajar IA". */
  reason: 'flow' | 'human-replied' | 'engaged-ai';
  /** Nome do fluxo e o que o cliente escolheu nos menus (contexto pra IA). */
  flowName?: string;
  choices?: ChatbotChoice[];
}

/** Uma escolha do cliente num menu do robô. */
export interface ChatbotChoice {
  question: string;
  answer: string;
}

export function chatbotCompletion(metadata: unknown): ChatbotCompletion | null {
  const c = (metadata as { chatbot?: unknown } | null)?.chatbot;
  return c && typeof c === 'object' && (c as ChatbotCompletion).completedAt ? (c as ChatbotCompletion) : null;
}
