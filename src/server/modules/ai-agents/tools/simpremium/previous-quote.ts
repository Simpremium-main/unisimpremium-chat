/**
 * Cotação enviada antes ao cliente (em qualquer conversa dele), lida do
 * texto: o cliente volta dias depois com "atualiza esse orçamento" e a IA
 * só enxerga a conversa atual.
 */

export interface PreviousQuote {
  paises: string[];
  /** "29/10/2026 - 07/11/2026" quando a cotação tinha as datas. */
  datas: string | null;
  /** Início da viagem (AAAA-MM-DD), para saber se já passou. */
  inicio: string | null;
  dias: number | null;
  tipo: 'virtual' | 'physical' | null;
  desconto_percent: number | null;
  /** Cupom citado na cotação ("com o cupom *MINHAVIAGEM*"); desconto de atendente vem sem cupom. */
  cupom: string | null;
  ilimitado: boolean;
}

const line = (text: string, label: RegExp) => {
  const m = new RegExp(`\\*(?:${label.source}):?\\*:?\\s*(.+)`, 'i').exec(text);
  return m ? m[1].trim() : null;
};

export function parseQuote(text: string): PreviousQuote {
  const paisesRaw = line(text, /Pa[íi]ses de Cobertura/) ?? line(text, /Countries/) ?? '';
  const paises = paisesRaw
    .split(/\s*,\s*|\s+e\s+|\s+and\s+|\s+y\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const periodo = line(text, /Per[íi]odo da viagem/) ?? line(text, /Trip period/) ?? '';
  const dates = /(\d{2}\/\d{2}(?:\/\d{4})?)\s*-\s*(\d{2}\/\d{2}(?:\/\d{4})?)/.exec(periodo);
  const dias = /\((\d+)\s*(dias|days|d[íi]as)\)/i.exec(periodo);
  let inicio: string | null = null;
  if (dates) {
    const [d, m, y] = dates[1].split('/');
    if (y) inicio = `${y}-${m}-${d}`;
  }
  const desconto = /(\d+)%\s*(de desconto|off|de descuento)/i.exec(text);
  const incluso = line(text, /Inclu[íi]?so|Included|Incluido/) ?? '';
  return {
    paises,
    datas: dates ? `${dates[1]} - ${dates[2]}` : null,
    inicio,
    dias: dias ? Number(dias[1]) : null,
    tipo: /chip-virtual/i.test(text) ? 'virtual' : /chip-fisico/i.test(text) ? 'physical' : null,
    desconto_percent: desconto ? Number(desconto[1]) : null,
    cupom: /(?:cupom|coupon|cup[óo]n)\s*\*?([A-Z0-9_-]{3,})\*?/i.exec(text)?.[1] ?? null,
    ilimitado: /ilimitad|unlimited/i.test(incluso),
  };
}
