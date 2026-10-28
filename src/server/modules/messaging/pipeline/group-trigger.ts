/**
 * Em grupo de WhatsApp a IA não responde toda mensagem: só quando é com
 * ela. Vale quando a mensagem:
 *  - menciona o número conectado (@número);
 *  - responde (cita) uma mensagem enviada por nós;
 *  - traz um número de pedido ou fala de pedido/status/entrega/rastreio.
 */

/** Número de pedido: 4 a 8 dígitos soltos ("#142458", "pedido 142458"). */
const ORDER_NUMBER_RE = /(?:^|[^\d])#?\d{4,8}(?:[^\d]|$)/;

const ORDER_WORDS_RE =
  /\b(pedidos?|status|rastrei[oa]|rastreamento|rastrear|entregas?|entregue|enviad[oa]s?|despachad[oa]s?|ativa[çc][ãa]o|ativad[oa])\b/i;

/** Telefone, CEP, CPF e datas também têm 4+ dígitos — não contam como pedido. */
const NOT_ORDER_RE = /\d{2}\/\d{2}|\d{5}-\d{3}|\d{3}\.\d{3}|\(\d{2}\)|\+\d{2}/;

export interface GroupTriggerInput {
  text: string;
  /** Payload cru do provedor (Zappfy), pra achar as menções. */
  rawPayload?: unknown;
  /** Dígitos do número conectado (dono da instância). */
  ownNumber?: string | null;
  /** A mensagem cita uma mensagem que nós enviamos. */
  repliesToUs?: boolean;
}

export function groupShouldTrigger(input: GroupTriggerInput): boolean {
  if (input.repliesToUs) return true;
  const own = digits(input.ownNumber ?? '');
  if (own.length >= 8) {
    if (mentionedNumbers(input.rawPayload).some((n) => sameTail(n, own))) return true;
    if (new RegExp(`@\\d*${own.slice(-8)}(?!\\d)`).test(digitsInMentions(input.text))) return true;
  }
  const text = input.text ?? '';
  if (ORDER_WORDS_RE.test(text)) return true;
  return ORDER_NUMBER_RE.test(text) && !NOT_ORDER_RE.test(text);
}

/** Número conectado no payload do Zappfy (`owner`, `owner.id`, `"5511…@s.whatsapp.net"`). */
export function ownerNumber(rawPayload: unknown): string | null {
  const p = rawPayload as Record<string, any> | null;
  const owner = p?.owner?.id ?? p?.owner ?? p?.message?.owner ?? null;
  const d = typeof owner === 'string' ? digits(owner.split('@')[0].split(':')[0]) : '';
  return d.length >= 8 ? d : null;
}

/** Números citados em qualquer campo `mentioned*` do payload. */
export function mentionedNumbers(rawPayload: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number, inMention: boolean) => {
    if (depth > 8 || v == null) return;
    if (typeof v === 'string') {
      if (inMention) out.push(digits(v.split('@')[0].split(':')[0]));
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1, inMention));
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        walk(x, depth + 1, inMention || /mention/i.test(k));
      }
    }
  };
  walk(rawPayload, 0, false);
  return out.filter((n) => n.length >= 8);
}

const digits = (s: string) => s.replace(/\D/g, '');
const sameTail = (a: string, b: string) => a.slice(-8) === b.slice(-8);
/** "@55 11 99999-0000" → "@5511999990000" (só pra comparar menções no texto). */
const digitsInMentions = (text: string) => (text ?? '').replace(/@[\d\s()+-]+/g, (m) => `@${digits(m)}`);
