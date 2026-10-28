/**
 * Idioma em que o cliente escreve, por palavras comuns (sem chamar IA).
 * Português é o padrão: só troca com evidência clara de inglês ou espanhol.
 */
export type CustomerLanguage = 'pt' | 'en' | 'es';

export const LANGUAGE_NAMES: Record<Exclude<CustomerLanguage, 'pt'>, { pt: string; en: string }> = {
  en: { pt: 'inglês', en: 'English' },
  es: { pt: 'espanhol', en: 'Spanish' },
};

const WORDS: Record<CustomerLanguage, Set<string>> = {
  pt: new Set(
    'não nao você voce vocês olá ola oi obrigado obrigada quero preciso tenho pedido está estou meu minha uma um com para pra por favor bom boa dia tarde noite isso como qual quando onde porque tudo bem sim chip viagem funciona ainda já também muito'.split(' '),
  ),
  en: new Set(
    'the and you your is are am i my me have has how what when where why hello hi hey please thanks thank need want can could would does do did with for order not it this that there here will just phone trip working work yes no got buy bought'.split(' '),
  ),
  es: new Set(
    'el la los las y es usted hola gracias quiero necesito tengo pedido está estoy mi mis una un con para por favor buenos buenas días tardes noches esto cómo como cuál cuando dónde porque todo bien sí viaje funciona todavía ya también muy puedo'.split(' '),
  ),
};

/**
 * Pedido explícito: "podemos fazer isso em inglês?", "can we speak in English",
 * "¿puede atenderme en español?". Precisa de um verbo de pedido perto — "o site
 * está em inglês" não troca o idioma.
 */
const ASK = '(?:fazer|falar|fala|atend\\w*|continuar|podemos|pode|poderia|conversar|respond\\w*|escrev\\w*|seguir|speak|talk|continue|chat|write|reply|answer|hablar|habla|seguir|puede|podemos|escribir)';
const near = (target: string) => new RegExp(`\\b${ASK}\\b[^.?!\\n]{0,40}\\b(?:em|in|en)\\s+${target}`, 'i');
const REQUESTS: Array<[RegExp, CustomerLanguage]> = [
  [near('(?:ingl[eê]s|english|ingl[eé]s)\\b'), 'en'],
  [near('(?:espanhol|español|espanol|spanish)\\b'), 'es'],
  [near('(?:portugu[eê]s|portuguese|portugu[eé]s)\\b'), 'pt'],
];

/** Idioma pedido explicitamente pelo cliente (o pedido mais recente vale). */
export function requestedLanguage(textsOldestFirst: string[]): CustomerLanguage | null {
  for (let i = textsOldestFirst.length - 1; i >= 0; i--) {
    for (const [re, lang] of REQUESTS) if (re.test(textsOldestFirst[i])) return lang;
  }
  return null;
}

/** Recebe as mensagens do cliente da mais antiga para a mais recente. */
export function detectLanguage(texts: string[]): CustomerLanguage {
  const asked = requestedLanguage(texts);
  if (asked) return asked;
  // Só as últimas mensagens: o cliente que trocou de idioma no meio da
  // conversa não fica preso ao das primeiras (mais longas).
  const words = texts
    .slice(-3)
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  const score: Record<CustomerLanguage, number> = { pt: 0, en: 0, es: 0 };
  for (const w of words) for (const lang of ['pt', 'en', 'es'] as const) if (WORDS[lang].has(w)) score[lang]++;
  const best = (['en', 'es'] as const).reduce((a, b) => (score[b] > score[a] ? b : a));
  return score[best] >= 2 && score[best] > score.pt ? best : 'pt';
}
