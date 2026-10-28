import type { PlaybookWithSteps } from '../playbooks/playbooks.service';

/**
 * A IA copiou uma mensagem de um fluxo na própria resposta (ex.: "Apenas
 * confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo
 * como verificar:") em vez de chamar `enviarMensagensDoFluxo` — e o resto
 * do fluxo (as imagens com o passo a passo) nunca chegava ao cliente.
 *
 * Acha o fluxo cuja mensagem de texto a resposta reproduz e devolve as
 * mensagens dele que faltam (as de texto que a IA já escreveu ficam de fora).
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length >= 3));

/**
 * Links não contam na comparação: a cotação traz o link do produto e era
 * lida como cópia de "E link do chip físico: https://…/chip-fisico" — e o
 * servidor mandava o resto do fluxo de apresentação depois da cotação.
 */
const withoutUrls = (s: string) => s.replace(/https?:\/\/\S+/gi, ' ');

/** A resposta reproduz este texto do fluxo (igual ou quase: pontuação, emoji, uma palavra trocada). */
export function reproduces(replyText: string, stepTextRaw: string): boolean {
  const reply = withoutUrls(replyText);
  const stepText = withoutUrls(stepTextRaw);
  const step = norm(stepText);
  if (step.length < 20) return false;
  if (norm(reply).includes(step)) return true;
  const stepWords = words(stepText);
  if (stepWords.size < 5) return false;
  const replyWords = words(reply);
  let hit = 0;
  for (const w of stepWords) if (replyWords.has(w)) hit++;
  return hit / stepWords.size >= 0.85;
}

export function pendingFlowSteps(
  replies: string[],
  playbooks: PlaybookWithSteps[],
  /** Fluxos já enviados neste run (enviarMensagensDoFluxo). */
  sentSlugs: Set<string>,
): { playbook: PlaybookWithSteps; steps: PlaybookWithSteps['steps']; promised?: boolean } | null {
  const reply = replies.join('\n');
  if (!reply.trim()) return null;
  let best: { playbook: PlaybookWithSteps; steps: PlaybookWithSteps['steps']; hits: number } | null = null;
  for (const p of playbooks) {
    if (p.steps.length === 0 || sentSlugs.has(p.slug)) continue;
    // Texto do fluxo que a IA escreveu: não vai de novo.
    const copied = new Set(
      p.steps.filter((s) => s.type === 'TEXT' && reproduces(reply, s.content)).map((s) => s.id),
    );
    // Legenda de imagem/vídeo reproduzida: a mídia não foi (vai com a legenda).
    const captionHits = p.steps.filter((s) => s.type !== 'TEXT' && !!s.caption && reproduces(reply, s.caption)).length;
    // Frase entre aspas do "O que fazer" (ex.: Diga "…Segue abaixo como verificar:").
    const quoteHits = quotedSentences(p.instructions ?? '').filter((q) => reproduces(reply, q)).length;
    const hits = copied.size + captionHits + quoteHits;
    if (hits === 0) continue;
    // Só o que vem DEPOIS do último trecho copiado: a IA que escreveu
    // "Desejamos uma ótima viagem! 💛" (2ª mensagem do suporte-resolvido) não
    // estava começando o fluxo — mandar a 1ª depois duplicava a despedida.
    const lastCopied = p.steps.reduce((idx, s, i) => (copied.has(s.id) ? i : idx), -1);
    const rest = p.steps.filter((s, i) => !copied.has(s.id) && i > lastCopied);
    if (rest.length === 0) continue;
    if (!best || hits > best.hits) best = { playbook: p, steps: rest, hits };
  }
  if (best) return { playbook: best.playbook, steps: best.steps };
  // Frase do prompt que anuncia um fluxo ("…Segue abaixo como verificar:")
  // sem o fluxo ter ido: manda o fluxo inteiro.
  for (const { re, slug } of PROMISED_FLOWS) {
    if (!re.test(reply) || sentSlugs.has(slug)) continue;
    const p = playbooks.find((pb) => pb.slug === slug && pb.steps.length > 0);
    if (p) return { playbook: p, steps: p.steps, promised: true };
  }
  return null;
}

/** Frase que abre o verificar-esim: o fluxo sempre vai logo depois dela. */
export const VERIFY_ESIM_INTRO = 'Segue abaixo como verificar:';
export const VERIFY_ESIM_SLUG = 'verificar-esim';

/** Frases do prompt que prometem um fluxo logo em seguida. */
const PROMISED_FLOWS: Array<{ re: RegExp; slug: string }> = [
  {
    re: /segue abaixo como verificar|apenas confirmando,? o seu aparelho [ée] compat[íi]vel com (o )?esim/i,
    slug: 'verificar-esim',
  },
];

/** Trechos entre aspas ("…", “…”, '…') das instruções do fluxo. */
function quotedSentences(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"([^"]{20,})"|“([^”]{20,})”|'([^']{20,})'/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Mensagem do fluxo já está entre as últimas enviadas na conversa (não reenviar). */
export function alreadySent(
  step: PlaybookWithSteps['steps'][number],
  recentOutbound: Array<{ text?: string; mediaUrl?: string }>,
): boolean {
  if (step.type === 'TEXT') return recentOutbound.some((m) => !!m.text && reproduces(m.text, step.content));
  return recentOutbound.some((m) => m.mediaUrl === step.content);
}
