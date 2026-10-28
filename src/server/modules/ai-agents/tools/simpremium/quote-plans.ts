/** Pedido de outros planos além do ilimitado (cotação de chip). */

/**
 * O cliente pediu outros planos além do ilimitado? ("tem mais barato?",
 * "não precisa ser ilimitado", "e os planos com franquia?", "cheaper",
 * "other plans", "más barato"…). "ilimitado"/"unlimited" sozinhos não contam.
 */
export function asksForOtherPlans(text: string, obsPrice?: string | null): boolean {
  // Citou o valor da observação ("o plano de 38 reais", "what is the 38 reais plan").
  if (obsPrice && new RegExp(`(?:^|[^\\d])${obsPrice}(?:[.,]\\d+)?(?!\\d)`).test(text)) return true;
  return /mais barat|\bbarat|econ[oô]mic|outros? planos?|outras? op[cç]|\bfranquia|\blimitad|n[aã]o (?:precis|quer|necess)\w*[^.?!]{0,20}ilimitad|menos (?:dados|internet|gb)|\bcheap|other (?:plans?|options?)|\ballowance|\blimited\b|not unlimited|less data|m[aá]s barat|otros planes|otras opciones/i.test(
    text,
  );
}

/**
 * Valor "a partir de" da observação da última cotação do ilimitado (parte
 * inteira, ex.: "38"), em qualquer idioma — "Obs.: … à partir de R$ 38.54",
 * "Note: … starting from R$ 38.54". Mensagens da mais recente para a mais antiga.
 */
export function lastObsPrice(outboundNewestFirst: string[]): string | null {
  for (const t of outboundNewestFirst) {
    const m = t.match(/^(?:Obs|Note|Nota)\b[^\n]*?R\$\s*(\d+)/im);
    if (m) return m[1];
  }
  return null;
}

/**
 * O cliente quer fechar a compra aqui pelo WhatsApp ("quero fechar por aqui",
 * "pode ser pelo whats", "vou pagar no pix", "fechar aqui").
 */
export function wantsToCloseOnWhatsapp(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(n[ãa]o|nao)\s+(quero\s+)?(fechar|comprar|pagar)\b/.test(t)) return false;
  return (
    /\b(fechar|finalizar|comprar|pagar|contratar|fazer\s+o\s+pedido)\b[^.?!\n]{0,30}(por\s+aqui|\baqui\b|pelo\s+whats\w*|no\s+whats\w*|via\s+whats\w*|no\s+pix|pelo\s+pix|via\s+pix)/.test(t) ||
    /^\s*(por\s+aqui|aqui|pelo\s+whats\w*|whats\w*|pix|aqui\s+pelo\s+whats\w*)\s*[.!]?\s*$/.test(t)
  );
}

/**
 * Cliente pede para cobrir/igualar o preço de outra empresa ("Achei por 200",
 * "Consegue fazer esse valor?", "iguale sim"). Quem confere e decide é a
 * equipe de vendas — a IA não fecha a venda (PIX) nesse caso.
 */
const PRICE_MATCH_RE = new RegExp(
  [
    '\\b(achei|encontrei|vi)\\b[^.?!\\n]{0,40}\\b(por|a)\\s*(r\\$\\s*)?\\d+(?!\\s*(dias|gb|d\\b))',
    '\\b(cobr(e|ir|em)|igual(a|e|ar)|baix(a|ar|e)|faz(er|em)?|consegue)\\b[^.?!\\n]{0,30}\\b(pre[çc]o|valor|oferta)',
    '\\bigual(e|ar)\\b',
    'concorr[êe]n',
    'mais barat[oa] (em|na|no) (outr|concorr)',
  ].join('|'),
  'i',
);

export function asksPriceMatch(text: string): boolean {
  return PRICE_MATCH_RE.test(text);
}
