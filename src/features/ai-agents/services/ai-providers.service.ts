import { api } from '@/lib/api';

export type AiProvider = 'openai' | 'anthropic';

export interface AiProviderStatus {
  configured: boolean;
  /** `organization` = cadastrada no app; `env` = chave do servidor. */
  source: 'organization' | 'env' | null;
  /** Chave mascarada (ex.: `sk-ant-…a1b2`). */
  hint: string | null;
}

export interface AiProvidersSettings {
  providers: Record<AiProvider, AiProviderStatus>;
  defaultModel: string | null;
  /** Modelo usado de fato quando algo pede o padrão (null = nenhuma chave). */
  effectiveDefaultModel: string | null;
}

export interface UpdateAiProvidersInput {
  /** string = salva/troca; null = remove. */
  openaiKey?: string | null;
  anthropicKey?: string | null;
  defaultModel?: string | null;
}

export interface AiModelOption {
  id: string;
  provider: AiProvider;
  label: string;
}

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)',
};

export const aiProvidersService = {
  async get(): Promise<AiProvidersSettings> {
    const { data } = await api.get('/ai-providers');
    return data.data ?? data;
  },

  async update(input: UpdateAiProvidersInput): Promise<AiProvidersSettings> {
    const { data } = await api.put('/ai-providers', input);
    return data.data ?? data;
  },

  async test(provider: AiProvider): Promise<{ ok: true; models: number }> {
    const { data } = await api.post(`/ai-providers/${provider}/test`);
    return data.data ?? data;
  },

  async models(): Promise<{ models: AiModelOption[]; errors: Partial<Record<AiProvider, string>> }> {
    const { data } = await api.get('/ai-providers/models');
    return data.data ?? data;
  },
};
