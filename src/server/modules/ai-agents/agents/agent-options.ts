/**
 * Opções de comportamento por agente, guardadas em `AiAgent.modelParams`
 * (JSON, sem migration). Agente sem nada configurado mantém exatamente o
 * comportamento padrão da plataforma.
 *
 *   {
 *     "promptMode": "standalone",        // só o prompt do agente (sem as regras padrão)
 *     "toolsets": ["simpremium"],        // pacotes de ferramentas habilitados
 *     "disabledTools": ["transferToHuman"],
 *     "maxRepliesPerRun": 8              // mensagens que pode mandar por turno
 *   }
 */
export type PromptMode = 'default' | 'standalone';

export interface AgentOptions {
  promptMode: PromptMode;
  /** null = configuração padrão (pacotes legados da plataforma). */
  toolsets: string[] | null;
  disabledTools: Set<string>;
  maxRepliesPerRun: number;
}

/** Pacotes que os agentes sem `toolsets` configurado recebem (comportamento original). */
export const LEGACY_TOOLSETS = ['trivapp'];

/** Nomes antigos de pacotes, ainda aceitos em modelParams.toolsets. */
const TOOLSET_ALIASES: Record<string, string> = { bravy: 'trivapp' };

export const MAX_REPLIES_LIMIT = 20;

export function readAgentOptions(modelParams: unknown): AgentOptions {
  const p =
    modelParams && typeof modelParams === 'object' && !Array.isArray(modelParams)
      ? (modelParams as Record<string, unknown>)
      : {};
  const strings = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : null;
  const max = Number(p.maxRepliesPerRun);

  return {
    promptMode: p.promptMode === 'standalone' ? 'standalone' : 'default',
    toolsets: strings(p.toolsets)?.map((t) => TOOLSET_ALIASES[t] ?? t) ?? null,
    disabledTools: new Set(strings(p.disabledTools) ?? []),
    maxRepliesPerRun:
      Number.isInteger(max) && max >= 1 ? Math.min(max, MAX_REPLIES_LIMIT) : 1,
  };
}

/** O agente enxerga as ferramentas do pacote `toolset`? */
export function hasToolset(options: AgentOptions, toolset: string): boolean {
  return (options.toolsets ?? LEGACY_TOOLSETS).includes(toolset);
}
