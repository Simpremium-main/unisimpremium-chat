import { KvStore } from '../../../../runtime/kv-store';
import { isRealCpf, orderIdentity, orderIds, phoneMatches, rawOrders } from './customer-orders.parse';

type Obj = Record<string, unknown>;

/**
 * A IA só mostra dados de pedido que são do cliente: o telefone DE COBRANÇA
 * do pedido bate com o WhatsApp da conversa, ou o CPF/e-mail que o cliente
 * informou bate com o de cobrança do pedido. Pedidos confirmados ficam marcados na conversa
 * (24h) e liberam as consultas por número (ativações, entrega, seguro).
 */

const VERIFIED_TTL_MS = 24 * 3_600_000;
// Criado no primeiro uso (importar não deve abrir conexão com o banco).
let kvStore: KvStore | null = null;
const kv = () => (kvStore ??= new KvStore());
const key = (conversationId: string) => `order-ok:${conversationId}`;

export async function verifiedOrders(conversationId: string): Promise<Set<string>> {
  const raw = await kv().get(key(conversationId)).catch(() => null);
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

export async function markVerified(conversationId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const set = await verifiedOrders(conversationId);
  ids.forEach((id) => set.add(normalizeId(id)));
  await kv().set(key(conversationId), JSON.stringify([...set]), { ttlMs: VERIFIED_TTL_MS }).catch(() => undefined);
}

/** "#142458", "Pedido 142458", "Peddio142458", "nº 142458" → "142458". */
export const normalizeId = (id: unknown) => {
  const s = String(id ?? '').replace(/^#/, '').trim();
  const num = /[a-zA-ZÀ-ú°º]/.test(s) ? s.match(/\d{3,}/) : null;
  return num ? num[0] : s;
};

const digits = (s: string) => s.replace(/\D/g, '');
const sameEmail = (a: string | null, b: unknown) =>
  !!a && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
const sameCpf = (a: string | null, b: unknown) =>
  !!a && typeof b === 'string' && isRealCpf(b) && digits(a) === digits(b);

export type OrderCheck =
  | { ok: true; output: unknown; verifiedIds: string[] }
  | { ok: false; output: { ok: false; guard: true; identidade_nao_confirmada: true; instrucao: string; pedido_de_revenda?: true } };

/**
 * Confere o retorno de `consultar_pedido` contra quem está na conversa,
 * sempre pelos dados de cobrança do pedido.
 */
/** E-mails, telefones e CPFs que o cliente informou (ferramenta + mensagens dele). */
export interface IdentityClaims {
  emails: string[];
  phones: string[];
  cpfs: string[];
  /** Número do chip (ICCID): 89 + 16 a 20 dígitos. */
  iccids: string[];
}

/** ICCID digitado (com ou sem espaços/traços). */
const ICCID_RE = /\b89(?:[\s-]?\d){16,20}\b/g;

/**
 * Pedido de revenda (distribuidor/agência): a compra foi feita pela revenda,
 * então e-mail/CPF/telefone são os dela, não os do cliente final.
 */
const RESELLER_VALUE_RE = /distribuid|ag[eê]ncia|agency|revend|reseller|parceir|partner|distributor/i;
const ORIGIN_KEYS = [
  'source', 'origin', 'origem', 'channel', 'canal', 'tipo', 'type', 'order_type', 'sales_channel',
  'customer_type', 'tipo_cliente', 'tipo_pedido', 'origem_pedido',
];
export function isResellerOrder(o: Obj): boolean {
  for (const k of ORIGIN_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && RESELLER_VALUE_RE.test(v)) return true;
  }
  for (const k of ['distributor', 'distribuidor', 'reseller', 'revenda', 'agency', 'agencia']) {
    const v = o[k];
    if (v && (typeof v !== 'object' || Object.keys(v as Obj).length > 0)) return true;
  }
  return false;
}

/** Todos os ICCIDs que aparecem num retorno do Pedido Central (em qualquer nível). */
export function iccidsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => iccidsIn(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Obj)) {
      if (/iccid/i.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        const d = String(v).replace(/\D/g, '');
        if (d.length >= 18) out.add(d);
      } else iccidsIn(v, out);
    }
  }
  return out;
}

const RESELLER_INSTRUCTION =
  'Este pedido é de REVENDA (distribuidor/agência): os dados de cobrança são da revenda, NÃO do cliente final. NÃO peça e-mail, telefone nem CPF. Peça o número do chip (ICCID): no chip físico ele fica na parte traseira do chip; no eSIM ele fica abaixo do QR Code enviado por e-mail. Depois chame consultar_pedido de novo com o orderId + iccid. NÃO informe nenhum dado do pedido até confirmar.';

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Sequência com 10+ dígitos (aceita +, espaços, parênteses, pontos e traços no meio). */
const DIGITS_RE = /\+?\d[\d\s().-]{8,}\d/g;

/**
 * Junta o que a IA passou na ferramenta com o que o próprio cliente escreveu
 * nas últimas mensagens: a IA às vezes chama só com o número do pedido e
 * esquece o e-mail que o cliente acabou de mandar.
 */
export function identityClaims(input: Record<string, unknown>, customerTexts: string[]): IdentityClaims {
  const claims: IdentityClaims = { emails: [], phones: [], cpfs: [], iccids: [] };
  const add = (list: string[], v: unknown) => {
    if (typeof v === 'string' && v.trim() && !list.includes(v.trim())) list.push(v.trim());
  };
  add(claims.emails, input.email);
  add(claims.phones, input.phone);
  add(claims.cpfs, input.cpf);
  for (const v of [input.iccid, ...customerTexts]) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    for (const m of String(v).match(ICCID_RE) ?? []) add(claims.iccids, m.replace(/\D/g, ''));
  }
  for (const text of customerTexts) {
    for (const m of text.match(EMAIL_RE) ?? []) add(claims.emails, m);
    for (const m of text.match(DIGITS_RE) ?? []) {
      const d = digits(m);
      if (d.length === 11 && isRealCpf(m)) add(claims.cpfs, m);
      if (d.length >= 10 && d.length <= 13) add(claims.phones, m);
    }
  }
  return claims;
}

export function checkOrderAccess(
  input: Record<string, unknown>,
  raw: unknown,
  conversationPhone: string | null,
  claims: IdentityClaims = identityClaims(input, []),
  /** ICCIDs do pedido vindos de outra consulta (ex.: ativações). */
  extraIccids: Iterable<string> = [],
): OrderCheck {
  const orders = rawOrders(raw);
  if (orders.length === 0) return { ok: true, output: raw, verifiedIds: [] };

  const known = new Set(extraIccids);
  const gaveIdentity = claims.emails.length + claims.phones.length + claims.cpfs.length > 0;
  const owned = orders.filter((o) => {
    const id = orderIdentity(o);
    const iccids = iccidsIn(o, new Set(known));
    // Pedido sem telefone/e-mail/CPF de cobrança não dá pra conferir: bloqueia.
    return (
      phoneMatches(id.phone, conversationPhone) ||
      claims.phones.some((p) => phoneMatches(id.phone, p)) ||
      claims.emails.some((e) => sameEmail(id.email, e)) ||
      claims.cpfs.some((c) => sameCpf(id.cpf, c)) ||
      claims.iccids.some((c) => iccids.has(c))
    );
  });

  if (owned.length === 0 && orders.every(isResellerOrder)) {
    return {
      ok: false,
      output: {
        ok: false,
        guard: true,
        identidade_nao_confirmada: true,
        pedido_de_revenda: true as const,
        instrucao: claims.iccids.length
          ? `${RESELLER_INSTRUCTION} O número do chip que o cliente informou NÃO confere com este pedido — peça para ele conferir o número (e o número do pedido).`
          : RESELLER_INSTRUCTION,
      },
    };
  }

  if (owned.length === 0) {
    return {
      ok: false,
      output: {
        ok: false,
        guard: true,
        identidade_nao_confirmada: true,
        instrucao: gaveIdentity
          ? 'O e-mail/telefone/CPF que o cliente informou NÃO confere com os dados de cobrança deste pedido. NÃO informe nenhum dado do pedido (nem status, datas ou produtos). Diga que esse dado não confere com o pedido e peça para o cliente conferir o número do pedido e o e-mail ou telefone usado na compra. Se ele insistir, chame escalar_para_humano (suporte).'
          : 'Este pedido NÃO está vinculado ao WhatsApp desta conversa. NÃO informe nenhum dado do pedido (nem status, datas ou produtos). Pergunte exatamente: "Para confirmar que o pedido é seu, pode me informar o e-mail ou telefone usado na compra?" e depois chame consultar_pedido de novo com o orderId + o e-mail, telefone ou CPF que o cliente informar.',
      },
    };
  }

  const verifiedIds = owned.flatMap(orderIds);
  if (typeof input.orderId === 'string' || typeof input.orderId === 'number') verifiedIds.push(String(input.orderId));
  return {
    ok: true,
    output: owned.length === orders.length ? raw : { pedidos: owned },
    verifiedIds: verifiedIds.map(normalizeId),
  };
}

/** Mensagem pra consultas por número de pedido ainda não confirmado. */
export const UNVERIFIED_ORDER_OUTPUT = {
  ok: false,
  guard: true,
  identidade_nao_confirmada: true,
  instrucao:
    'Este pedido ainda não foi confirmado como do cliente. Antes, chame pedidos_do_cliente (busca pelo WhatsApp) ou consultar_pedido com o número do pedido + CPF ou e-mail informado pelo cliente. NÃO informe nenhum dado deste pedido até confirmar.',
};

/** O que foi conferido — só para o log da execução (a IA não vê). */
export function orderAudit(orders: Obj[], claims: IdentityClaims, conversationPhone: string | null) {
  return {
    pedidos_encontrados: orders.map((o) => {
      const id = orderIdentity(o);
      const origin = ORIGIN_KEYS.map((k) => o[k]).find((v) => typeof v === 'string') ?? null;
      return {
        pedido: orderIds(o)[0] ?? null,
        origem: origin,
        revenda: isResellerOrder(o),
        email_cobranca: id.email,
        telefone_cobranca: id.phone,
        cpf_cobranca: id.cpf ? `***${id.cpf.replace(/\D/g, '').slice(-4)}` : null,
        iccids_no_pedido: iccidsIn(o).size,
      };
    }),
    informado_pelo_cliente: {
      emails: claims.emails,
      telefones: claims.phones,
      cpfs: claims.cpfs.map((c) => `***${c.replace(/\D/g, '').slice(-4)}`),
      iccids: claims.iccids,
    },
    whatsapp_da_conversa: conversationPhone,
  };
}
