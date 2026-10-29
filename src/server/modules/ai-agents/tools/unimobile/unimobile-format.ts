/**
 * Leitura e limpeza das respostas da API Uni Mobile antes de irem para a
 * IA: status em português, datas em dd/mm/aaaa e, em grupo, sem dados do
 * titular nem códigos de instalação.
 */

type Obj = Record<string, unknown>;

export const STATUS_PT: Record<string, { status: string; explicacao: string }> = {
  pendiente: { status: 'pendente', explicacao: 'Ainda não ativada. Ativa na data de início; se a data de início for hoje ou ontem, pode ser ativada agora.' },
  pendente: { status: 'pendente', explicacao: 'Ainda não ativada. Ativa na data de início; se a data de início for hoje ou ontem, pode ser ativada agora.' },
  activado: { status: 'ativa', explicacao: 'Linha ativa e em uso.' },
  activo: { status: 'ativa', explicacao: 'Linha ativa e em uso.' },
  extendido: { status: 'ativa (prorrogada)', explicacao: 'Linha ativa com plano prorrogado.' },
  baja: { status: 'encerrada', explicacao: 'Linha encerrada (fim da validade ou baixa).' },
  cancelado: { status: 'cancelada', explicacao: 'Pedido cancelado.' },
};

export function statusPt(raw: unknown): { status: string; explicacao: string; status_api: string | null } {
  const api = typeof raw === 'string' ? raw.trim() : '';
  const known = STATUS_PT[api.toLowerCase()];
  return { status: known?.status ?? (api || 'desconhecido'), explicacao: known?.explicacao ?? '', status_api: api || null };
}

/** ICCID: 89 + 17 a 18 dígitos (19-20 no total), com sufixo V/F opcional. */
export const ICCID_RE = /^89\d{17,18}[VF]?$/;

export function normalizeIccid(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9VF]/g, '');
}

export const isFullIccid = (value: unknown) => ICCID_RE.test(normalizeIccid(value));

const br = (ymd: unknown) =>
  typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? ymd.slice(0, 10).split('-').reverse().join('/') : null;

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dias e franquia pelo código da tarifa ("EUR_017D_ILIM_SODA_UNIG_ESIM"). */
export function parseTariff(sku: unknown): { zona: string | null; dias: number | null; franquia: string | null; tipo: string | null } {
  const m = /^([A-Z]+)_(\d{3})D_([A-Z0-9]+)_.*_(ESIM|CHIP)$/.exec(String(sku ?? ''));
  if (!m) return { zona: null, dias: null, franquia: null, tipo: null };
  return { zona: m[1], dias: Number(m[2]), franquia: m[3] === 'ILIM' ? 'Ilimitado' : m[3], tipo: m[4] };
}

/** Linha do `ordersList` (quando houver) somada ao `iccidDetail`. */
export function describeLine(
  detail: Obj | null,
  listed: Obj | null,
  opts: { group: boolean },
): Obj {
  const esim = (Array.isArray(detail?.esim) ? (detail!.esim as Obj[])[0] : null) ?? {};
  const client = (Array.isArray(detail?.['client data']) ? (detail!['client data'] as Obj[])[0] : null) ?? {};
  const iccid = String(detail?.iccid ?? listed?.iccId ?? '');
  const st = statusPt(detail?.status ?? listed?.status);
  const sku = listed?.tariff ?? null;
  const t = parseTariff(sku);
  const init = typeof listed?.init_date === 'string' ? listed.init_date : null;
  const out: Obj = {
    iccid,
    status: st.status,
    status_explicacao: st.explicacao,
    _status_api: st.status_api,
    plano: (client.tariff as string) ?? sku ?? null,
    codigo_tarifa: sku,
    dias: t.dias,
    franquia: t.franquia,
    tipo: t.tipo,
    inicio: br(init),
    fim_previsto: init && t.dias ? br(addDays(init, t.dias - 1)) : null,
    _data_inicio: init,
    numero: (esim.number as string) ?? null,
    // Pendente com início hoje ou ontem: dá para ativar agora (uni_ativar_linha).
    pode_ativar_agora: st.status === 'pendente' && init ? canActivateNow(init) : null,
  };
  if (!opts.group) {
    out.titular = (client.name as string) ?? (listed?.name as string) ?? null;
    out.email_titular = (client.email as string) ?? (listed?.email as string) ?? null;
    out.instalacao = {
      link_iphone: (esim.iosQuickInstall as string) ?? null,
      codigo_lpa: (esim.lpaCode as string) ?? null,
    };
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== undefined));
}

/** Data de início é hoje ou ontem (regra do activateLine). */
export function canActivateNow(initDate: string, now = new Date().toISOString().slice(0, 10)): boolean {
  return initDate.slice(0, 10) === now || initDate.slice(0, 10) === addDays(now, -1);
}

/** Tira preço (custo do distribuidor) de planos e pacotes. */
export function withoutPrices<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutPrices) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Obj = {};
  for (const [k, v] of Object.entries(value as Obj)) {
    if (/^(price|currency|preco|valor)$/i.test(k)) continue;
    out[k] = withoutPrices(v);
  }
  return out as T;
}

const semAcento = (t: unknown) =>
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Zonas que cobrem o destino (país em qualquer idioma, ISO ou nome da zona). */
export function zonesCovering(zones: Obj[], destino: string): Obj[] {
  const alvo = semAcento(destino);
  if (!alvo) return [];
  return zones.filter((z) => {
    const names = [z.zone_code, z.zone_name_br, z.zone_name_es, z.zone_name_en].map(semAcento);
    if (names.includes(alvo)) return true;
    const countries = Array.isArray(z.countries_data) ? (z.countries_data as Obj[]) : [];
    return countries.some((c) => [c.country_br, c.country_es, c.country_en, c.iso_code].map(semAcento).includes(alvo));
  });
}
