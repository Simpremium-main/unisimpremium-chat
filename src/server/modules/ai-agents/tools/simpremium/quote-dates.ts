/**
 * Datas da viagem para a cotação: quando o cliente deu o período em datas
 * ("De 25/11 a 09/12"), a cotação mostra as datas, não só "(15 dias)".
 */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const fullYear = (y: string | undefined) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : null);

/** Dias da viagem contando a ida e a volta (25/11 a 09/12 = 15 dias). */
export function inclusiveDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

const RANGE_RE =
  /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2})(?!\d))?\s*(?:a|à|ao|at[ée]|-|–|to|al|hasta)\s*(?:o dia\s*|dia\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2})(?!\d))?/gi;

/** Todos os períodos "DD/MM a DD/MM" de um texto, com o ano deduzido (sempre de hoje em diante). */
export function dateRangesIn(text: string, today: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  const [ty] = today.split('-').map(Number);
  for (const m of text.matchAll(RANGE_RE)) {
    const [d1, m1, d2, m2] = [m[1], m[2], m[4], m[5]].map(Number);
    let y1 = fullYear(m[3]) ?? ty;
    if (!m[3] && iso(y1, m1, d1) < today) y1++;
    let y2 = fullYear(m[6]) ?? y1;
    if (!m[6] && iso(y2, m2, d2) < iso(y1, m1, d1)) y2++;
    if (!valid(y1, m1, d1) || !valid(y2, m2, d2)) continue;
    const start = iso(y1, m1, d1);
    const end = iso(y2, m2, d2);
    if (end < start) continue;
    out.push({ start, end });
  }
  return out;
}

/**
 * Período que o cliente escreveu e que bate com os dias da cotação.
 * `texts` do mais novo para o mais antigo; o primeiro que bate vale.
 */
export function tripDatesFor(texts: string[], days: number, today: string): { start: string; end: string } | null {
  if (!days) return null;
  for (const t of texts) {
    for (const r of dateRangesIn(t, today)) if (inclusiveDays(r.start, r.end) === days) return r;
  }
  return null;
}

/** "2026-11-25" → "25/11/2026". */
export const brDate = (isoDay: string) => isoDay.split('-').reverse().join('/');
