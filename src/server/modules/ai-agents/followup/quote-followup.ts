/**
 * Cobrança de retorno depois da cotação: regras puras (sem banco).
 *
 * 1. A IA mandou a cotação e o cliente não respondeu (ou respondeu sem
 *    recusar: "vou verificar", "depois retorno"): 2h depois da última
 *    mensagem, a cobrança.
 * 2. Ainda sem resposta 12h depois da cobrança: mensagem de encerramento e o
 *    atendimento é encerrado.
 * Só entre 10:00 e 17:59 de Brasília; fora disso, fica para a próxima abertura.
 * Prazos e horário são os padrões; cada organização pode mudar em
 * Configurações → Cobrança de cotação (quoteFollowupSettings).
 */

/**
 * Prazos e horários da cobrança (Configurações → Cobrança de cotação, em
 * `Organization.settings.quoteFollowup`). Sem configuração, os padrões.
 */
export interface QuoteFollowupSettings {
  enabled: boolean;
  /** Da última mensagem até a cobrança. */
  followupDelayHours: number;
  /** Da cobrança ao encerramento, sem resposta do cliente. */
  closeDelayHours: number;
  /** Horário de envio (Brasília): de `windowStartHour`:00 até antes de `windowEndHour`:00. */
  windowStartHour: number;
  windowEndHour: number;
}

export const QUOTE_FOLLOWUP_SETTINGS_KEY = 'quoteFollowup';
export const DEFAULT_QUOTE_FOLLOWUP_SETTINGS: QuoteFollowupSettings = {
  enabled: true,
  followupDelayHours: 2,
  closeDelayHours: 12,
  windowStartHour: 10,
  windowEndHour: 18,
};
export const QUOTE_FOLLOWUP_LIMITS = {
  followupDelayHours: { min: 1, max: 48 },
  closeDelayHours: { min: 1, max: 72 },
} as const;

/** Configuração da organização (settings.quoteFollowup), com os padrões e os limites aplicados. */
export function quoteFollowupSettings(orgSettings: unknown): QuoteFollowupSettings {
  const raw = ((orgSettings ?? {}) as Record<string, unknown>)[QUOTE_FOLLOWUP_SETTINGS_KEY] as
    | Partial<QuoteFollowupSettings>
    | undefined;
  const d = DEFAULT_QUOTE_FOLLOWUP_SETTINGS;
  const int = (v: unknown, def: number, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : def;
  const start = int(raw?.windowStartHour, d.windowStartHour, 0, 23);
  const end = int(raw?.windowEndHour, d.windowEndHour, 1, 24);
  const window = start < end ? { windowStartHour: start, windowEndHour: end } : { windowStartHour: d.windowStartHour, windowEndHour: d.windowEndHour };
  const lim = QUOTE_FOLLOWUP_LIMITS;
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : d.enabled,
    followupDelayHours: int(raw?.followupDelayHours, d.followupDelayHours, lim.followupDelayHours.min, lim.followupDelayHours.max),
    closeDelayHours: int(raw?.closeDelayHours, d.closeDelayHours, lim.closeDelayHours.min, lim.closeDelayHours.max),
    ...window,
  };
}

/** Padrões (para quem ainda lê as constantes). */
export const FOLLOWUP_DELAY_MS = DEFAULT_QUOTE_FOLLOWUP_SETTINGS.followupDelayHours * 3_600_000;
export const CLOSE_DELAY_MS = DEFAULT_QUOTE_FOLLOWUP_SETTINGS.closeDelayHours * 3_600_000;
/** Passou desse atraso sem enviar (deploy, fila parada): não manda mais. */
export const FOLLOWUP_MAX_LATE_MS = 2 * 3_600_000;
const TIME_ZONE = 'America/Sao_Paulo';

/** `Conversation.metadata[QUOTE_HANDOFF_KEY]`: cotação do atendente passada para a IA cobrar. */
export const QUOTE_HANDOFF_KEY = 'quoteHandoff';
export interface QuoteHandoff {
  messageId: string;
  at: string;
}

/** Mensagens da cobrança (o fluxo `cobranca-cotacao` em Jarvis → Fluxos, se existir, substitui). */
export const FOLLOWUP_FLOW_SLUG = 'cobranca-cotacao';
export const DEFAULT_FOLLOWUP_MESSAGES = [
  'Ficou alguma dúvida sobre a cotação acima?\nVamos fechar o pedido?',
  'Lembrando que ao comprar conosco você terá *Suporte 24hs* por dia em Português, além de já chegar no destino conectado, não perdendo tempo da sua viagem procurando um chip no destino.\nAh, e *cobrimos oferta da concorrência*.',
];

/** Encerramento sem retorno (o fluxo `encerramento-cotacao`, se existir, substitui). */
export const CLOSE_FLOW_SLUG = 'encerramento-cotacao';
export const DEFAULT_CLOSE_MESSAGES = [
  'Como não tivemos retorno, vamos encerrar este atendimento por aqui. Se quiser dar sequência, é só nos chamar novamente por este WhatsApp. Estamos à disposição!',
];

/** Texto de cotação: preço em dólar e em reais ("USD 28.90 / R$ 162.71"). */
export function isQuoteText(text: string): boolean {
  return /USD\s?\d[\d.,]*\s*\/\s*R\$\s?\d/.test(text);
}

/** O cliente recusou ou encerrou a compra. */
const DECLINE_RE = new RegExp(
  [
    'n[ãa]o,?\\s+(?:quero|vou\\s+querer|tenho\\s+interesse|preciso|vou\\s+precisar|vou\\s+comprar|obrigad)',
    'sem\\s+interesse',
    'desist',
    'j[áa]\\s+comprei',
    'comprei\\s+(?:em\\s+)?outr',
    'achei\\s+(?:muito\\s+)?caro',
    'muito\\s+caro',
    'fora\\s+do\\s+(?:meu\\s+)?or[çc]amento',
    'deixa\\s+(?:pra|para)\\s+l[áa]',
    'n[ãa]o\\s+vou\\s+mais\\s+viajar',
    'cancel',
    "no\\s+thanks|not\\s+interested|no\\s+gracias",
  ].join('|'),
  'i',
);

export function isDecline(text: string): boolean {
  return DECLINE_RE.test(text);
}

function brazilHour(d: Date): { hour: number; ymd: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { hour: Number(get('hour')), ymd: `${get('year')}-${get('month')}-${get('day')}` };
}

/** Dentro do horário de cobrança (padrão 10:00–17:59 de Brasília)? */
export function inFollowupWindow(d: Date, cfg: QuoteFollowupSettings = DEFAULT_QUOTE_FOLLOWUP_SETTINGS): boolean {
  const { hour } = brazilHour(d);
  return hour >= cfg.windowStartHour && hour < cfg.windowEndHour;
}

/** Leva o horário para dentro da janela: antes do início → início; depois do fim → início do dia seguinte. */
export function toFollowupWindow(due: Date, cfg: QuoteFollowupSettings = DEFAULT_QUOTE_FOLLOWUP_SETTINGS): Date {
  if (inFollowupWindow(due, cfg)) return due;
  const { hour, ymd } = brazilHour(due);
  const opening = new Date(`${ymd}T${String(cfg.windowStartHour).padStart(2, '0')}:00:00-03:00`);
  return hour < cfg.windowStartHour ? opening : new Date(opening.getTime() + 24 * 3_600_000);
}

/** Quando cobrar: N horas depois da última mensagem, dentro da janela. (Brasília é UTC-3, sem horário de verão.) */
export function followupDueAt(lastActivity: Date, cfg: QuoteFollowupSettings = DEFAULT_QUOTE_FOLLOWUP_SETTINGS): Date {
  return toFollowupWindow(new Date(lastActivity.getTime() + cfg.followupDelayHours * 3_600_000), cfg);
}

/** Quando encerrar: N horas depois da cobrança, dentro da janela. */
export function closeDueAt(followupAt: Date, cfg: QuoteFollowupSettings = DEFAULT_QUOTE_FOLLOWUP_SETTINGS): Date {
  return toFollowupWindow(new Date(followupAt.getTime() + cfg.closeDelayHours * 3_600_000), cfg);
}

export interface FollowupMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
  createdAt: Date;
  /** Enviada pela IA (metadata.aiAgentId). */
  aiAgentId?: string | null;
  /** Enviada pelo robô de atendimento. */
  fromChatbot?: boolean;
}

export type FollowupDecision =
  | { send: true; stage: 'cobranca' | 'encerramento'; quoteId: string; agentId: string; dueAt: Date }
  | { send: false; reason: string };

/** O que já saiu para esta cotação (guardado no kv; a cobrança também é achada pelo texto). */
export interface FollowupState {
  followupAt?: Date | null;
  closedAt?: Date | null;
}

/**
 * Decide o que mandar agora. `messages` em ordem cronológica.
 * Só cotações da IA (ou a do atendente passada para a IA).
 */
export function decideFollowup(
  messages: FollowupMessage[],
  now: Date,
  stateOf: (quoteId: string) => FollowupState,
  handoff?: QuoteHandoff | null,
  fallbackAgentId?: string | null,
  cfg: QuoteFollowupSettings = DEFAULT_QUOTE_FOLLOWUP_SETTINGS,
): FollowupDecision {
  const real = messages.filter((m) => !m.fromChatbot);
  let qi = -1;
  for (let i = real.length - 1; i >= 0; i--) {
    const m = real[i];
    // Cotação da IA, ou a do atendente que ele passou para a IA cobrar.
    if (m.direction === 'OUTBOUND' && isQuoteText(m.text) && (m.aiAgentId || m.id === handoff?.messageId)) {
      qi = i;
      break;
    }
  }
  if (qi < 0) return { send: false, reason: 'sem-cotacao' };
  const quote = real[qi];
  const state = stateOf(quote.id);
  if (state.closedAt) return { send: false, reason: 'ja-encerrado' };
  const agentId = quote.aiAgentId ?? fallbackAgentId;
  if (!agentId) return { send: false, reason: 'sem-agente' };

  const after = real.slice(qi + 1);
  // Atendente humano falou depois da cotação (ou depois de passar para a
  // IA): ele conduz. Mensagens dele antes de passar para a IA não contam.
  const handoffAt = handoff?.messageId === quote.id ? Date.parse(handoff.at) : NaN;
  const humanAfter = after.some(
    (m) => m.direction === 'OUTBOUND' && !m.aiAgentId && !(m.createdAt.getTime() <= handoffAt),
  );
  if (humanAfter) return { send: false, reason: 'humano' };
  if (after.some((m) => m.direction === 'INBOUND' && isDecline(m.text))) return { send: false, reason: 'recusou' };

  const last = real[real.length - 1];
  // Última mensagem é do cliente: a IA responde (não é hora de cobrar).
  if (last.direction === 'INBOUND') return { send: false, reason: 'cliente-falou-por-ultimo' };

  // Cobrança já enviada? (kv, ou pelo texto se o kv se perdeu)
  const firstLine = DEFAULT_FOLLOWUP_MESSAGES[0].split('\n')[0];
  const followupAt =
    state.followupAt ??
    after.find((m) => m.direction === 'OUTBOUND' && m.text.includes(firstLine))?.createdAt ??
    null;

  let stage: 'cobranca' | 'encerramento';
  let dueAt: Date;
  if (!followupAt) {
    stage = 'cobranca';
    dueAt = followupDueAt(last.createdAt, cfg);
  } else {
    // O cliente respondeu à cobrança: a conversa seguiu, nada de encerrar.
    if (after.some((m) => m.direction === 'INBOUND' && m.createdAt > followupAt)) {
      return { send: false, reason: 'respondeu-a-cobranca' };
    }
    stage = 'encerramento';
    dueAt = closeDueAt(followupAt, cfg);
  }
  if (now < dueAt) return { send: false, reason: 'ainda-nao' };
  if (now.getTime() - dueAt.getTime() > FOLLOWUP_MAX_LATE_MS) return { send: false, reason: 'atrasado-demais' };
  if (!inFollowupWindow(now, cfg)) return { send: false, reason: 'fora-do-horario' };
  return { send: true, stage, quoteId: quote.id, agentId, dueAt };
}
