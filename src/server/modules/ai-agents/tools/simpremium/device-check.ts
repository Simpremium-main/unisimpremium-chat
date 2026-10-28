/**
 * O cliente disse o modelo do aparelho? As instruções de roaming só saem
 * depois disso — a IA não pode supor ("iPhone") nem pular a pergunta.
 */

export type Device = 'iphone' | 'samsung' | 'motorola' | 'outros';

const PATTERNS: Record<Device, RegExp> = {
  iphone: /\b(i\s?phone|apple|ios)\b/i,
  samsung: /\b(samsung|sansung|galaxy)\b/i,
  motorola: /\b(motorola|moto\s?[a-z]?\d+|moto\s?(edge|one|razr))\b/i,
  outros: /\b(xiaomi|redmi|poco|pixel|lg|asus|zenfone|huawei|realme|oppo|nokia|one\s?plus|sony|android|outros?\s*(modelos?)?)\b/i,
};

/** Pergunta padrão do prompt ("Qual o modelo do seu aparelho?…"). */
const ASKED_MODEL = /modelo do (seu )?(aparelho|celular)/i;

export const ASK_DEVICE_OUTPUT = {
  ok: false,
  guard: true,
  error:
    'O cliente ainda NÃO informou o modelo do aparelho nesta conversa. NÃO envie as instruções e NÃO diga que vai enviar. Pergunte exatamente: "Qual o modelo do seu aparelho? Ex.: iPhone, Samsung, Motorola ou outro modelo." e aguarde a resposta.',
};

/**
 * `history` em ordem cronológica. Vale se o cliente citou a marca, ou se
 * respondeu depois de perguntarmos o modelo (ex.: "11 pro", sem a marca).
 * Retorna o aparelho que o cliente disse quando diverge do pedido pela IA.
 */
export function deviceInformed(
  history: Array<{ direction: string; text: string }>,
  device: string | undefined,
): { ok: true } | { ok: false; said?: Device } {
  const said = new Set<Device>();
  let askedAt = -1;
  let answeredAfterAsk = false;
  history.forEach((m, i) => {
    if (m.direction === 'OUTBOUND') {
      if (ASKED_MODEL.test(m.text)) askedAt = i;
      return;
    }
    for (const d of Object.keys(PATTERNS) as Device[]) if (PATTERNS[d].test(m.text)) said.add(d);
    if (askedAt >= 0 && i > askedAt && m.text.trim()) answeredAfterAsk = true;
  });
  const wanted = (device ?? '').toLowerCase() as Device;
  if (said.has(wanted)) return { ok: true };
  if (said.size > 0 && !answeredAfterAsk) return { ok: false, said: [...said][0] };
  return answeredAfterAsk ? { ok: true } : { ok: false };
}

/** enviar_instrucoes_roaming chamado de novo: o fluxo já foi enviado nesta conversa. */
export const ROAMING_ALREADY_SENT_OUTPUT = {
  ok: false,
  guard: true,
  jaEnviado: true,
  instrucao:
    'As instruções de roaming JÁ foram enviadas nesta conversa — NÃO reenvie. Responda ao que o cliente disse: se ele acabou de ajustar algo (ex.: ligou o Roaming de Dados), pergunte se a internet voltou. Se ele disse que não resolveu ou que já estava assim, NÃO pergunte de novo se voltou: peça SÓ o print da primeira tela (iPhone: *Ajustes > Celular*; Android: *Configurações > Conexões > Gerenciamento de Chip*) e aguarde. Uma tela por mensagem: a próxima só depois de analisar o print anterior. Se mandou print, diga exatamente o que ajustar. Só transfira (escalar_para_humano, suporte) depois dos prints e da seleção manual da operadora.',
};

/** Até quantos dias depois do início da ativação as instruções de roaming vão direto. */
export const ROAMING_FIRST_DAYS = 3;

/**
 * Início da ativação em uso hoje (ou o mais recente já começado), lido do
 * retorno de consultar_ativacoes. null = não consultado/sem data.
 */
export function activationStartFrom(outputs: string[], today: string): string | null {
  const starts = outputs
    .flatMap((o) => [...o.matchAll(/"start_date"\s*:\s*"(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]))
    .filter((d) => d <= today)
    .sort();
  return starts.length ? starts[starts.length - 1] : null;
}

export const daysSince = (start: string, today: string) =>
  Math.round((Date.parse(today) - Date.parse(start)) / 86_400_000);

/**
 * Ativação começou há mais de 3 dias: só manda as instruções se for o
 * primeiro dia de uso do cliente. Já usava e parou → pedir prints.
 */
export function roamingTimingGuard(
  start: string | null,
  today: string,
  uso: unknown,
): Record<string, unknown> | null {
  if (!start) return null;
  const n = daysSince(start, today);
  if (n <= ROAMING_FIRST_DAYS || uso === 'primeiro_dia') return null;
  if (uso === 'parou_de_funcionar') {
    return {
      ok: false,
      guard: true,
      instrucao: `A ativação começou há ${n} dias e o cliente já usava o chip: NÃO envie as instruções de roaming. Peça os prints UMA TELA POR VEZ (uma por mensagem; só peça a próxima depois de analisar a anterior): 1º a tela das linhas (iPhone: *Ajustes > Celular*; Android: *Configurações > Conexões > Gerenciamento de Chip*); 2º a tela da linha do nosso chip mostrando o *Roaming de Dados* (Android: *Redes móveis*); 3º só se precisar conferir o ICCID, *Ajustes > Geral > Sobre*. Se não resolver, chame escalar_para_humano (suporte).`,
    };
  }
  return {
    ok: false,
    guard: true,
    perguntar_uso: true,
    instrucao: `A ativação começou há ${n} dias. Se o cliente ainda não disse, pergunte: "Você está no primeiro dia de uso do chip ou já estava usando e parou de funcionar?" e AGUARDE. Se ele já disse, chame enviar_instrucoes_roaming de novo com uso "primeiro_dia" ou "parou_de_funcionar".`,
  };
}
