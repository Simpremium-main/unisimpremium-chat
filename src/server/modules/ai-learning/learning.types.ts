/**
 * Onde um aprendizado fica guardado:
 *  - FLUXO: mensagens prontas enviadas como estão (Jarvis → Fluxos)
 *  - CONHECIMENTO: fato/política que a IA usa com as próprias palavras —
 *    só entra no prompt quando o assunto aparece (base de conhecimento)
 *  - TEMPORARIO: conhecimento com data pra sair sozinho
 *  - REGRA: comportamento em TODA conversa (vai pro prompt do agente)
 *  - NENHUM: só vale pra este caso
 */
export type LearningKind = 'FLUXO' | 'CONHECIMENTO' | 'TEMPORARIO' | 'REGRA' | 'NENHUM';

export interface Learning {
  tipo: LearningKind;
  /** Por que este tipo (mostrado pro admin). */
  motivo?: string;
  titulo?: string;
  // FLUXO
  gatilho?: string;
  instrucoes?: string;
  mensagens?: string[];
  // CONHECIMENTO / TEMPORARIO
  conteudo?: string;
  palavras_chave?: string;
  /** AAAA-MM-DD (TEMPORARIO). */
  expira_em?: string | null;
  // REGRA
  regra?: string;
  agentId?: string | null;
  /** Atualizar um item parecido em vez de criar outro. */
  atualizar?: { tipo: 'FLUXO' | 'CONHECIMENTO'; id: string } | null;
}

export interface HelpDraft {
  resumo: string;
  resposta: string[];
  aprendizado: Learning;
}

const KINDS: LearningKind[] = ['FLUXO', 'CONHECIMENTO', 'TEMPORARIO', 'REGRA', 'NENHUM'];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(str).filter(Boolean);

/** Normaliza o que veio do modelo (ou do admin) — campos certos pra cada tipo. */
export function normalizeLearning(raw: unknown): Learning {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tipo = KINDS.includes(str(o.tipo).toUpperCase() as LearningKind)
    ? (str(o.tipo).toUpperCase() as LearningKind)
    : 'NENHUM';
  const up = o.atualizar as { tipo?: unknown; id?: unknown } | null | undefined;
  const atualizar =
    up && str(up.id) && (str(up.tipo).toUpperCase() === 'FLUXO' || str(up.tipo).toUpperCase() === 'CONHECIMENTO')
      ? { tipo: str(up.tipo).toUpperCase() as 'FLUXO' | 'CONHECIMENTO', id: str(up.id) }
      : null;
  const expira = str(o.expira_em);
  return {
    tipo,
    motivo: str(o.motivo) || undefined,
    titulo: str(o.titulo) || undefined,
    gatilho: str(o.gatilho) || undefined,
    instrucoes: str(o.instrucoes) || undefined,
    mensagens: strList(o.mensagens),
    conteudo: str(o.conteudo) || undefined,
    palavras_chave: str(o.palavras_chave) || undefined,
    expira_em: /^\d{4}-\d{2}-\d{2}$/.test(expira) ? expira : null,
    regra: str(o.regra) || undefined,
    agentId: str(o.agentId) || null,
    atualizar,
  };
}

/** O que falta pra aplicar o aprendizado (vazio = pode aplicar). */
export function learningProblems(l: Learning): string[] {
  const p: string[] = [];
  if (l.tipo === 'NENHUM') return p;
  if (!l.titulo) p.push('Informe um título');
  if (l.tipo === 'FLUXO') {
    if (!l.gatilho) p.push('Informe quando o fluxo deve ser usado (gatilho)');
    if (!l.mensagens?.length) p.push('Informe ao menos uma mensagem do fluxo');
  }
  if ((l.tipo === 'CONHECIMENTO' || l.tipo === 'TEMPORARIO') && !l.conteudo) p.push('Informe o conteúdo');
  if (l.tipo === 'TEMPORARIO' && !l.expira_em) p.push('Informe até quando vale (data)');
  if (l.tipo === 'REGRA') {
    if (!l.regra) p.push('Informe a regra');
    if (!l.agentId) p.push('Escolha o agente que recebe a regra');
  }
  return p;
}
