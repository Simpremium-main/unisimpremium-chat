export type LlmProvider = 'openai' | 'anthropic';

export const LLM_PROVIDERS: readonly LlmProvider[] = ['openai', 'anthropic'];

/**
 * Alias aceito em qualquer lugar onde vai um modelId (agente, routing,
 * classifier...): resolve para o "modelo padrão" escolhido nas
 * Configurações → IA da organização.
 */
export const DEFAULT_MODEL_ALIAS = 'default';

/**
 * Modelo usado quando a org não escolheu um padrão: o mais barato do
 * provedor que tiver chave configurada (Claude tem preferência).
 */
export const FALLBACK_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  anthropic: 'anthropic/claude-haiku-5-5',
  openai: 'openai/gpt-5-mini',
};

/** Sugestões exibidas antes de a chave estar configurada (a lista real vem da API do provedor). */
export const SUGGESTED_MODELS: Array<{ id: string; provider: LlmProvider; label: string }> = [
  { id: 'anthropic/claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5' },
  { id: 'anthropic/claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5' },
  { id: 'anthropic/claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5' },
];

export interface ParsedModel {
  provider: LlmProvider;
  /** ID que vai para a API do provedor (sem o prefixo `openai/` / `anthropic/`). */
  model: string;
}

/**
 * Identifica o provedor de um modelId. Aceita o formato com prefixo
 * (`openai/gpt-5`, `anthropic/claude-sonnet-5-5`) e os IDs crus mais comuns
 * (`gpt-*`, `o3`, `chatgpt-*`, `claude-*`). Devolve null para o alias
 * `default`, para IDs legados (ex.: `sakana/fugu`) e para lixo — quem chama
 * cai no modelo padrão da org.
 */
export function parseModelId(id: string | null | undefined): ParsedModel | null {
  const raw = (id ?? '').trim();
  if (!raw || raw === DEFAULT_MODEL_ALIAS) return null;

  const slash = raw.indexOf('/');
  if (slash > 0) {
    const prefix = raw.slice(0, slash).toLowerCase();
    const model = raw.slice(slash + 1).trim();
    if (!model) return null;
    if (prefix === 'openai') return { provider: 'openai', model };
    if (prefix === 'anthropic' || prefix === 'claude') return { provider: 'anthropic', model };
    return null;
  }

  if (/^claude-/i.test(raw)) return { provider: 'anthropic', model: raw };
  if (/^(gpt-|chatgpt-|o\d)/i.test(raw)) return { provider: 'openai', model: raw };
  return null;
}

export function formatModelId(provider: LlmProvider, model: string): string {
  return `${provider}/${model}`;
}
