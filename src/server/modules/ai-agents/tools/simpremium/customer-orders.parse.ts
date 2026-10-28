/**
 * Leitura das respostas do Pedido Central para "pedidos deste telefone".
 *
 * O formato exato de `consultar_cliente`/`consultar_pedido` não é fixo
 * (WooCommerce cru, lista embrulhada em `data`/`orders`, objeto único…),
 * então os campos são procurados pelos nomes mais comuns e o JSON original
 * vai junto pra tela mostrar o que não foi reconhecido.
 */

export interface CustomerSummary {
  name: string | null;
  email: string | null;
  cpf: string | null;
  phone: string | null;
}

export interface OrderSummary {
  id: string;
  status: string | null;
  date: string | null;
  total: string | null;
  items: OrderItem[];
  raw: unknown;
}

export interface OrderItem {
  name: string;
  quantity: number | null;
  total: string | null;
  sku: string | null;
  /** Variação escolhida: plano, dias, franquia, tamanho… */
  variants: Array<{ label: string; value: string }>;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

/** Primeiro valor preenchido entre os caminhos ("billing.email"). */
function pick(o: Obj, paths: string[]): string | null {
  for (const path of paths) {
    let cur: unknown = o;
    for (const key of path.split('.')) cur = isObj(cur) ? cur[key] : undefined;
    const v = str(cur);
    if (v) return v;
  }
  return null;
}

/** Lista dentro da resposta: o próprio array, ou o primeiro campo de lista conhecido. */
export function listFrom(raw: unknown, keys: string[]): Obj[] {
  if (Array.isArray(raw)) return raw.filter(isObj);
  if (!isObj(raw)) return [];
  for (const key of keys) {
    const v = raw[key];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const inner = listFrom(v, keys);
      if (inner.length) return inner;
    }
  }
  return [];
}

/** Resposta de "não achei" (vazia, erro ou só mensagem). */
function looksEmpty(o: Obj): boolean {
  const keys = Object.keys(o);
  if (keys.length === 0) return true;
  if (o.found === false || o.success === false) return true;
  return keys.every((k) => ['error', 'message', 'mensagem', 'erro', 'result', 'success', 'found'].includes(k));
}

const CUSTOMER_LIST_KEYS = ['customers', 'clientes', 'cliente', 'customer', 'data', 'results', 'result', 'items'];
const ORDER_LIST_KEYS = ['orders', 'pedidos', 'data', 'results', 'result', 'items'];

export function parseCustomers(raw: unknown): CustomerSummary[] {
  const list = listFrom(raw, CUSTOMER_LIST_KEYS);
  const objs = list.length ? list : isObj(raw) && !looksEmpty(raw) ? [raw] : [];
  return objs
    .map((o) => {
      const first = pick(o, ['first_name', 'billing.first_name']);
      const last = pick(o, ['last_name', 'billing.last_name']);
      return {
        name: pick(o, ['name', 'nome', 'full_name', 'fullName']) ?? ([first, last].filter(Boolean).join(' ') || null),
        email: pick(o, ['email', 'billing.email', 'e_mail', 'mail']),
        cpf: pick(o, ['cpf', 'document', 'documento', 'billing.cpf', 'billing_cpf', 'meta.cpf']),
        phone: pick(o, ['phone', 'telefone', 'celular', 'whatsapp', 'billing.phone', 'billing.cellphone']),
      };
    })
    .filter((c) => c.email || c.cpf || c.name);
}

/** Pedidos que vierem dentro da resposta do cliente (alguns servidores já mandam). */
export function embeddedOrders(raw: unknown): Obj[] {
  for (const c of [raw, ...listFrom(raw, CUSTOMER_LIST_KEYS)]) {
    if (!isObj(c)) continue;
    for (const key of ['orders', 'pedidos']) {
      if (Array.isArray(c[key])) return (c[key] as unknown[]).filter(isObj);
    }
  }
  return [];
}

export function parseOrders(raw: unknown): OrderSummary[] {
  const list = listFrom(raw, ORDER_LIST_KEYS);
  const objs = list.length ? list : isObj(raw) && !looksEmpty(raw) ? [raw] : [];
  const orders = objs
    .map((o): OrderSummary | null => {
      const id = pick(o, ['number', 'id', 'order_id', 'orderId', 'numero', 'order_number', 'pedido']);
      if (!id) return null;
      return {
        id,
        status: pick(o, ['status_label', 'status_name', 'statusName', 'status', 'situacao']),
        date: pick(o, ['date_created', 'dateCreated', 'created_at', 'createdAt', 'date', 'data', 'data_pedido']),
        total: pick(o, ['total', 'valor', 'valor_total', 'amount', 'total_amount']),
        items: orderItems(o),
        raw: o,
      };
    })
    .filter((o): o is OrderSummary => !!o);
  // Mais recente primeiro; sem data vai pro fim.
  return orders.sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0));
}

function orderItems(o: Obj): OrderItem[] {
  for (const key of ['line_items', 'items', 'produtos', 'products', 'itens']) {
    const v = o[key];
    if (Array.isArray(v)) {
      return v
        .map((it): OrderItem | null => {
          if (!isObj(it)) {
            const name = str(it);
            return name ? { name, quantity: null, total: null, sku: null, variants: [] } : null;
          }
          const name = pick(it, ['name', 'nome', 'product_name', 'productName', 'title', 'produto']);
          if (!name) return null;
          const qty = Number(pick(it, ['quantity', 'quantidade', 'qty', 'qtd']));
          return {
            name,
            quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
            total: pick(it, ['total', 'subtotal', 'valor', 'price', 'preco']),
            sku: pick(it, ['sku', 'codigo']),
            variants: itemVariants(it),
          };
        })
        .filter((it): it is OrderItem => !!it);
    }
  }
  const single = pick(o, ['product', 'produto', 'product_name', 'plano', 'plan_name']);
  return single ? [{ name: single, quantity: null, total: null, sku: null, variants: [] }] : [];
}

/**
 * Variações do item: `meta_data` do WooCommerce (dias, plano, franquia…),
 * lista/mapa de atributos, ou o nome da variação. Campos internos ("_algo")
 * e valores que não são texto ficam de fora.
 */
function itemVariants(it: Obj): OrderItem['variants'] {
  const out: OrderItem['variants'] = [];
  const add = (label: unknown, value: unknown) => {
    const l = str(label);
    const v = typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : str(value);
    if (!l || !v || l.startsWith('_')) return;
    const nice = humanLabel(l);
    if (!out.some((x) => x.label === nice && x.value === v)) out.push({ label: nice, value: v });
  };
  const fromEntries = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const e of v) {
        if (isObj(e)) {
          add(e.display_key ?? e.name ?? e.label ?? e.attribute ?? e.key, e.display_value ?? e.option ?? e.value);
        }
      }
    } else if (isObj(v)) {
      for (const [k, val] of Object.entries(v)) add(k, val);
    }
  };
  for (const key of ['meta_data', 'meta', 'attributes', 'atributos', 'variation', 'variacao', 'variant', 'variante', 'options', 'opcoes']) {
    const v = it[key];
    if (typeof v === 'string') add('Variação', v);
    else fromEntries(v);
  }
  const variationName = pick(it, ['variation_name', 'variant_name', 'variacao_nome']);
  if (variationName) add('Variação', variationName);
  return out;
}

/** "pa_franquia-de-dados" → "Franquia de dados". */
function humanLabel(key: string): string {
  const clean = key.replace(/^(attribute_)?pa_/, '').replace(/^attribute_/, '').replace(/[_-]+/g, ' ').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Formatos em que o número do WhatsApp pode estar no Pedido Central. Ordem:
 * o mais comum no cadastro de loja brasileira primeiro (DDD + número).
 */
export function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];
  const out: string[] = [];
  const add = (v: string) => v && !out.includes(v) && out.push(v);
  const br = digits.startsWith('55') && (digits.length === 12 || digits.length === 13);
  if (br) {
    const national = digits.slice(2);
    const ddd = national.slice(0, 2);
    const number = national.slice(2);
    // Celular com e sem o nono dígito (cadastros antigos e o WhatsApp divergem).
    const with9 = number.length === 8 ? `9${number}` : number;
    const without9 = number.length === 9 && number.startsWith('9') ? number.slice(1) : number;
    add(`${ddd}${with9}`);
    add(digits.length === 13 ? digits : `55${ddd}${with9}`);
    add(`(${ddd}) ${with9.slice(0, with9.length - 4)}-${with9.slice(-4)}`);
    add(`${ddd}${without9}`);
  } else {
    add(digits);
    add(`+${digits}`);
  }
  return out;
}

/** Mesmo número? Compara os últimos 8 dígitos (ignora DDI, DDD e o nono dígito). */
export function samePhone(a: string | null, b: string): boolean {
  if (!a) return true; // servidor não devolveu o telefone: confia na busca
  const tail = (s: string) => s.replace(/\D/g, '').slice(-8);
  return tail(a).length === 8 && tail(a) === tail(b);
}

/**
 * Telefone, e-mail e CPF de COBRANÇA do pedido (pra conferir a identidade).
 * Só dados do próprio pedido: `billing.*` (WooCommerce) ou os campos que o
 * Pedido Central já manda no pedido (email/phone/cpf) — nunca o cadastro do
 * usuário (customer.*, cliente.*) nem o endereço de entrega.
 */
export function orderIdentity(o: Obj): { phone: string | null; email: string | null; cpf: string | null } {
  const cpf = pick(o, ['billing.cpf', 'billing_cpf', 'billing.document', 'cobranca.cpf', 'cpf', 'document', 'documento']);
  return {
    phone: pick(o, [
      'billing.phone', 'billing_phone', 'billing.cellphone', 'cobranca.telefone',
      'phone', 'telefone', 'celular', 'whatsapp',
    ]),
    email: pick(o, ['billing.email', 'billing_email', 'cobranca.email', 'email']),
    cpf: cpf && isRealCpf(cpf) ? cpf : null,
  };
}

/** "000.000.000-00" e afins são preenchimento, não CPF. */
export function isRealCpf(value: string): boolean {
  const d = value.replace(/\D/g, '');
  return d.length === 11 && !/^(\d)\1{10}$/.test(d);
}

/** Os dois números são o mesmo (últimos 8 dígitos; os dois precisam existir). */
export function phoneMatches(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const tail = (s: string) => s.replace(/\D/g, '').slice(-8);
  return tail(a).length === 8 && tail(a) === tail(b);
}

/** Pedidos (objetos crus) dentro de uma resposta do Pedido Central. */
export function rawOrders(raw: unknown): Obj[] {
  const list = listFrom(raw, ORDER_LIST_KEYS);
  const objs = list.length ? list : isObj(raw) && !looksEmpty(raw) ? [raw] : [];
  // Só o que tem número de pedido ({success, data: []} não é pedido).
  return objs.filter((o) => orderIds(o).length > 0);
}

/** Identificadores de um pedido (número e id costumam diferir no WooCommerce). */
export function orderIds(o: Obj): string[] {
  return ['number', 'id', 'order_id', 'orderId', 'numero', 'order_number', 'pedido']
    .map((k) => str(o[k]))
    .filter((v): v is string => !!v);
}
