import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

import { LlmCompletionRequest, LlmCompletionResponse } from './llm.types';
import { DEFAULT_MODEL_ALIAS, LlmProvider, parseModelId } from './llm.constants';
import { currentLlmOrg } from './llm-context';
import { AiCredentialsService } from './ai-credentials.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { LlmProviderClient, LlmProviderError } from './providers/shared';

/**
 * Cliente LLM normalizado. Fala com o ChatGPT (OpenAI) ou com o Claude
 * (Anthropic) conforme o modelo pedido, usando as chaves salvas pela org em
 * Configurações → IA. Mantém o contrato usado pelo runner, classifier,
 * memória, RAG e evals (`complete()`, `LlmMessage`, `LlmToolDefinition`).
 *
 * Modelo `default`, legado (ex.: `sakana/fugu`) ou de um provedor sem chave
 * cai no modelo padrão da org.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers: Record<LlmProvider, LlmProviderClient> = {
    openai: new OpenAiProvider(),
    anthropic: new AnthropicProvider(),
  };

  constructor(private readonly credentials: AiCredentialsService) {}

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const organizationId = req.organizationId ?? currentLlmOrg();
    const { provider, model, apiKey } = await this.resolve(req.modelId, organizationId);

    try {
      return await this.providers[provider].complete({ apiKey, model, request: req });
    } catch (err) {
      if (err instanceof LlmProviderError) {
        throw new InternalServerErrorException(`LLM provider error (${provider}/${model}): ${err.message}`);
      }
      throw err;
    }
  }

  /** Provedor + modelo + chave que de fato atendem `modelId` nesta org. */
  async resolve(
    modelId: string,
    organizationId: string | undefined,
  ): Promise<{ provider: LlmProvider; model: string; apiKey: string }> {
    const requested = parseModelId(modelId);
    if (requested) {
      const apiKey = await this.credentials.getApiKey(organizationId, requested.provider);
      if (apiKey) return { ...requested, apiKey };
      this.logger.warn(
        `Sem chave ${requested.provider} para ${modelId} (org=${organizationId ?? '-'}) — usando o modelo padrão da org`,
      );
    } else if (modelId && modelId !== DEFAULT_MODEL_ALIAS) {
      this.logger.warn(`Modelo "${modelId}" não é OpenAI nem Claude — usando o modelo padrão da org`);
    }

    const fallback = parseModelId(await this.credentials.getDefaultModel(organizationId));
    const apiKey = fallback && (await this.credentials.getApiKey(organizationId, fallback.provider));
    if (!fallback || !apiKey) {
      throw new BadRequestException(
        'Nenhuma chave de IA configurada: cadastre a chave da OpenAI ou da Anthropic em Configurações → IA',
      );
    }
    return { ...fallback, apiKey };
  }
}
