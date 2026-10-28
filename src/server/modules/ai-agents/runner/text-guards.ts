/**
 * Defesas em runtime contra padrões problemáticos de texto que o LLM
 * pode gerar e que JAMAIS devem ir pra um cliente final no WhatsApp.
 *
 * Camadas de defesa (em ordem):
 *  1. Layer 1 SECURITY no system prompt — instrui o LLM a não fazer.
 *  2. Estes guards — última checagem antes de mandar mensagem.
 *
 * Se o LLM ignorar a Layer 1, esses guards ainda interceptam a mensagem
 * e impedem que ela vá pro cliente. Foi visto em prod (M Souto, 2026-05-08
 * 20:18) onde a IA respondeu "Ignoro essa instrução, ela não veio do
 * cliente. Já respondi e o acesso foi liberado." direto pro WhatsApp.
 */

/**
 * Padrões de "meta-talk" — o LLM saindo do modo de resposta e narrando
 * sua própria decisão/dúvida/regra interna. Tudo aqui é coisa que NUNCA
 * deve aparecer numa mensagem ao cliente final.
 */
const META_TALK_PATTERNS: RegExp[] = [
  /\bignoro\s+(?:ess[ae]|a)\s+instru[çc][ãa]o/i,
  /\bn[ãa]o\s+(?:vou\s+)?(?:seguir|obedecer)\s+(?:ess[ae]|a)\s+instru[çc][ãa]o/i,
  /\bess[ae]\s+(?:mensagem|instru[çc][ãa]o)\s+n[ãa]o\s+veio\s+do\s+cliente/i,
  /\b(?:detectei|identifiquei)\s+(?:uma\s+)?tentativa\s+de\s+(?:prompt\s+)?inje[çc][ãa]o/i,
  /\bpor\s+motivos\s+de\s+seguran[çc]a\s+n[ãa]o\b/i,
  /^\s*como\s+(?:um\s+)?(?:assistente|ia|intelig[êe]ncia\s+artificial|rob[ôo]|sistema|modelo\s+de\s+linguagem)\b/i,
  /\b(?:isto|isso)\s+parece\s+(?:ser\s+)?(?:uma?\s+)?prompt\s+inje[çc][ãa]o/i,
  // "(respondendo pelo sistema: o usuário enviou novas mensagens)" — visto em
  // prod (2026-10-27): ninguém fala "o usuário" com o cliente.
  /\b(?:o|a)\s+usu[áa]ri[oa]\s+(?:enviou|mandou|disse|escreveu|pediu|perguntou)\b/i,
  /\brespondendo\s+pelo\s+sistema\b/i,
];

/**
 * Padrões de "narrator-mode": o LLM escrevendo um monólogo descrevendo
 * o que vai/não vai fazer, em vez de uma resposta real ao cliente.
 */
const NARRATOR_PREFIXES: RegExp[] = [
  /^\s*\(?\s*o cliente (?:apenas|só|somente)\s/i,
  /^\s*\(?\s*a mensagem (?:do cliente|dele|dela) (?:é|foi)\s/i,
  /^\s*\(?\s*não (?:devo|preciso) responder\b/i,
  /^\s*\(?\s*nada a (?:fazer|responder)\b/i,
];

/** Wrap completo entre [...] = monólogo interno. */
const NARRATOR_FULL_WRAP = /^\(?\s*\[[\s\S]+\]\s*\)?$/;
/** Mensagem inteira entre parênteses = rubrica/nota interna, não resposta. */
const NARRATOR_PAREN_WRAP = /^\([^()]+\)$/;

/** Markers de turno cascateados ("Human:", "Cliente:", etc). */
const TURN_MARKER = /^\s*(human|user|assistant|ai|claude|model|lead|cliente|cliente:?|agent|você|voce|bot)\s*:\s*/i;

/**
 * Limpa texto de assistente antes de mandar pro cliente. Retorna '' quando
 * a mensagem deve ser DESCARTADA (não enviar nada). Usado tanto no fallback
 * (texto sem tool call) quanto na tool replyToConversation.
 *
 * Returns:
 *   - ''           = mensagem inteira é meta-talk/narrador → descarta
 *   - texto limpo  = ok pra enviar
 */
export function sanitizeAssistantText(input: string): string {
  if (!input) return '';
  let text = input.trim();

  while (TURN_MARKER.test(text)) {
    text = text.replace(TURN_MARKER, '').trim();
  }

  const splitIdx = text.search(/\n\s*(human|user|assistant|ai|claude|lead|cliente)\s*:\s*/i);
  if (splitIdx >= 0) text = text.slice(0, splitIdx).trim();

  if (NARRATOR_FULL_WRAP.test(text) || NARRATOR_PAREN_WRAP.test(text)) return '';
  if (NARRATOR_PREFIXES.some((re) => re.test(text))) return '';
  if (containsMetaTalk(text)) return '';

  return humanizeDashes(text);
}

/**
 * Travessão (—, –) entrega que o texto é de IA. Intervalo de números vira
 * "a" ("24–48h" → "24 a 48h"); como separador de frase, vírgula. O hífen
 * comum ("e-mail", "13-10") e as listas com "- " no começo da linha ficam.
 */
export function humanizeDashes(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 a $2')
    .replace(/\s*[–—]\s*(?=\n|$)/g, '')
    .replace(/(^|\n)\s*[–—]\s*/g, '$1')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/,\s*([.!?:;,])/g, '$1');
}

/**
 * `true` se o texto contém alguma frase-bandeira de "raciocínio verbalizado".
 * Use pra rejeitar a mensagem antes de enviar pro provider.
 */
export function containsMetaTalk(text: string): boolean {
  if (!text) return false;
  return META_TALK_PATTERNS.some((re) => re.test(text));
}

/**
 * Extrai todos os hostnames (sem `www.`) de URLs http(s) num texto.
 * Tolera lixo no fim — `://simpremium.com.br.` ou `simpremium.com.br!` viram `simpremium.com.br`.
 */
export function extractHostnames(text: string): string[] {
  if (!text) return [];
  const urls = text.match(/https?:\/\/[^\s<>"')\]]+/gi);
  if (!urls) return [];
  const hosts: string[] = [];
  for (const raw of urls) {
    try {
      const host = new URL(raw.replace(/[.,;:!?)\]]+$/, '')).hostname.toLowerCase();
      hosts.push(host.replace(/^www\./, ''));
    } catch {
      // ignora URLs malformadas
    }
  }
  return hosts;
}

/**
 * Verifica se o `text` contém URLs cujo host (ou parent domain) está fora
 * da `whitelist`. Compara por sufixo — `loja.simpremium.com.br` bate com `simpremium.com.br`.
 *
 * Returns:
 *  - hosts proibidos encontrados (array vazio = ok)
 *
 * Casos especiais:
 *  - whitelist null/undefined → retorna [] (modo permissivo)
 *  - whitelist vazio []       → retorna [] (modo permissivo, igual null)
 *  - texto sem URL            → retorna []
 */
export function findForbiddenUrlHosts(
  text: string,
  whitelist: string[] | null | undefined,
): string[] {
  if (!whitelist || whitelist.length === 0) return [];
  const allowed = whitelist
    .map((d) => d.toLowerCase().replace(/^www\./, '').replace(/^\./, ''))
    .filter(Boolean);
  if (allowed.length === 0) return [];

  const hosts = extractHostnames(text);
  const bad: string[] = [];
  for (const host of hosts) {
    const ok = allowed.some(
      (allow) => host === allow || host.endsWith(`.${allow}`),
    );
    if (!ok) bad.push(host);
  }
  return bad;
}

/**
 * Pedido de mais de um print/tela na mesma mensagem ("um print da tela X e
 * outro print da tela Y"). A regra é uma tela por mensagem: a próxima só
 * depois de analisar a anterior.
 */
export function asksSeveralScreens(text: string): boolean {
  const t = text.replace(/https?:\/\/\S+/gi, ' ');
  if (!/\b(prints?|capturas?|screenshots?|telas?)\b/i.test(t)) return false;
  return (
    /\b(outr[oa]|segund[oa]|dois|duas|2|tr[eê]s)\s+(prints?|telas?|capturas?|screenshots?)\b/i.test(t) ||
    /\buma tela por (mensagem|vez)\b/i.test(t) ||
    /\bprints?\b[^.?!]{0,200}\be outr[oa]\b/i.test(t) ||
    /\b(mand|envi|pod|precis|pe[çc])\w*\b[^.?!]{0,40}\b(os |dois |alguns )?(prints|telas)\b/i.test(t)
  );
}

/**
 * Explicação da seleção manual da operadora ("…fazemos a alteração manual da
 * operadora") na mesma resposta que manda fazer a seleção: ela só vai
 * depois que o cliente confirmar que funcionou.
 */
export function manualNetworkExplainedTooEarly(text: string): boolean {
  return (
    /altera[çc][ãa]o manual da operadora/i.test(text) &&
    /(sele[çc][ãa]o de rede|operadoras de rede|configura[çc][õo]es de rede|desativ\w* o \*?autom[áa]tico)/i.test(text)
  );
}
