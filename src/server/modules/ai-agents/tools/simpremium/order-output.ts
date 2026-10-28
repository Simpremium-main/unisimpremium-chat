/**
 * Retorno das consultas de pedido/ativação/entrega/seguro antes de ir pra IA:
 *  - sem identificadores internos (código de plano, operadora, ICCID…), em
 *    qualquer nível — a IA não tem como repetir o que não recebe;
 *  - cada período com início/fim ganha `situacao_hoje` já comparada com a
 *    data de hoje (a IA errava chamando data passada de "futura").
 */

/** Campos que nunca chegam à IA. */
const INTERNAL_KEYS = new Set([
  'plan', 'plan_name', 'planname', 'plan_code', 'plancode', 'plano_interno',
  'operator', 'operadora', 'operator_name', 'operatorname', 'carrier', 'supplier', 'fornecedor',
  'iccid', 'eid', 'imsi', 'msisdn_interno',
]);

/** Código interno de plano/operadora no meio de um texto ("TIM-EUROPA", "UDBAC-South…-1GB"). */
const INTERNAL_CODE_RE = /\b(?:TIM|CLARO|VIVO|OI|UDBAC|WM)-[\w.-]+(?:\s+[\w.-]+)*?(?=$|[,;)\]"]|\s{2})/g;

export function stripInternal<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripInternal) as T;
  if (typeof value === 'string') return value.replace(INTERNAL_CODE_RE, '[plano interno]') as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (INTERNAL_KEYS.has(k.toLowerCase())) continue;
    out[k] = stripInternal(v);
  }
  return out as T;
}

const START_KEYS = [
  'start_date', 'startDate', 'data_inicio', 'dataInicio', 'inicio', 'activation_date', 'activationDate',
  'data_ativacao', 'dataAtivacao', 'activation_start', 'activationStart', 'date_start',
];
const END_KEYS = [
  'end_date', 'endDate', 'data_fim', 'dataFim', 'fim', 'expiration_date', 'expirationDate',
  'data_expiracao', 'dataExpiracao', 'activation_end', 'activationEnd', 'date_end',
];

/** "2026-10-24", "2026-10-24T09:00", "24/10/2026" → "2026-10-24". */
export function isoDay(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Hoje no fuso da operação (o dia vira à meia-noite de São Paulo, não UTC). */
export function todayIso(now = new Date(), timeZone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const br = (iso: string) => iso.split('-').reverse().join('/');
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function activationStatus(start: string, end: string | null, today: string): string {
  if (today < start) {
    const n = daysBetween(today, start);
    return `AINDA NÃO COMEÇOU — começa em ${br(start)} (daqui a ${n} ${n === 1 ? 'dia' : 'dias'})`;
  }
  if (end && today > end) return `ENCERRADA — terminou em ${br(end)}`;
  const day = daysBetween(start, today) + 1;
  const total = end ? daysBetween(start, end) + 1 : null;
  return `EM USO HOJE — dia ${day}${total ? ` de ${total}` : ''}${end ? `, vai até ${br(end)}` : ''}`;
}

/** Hora atual em minutos do dia, no fuso da operação. */
export function minutesNow(now = new Date(), timeZone = 'America/Sao_Paulo'): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(now)
    .split(':')
    .map(Number);
  return h * 60 + m;
}

/** O eSIM sai no dia anterior à ativação, até as 10:59 (Brasília). */
export const ESIM_SEND_DEADLINE_MIN = 10 * 60 + 59;

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Pedido ainda "aguardando envio": se for eSIM, está no prazo (aguardar) ou
 * atrasado (suporte)? Calculado aqui — a IA mandava o cliente pro suporte às
 * 08:00 do dia do envio, que vai até as 10:59.
 */
export function esimSendStatus(start: string, today: string, minutes: number): string {
  const sendDay = addDays(start, -1);
  const deadline = `${br(sendDay)} até as 10:59 (horário de Brasília)`;
  const late = today > sendDay || (today === sendDay && minutes > ESIM_SEND_DEADLINE_MIN);
  if (late) {
    return `SE FOR eSIM: ATRASADO — deveria ter sido enviado em ${deadline} e o pedido ainda está aguardando envio. Chame escalar_para_humano (suporte) para verificarem o envio.`;
  }
  const when = today === sendDay ? `HOJE (${deadline})` : `em ${deadline}`;
  return `SE FOR eSIM: NO PRAZO — o QR Code será enviado por e-mail ${when}. Diga ao cliente para aguardar até esse horário e depois conferir a caixa de entrada e o spam. NÃO transfira e não ofereça transferir. Se for chip físico, ignore este campo.`;
}

/** Acrescenta `situacao_hoje` em todo objeto que tem data de início (e fim). */
export function annotateActivationDates<T>(value: T, today = todayIso(), minutes = minutesNow()): T {
  if (Array.isArray(value)) return value.map((v) => annotateActivationDates(v, today, minutes)) as T;
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = annotateActivationDates(v, today, minutes);
  const start = START_KEYS.map((k) => isoDay(obj[k])).find(Boolean);
  if (start) {
    const end = END_KEYS.map((k) => isoDay(obj[k])).find(Boolean) ?? null;
    out.situacao_hoje = activationStatus(start, end, today);
    if (typeof obj.status === 'string' && /aguardando/i.test(obj.status)) {
      out.envio_esim = esimSendStatus(start, today, minutes);
    }
  }
  return out as T;
}

/** Número da linha do chip de viagem (não o telefone de cobrança, que fica no pedido). */
const LINE_NUMBER_KEYS = new Set([
  'msisdn', 'msisdn_interno', 'numero_linha', 'numero_chip', 'numero_telefone', 'numero_do_chip',
  'phone_number', 'phonenumber', 'line_number', 'linha', 'numero',
]);

const digits = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : '');

/** Planos que vêm com número de telefone (os demais são só dados). */
const PLAN_WITH_NUMBER_RE = /\b(TIM|UNI|PREPAID)\b/i;
/** Planos TIM: o número da nossa linha é brasileiro (+55). */
const PLAN_BR_NUMBER_RE = /\bTIM\b/i;
/**
 * Planos PREPAID, TMOBILE ou UNI nos Estados Unidos: a troca manual de
 * operadora não vale (a linha é da própria operadora americana).
 */
const NO_MANUAL_NETWORK_PLAN_RE = /(^|[^A-Z])(PREPAID|T-?MOBILE|UNI)([^A-Z]|$)/i;
const US_DESTINATION_RE = /estados unidos|\bEUA\b|\bUSA\b|united states/i;
const OPERATOR_PLAN_KEYS = new Set(['operator', 'operadora', 'operator_name', 'operatorname', 'plan', 'plan_name', 'planname', 'plan_code', 'plancode']);

/**
 * Em cada ativação, `conferencia_chip` para a IA conferir o print do cliente
 * — antes de `stripInternal` tirar operadora, plano e ICCID:
 *  - `linha_tem_numero`: só planos TIM/UNI/PREPAID têm número; os demais, só dados;
 *  - `numero_brasileiro`: plano TIM — a nossa linha também é +55;
 *  - `iccid_final`: últimos dígitos do ICCID (o Pedido Central não manda o número);
 *  - `selecao_manual_operadora: false`: plano PREPAID/TMOBILE/UNI nos EUA, sem
 *    troca manual de operadora.
 */
export function withChipCheck<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withChipCheck) as T;
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let iccid = '';
  let line = '';
  const operatorPlan: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    out[k] = withChipCheck(v);
    const key = k.toLowerCase();
    if (!iccid && /iccid/.test(key) && digits(v).length >= 18) iccid = digits(v);
    if (!line && LINE_NUMBER_KEYS.has(key) && digits(v).length >= 8) line = digits(v);
    if (OPERATOR_PLAN_KEYS.has(key) && typeof v === 'string' && v.trim()) operatorPlan.push(v);
  }
  if (iccid || line || operatorPlan.length) {
    const op = operatorPlan.join(' ');
    const destination = typeof obj.destination === 'string' ? obj.destination : typeof obj.destino === 'string' ? obj.destino : '';
    const noManualNetwork = NO_MANUAL_NETWORK_PLAN_RE.test(op) && US_DESTINATION_RE.test(destination);
    out.conferencia_chip = {
      ...(operatorPlan.length || line ? { linha_tem_numero: !!line || PLAN_WITH_NUMBER_RE.test(op) } : {}),
      ...(PLAN_BR_NUMBER_RE.test(op) ? { numero_brasileiro: true } : {}),
      ...(line ? { numero_da_linha: line } : {}),
      ...(iccid ? { iccid_final: iccid.slice(-6) } : {}),
      ...(noManualNetwork ? { selecao_manual_operadora: false } : {}),
    };
  }
  return out as T;
}

/** Nomes dos campos das ativações (só para o log de auditoria — descobrir onde vem o número da linha). */
export function activationFieldNames(value: unknown, out = new Set<string>()): string[] {
  if (Array.isArray(value)) value.forEach((v) => activationFieldNames(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      if (v && typeof v === 'object') activationFieldNames(v, out);
    }
  }
  return [...out];
}

/** Tudo que volta do Pedido Central sobre pedido passa por aqui. */
export function prepareOrderOutput<T>(value: T, today = todayIso(), minutes = minutesNow()): T {
  return annotateActivationDates(stripInternal(value), today, minutes);
}

/** Operadora/plano de cada ativação (só para o log de auditoria). */
export function activationOperators(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => activationOperators(v, out));
  else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const op = [obj.operator, obj.plan].filter((v) => typeof v === 'string' && v).join(' / ');
    if (op) out.push(op);
    Object.values(obj).forEach((v) => v && typeof v === 'object' && activationOperators(v, out));
  }
  return out;
}

/** Períodos de ativação (início/fim) que aparecem num retorno de consultar_ativacoes. */
export function activationPeriods(value: unknown, out: Array<{ start: string; end: string | null }> = []) {
  if (Array.isArray(value)) value.forEach((v) => activationPeriods(v, out));
  else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const start = START_KEYS.map((k) => isoDay(obj[k])).find(Boolean);
    if (start) out.push({ start, end: END_KEYS.map((k) => isoDay(obj[k])).find(Boolean) ?? null });
    Object.values(obj).forEach((v) => v && typeof v === 'object' && activationPeriods(v, out));
  }
  return out;
}

export type OrderPeriodStatus = 'vigente' | 'futura' | 'encerrada' | 'sem_ativacao';

/** Situação de um pedido pelos períodos de ativação: vale o mais "vivo" deles. */
export function orderPeriodStatus(periods: Array<{ start: string; end: string | null }>, today: string): OrderPeriodStatus {
  if (!periods.length) return 'sem_ativacao';
  if (periods.some((p) => p.start <= today && (!p.end || p.end >= today))) return 'vigente';
  if (periods.some((p) => p.start > today)) return 'futura';
  return 'encerrada';
}

/**
 * Vários pedidos do cliente: só os com ativação vigente ou futura (e os sem
 * ativação cadastrada) vão para a IA — os encerrados ficam só como números,
 * para o caso de o cliente perguntar por eles. Todos encerrados → mantém todos.
 */
export function onlyCurrentOrders<T extends object>(
  orders: T[],
  idOf: (o: T) => string,
  periodsByOrder: Map<string, Array<{ start: string; end: string | null }>>,
  today: string,
): { kept: Array<T & { ativacao?: string }>; omitted: string[] } {
  const br = (iso: string) => iso.split('-').reverse().join('/');
  const tagged = orders.map((o) => {
    const periods = periodsByOrder.get(idOf(o)) ?? [];
    const status = orderPeriodStatus(periods, today);
    const p = periods.find((x) => x.start <= today && (!x.end || x.end >= today)) ?? periods[0];
    const ativacao = p ? `${br(p.start)}${p.end ? ` a ${br(p.end)}` : ''} (${status})` : undefined;
    return { order: { ...o, ...(ativacao ? { ativacao } : {}) }, status };
  });
  const current = tagged.filter((t) => t.status !== 'encerrada');
  if (current.length === 0) return { kept: tagged.map((t) => t.order), omitted: [] };
  return {
    kept: current.map((t) => t.order),
    omitted: tagged.filter((t) => t.status === 'encerrada').map((t) => idOf(t.order)),
  };
}

/** Pedido sem ativação cadastrada e mais velho que isto: o status não é confiável. */
const STALE_WITHOUT_ACTIVATION_DAYS = 60;

/**
 * Pedido de viagem anterior (ativação encerrada) ou antigo sem ativação: o
 * status no sistema pode estar errado ("aguardando-envio" de um pedido do
 * ano passado). Tira o status — a IA só informa status de ativação vigente
 * ou futura. Pedido sem consulta de ativação fica como está.
 */
export function hideStaleStatus<T extends object>(
  orders: T[],
  idOf: (o: T) => string,
  periodsByOrder: Map<string, Array<{ start: string; end: string | null }>>,
  today: string,
): { orders: T[]; hidden: string[] } {
  const hidden: string[] = [];
  const out = orders.map((o) => {
    const periods = periodsByOrder.get(idOf(o));
    if (!periods) return o;
    const st = orderPeriodStatus(periods, today);
    const rec = o as Record<string, unknown>;
    const created = isoDay(rec.date ?? rec.date_created ?? rec.created_at);
    const old = !!created && (Date.parse(today) - Date.parse(created)) / 86_400_000 > STALE_WITHOUT_ACTIVATION_DAYS;
    if (st !== 'encerrada' && !(st === 'sem_ativacao' && old)) return o;
    hidden.push(idOf(o));
    const { status: _status, ...rest } = rec;
    return {
      ...rest,
      situacao_pedido: st === 'encerrada' ? 'viagem anterior (ativação encerrada)' : 'pedido antigo, sem ativação cadastrada',
    } as T;
  });
  return { orders: out, hidden };
}

export const staleStatusNote = (hidden: string[]) =>
  `Pedido(s) ${hidden.join(', ')}: de viagem anterior ou antigo sem ativação — o status no sistema pode estar errado, NÃO informe o status. Diga só que é um pedido de uma viagem anterior. Se o cliente vai viajar de novo: o chip é de uso único, cada viagem precisa de um chip novo (faça a cotação).`;
