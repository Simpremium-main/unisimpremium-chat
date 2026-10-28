import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import { LlmCompletionResponse, LlmContent, LlmMessage, LlmToolCall, LlmUsage } from '../llm.types';
import {
  LlmProviderClient,
  LlmProviderError,
  Pricing,
  ProviderCall,
  findPricing,
  sanitizeTools,
  textOnly,
} from './shared';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type TextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;

const TIMEOUT_MS = 120_000;
/**
 * Teto de saída de cada chamada. Nos modelos atuais o raciocínio (thinking,
 * sempre ligado no Opus 5.5) também conta aqui, então o `maxTokens` do agente
 * — pensado só para a resposta — cortaria no meio. 16k é o recomendado para
 * chamadas sem streaming; só se paga o que for gerado.
 */
const MIN_MAX_TOKENS = 16_000;
/** Até 2 marcadores no system + o automático do histórico (limite da API: 4). */
const MAX_SYSTEM_CACHE_MARKERS = 2;

/** Modelos que aceitam `fallbacks: "default"` (refaz recusas de segurança noutro modelo). */
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/;
/** Modelos que aceitam `output_config.effort` sem erro. */
const EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable)-5|^claude-opus-4-[5-8]|^claude-sonnet-4-6/;

const PRICING: Record<string, Pricing> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

/** Claude via API da Anthropic (Messages). */
export class AnthropicProvider implements LlmProviderClient {
  private readonly logger = new Logger('LlmService:anthropic');

  async complete({ apiKey, model, request }: ProviderCall): Promise<LlmCompletionResponse> {
    const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });
    const system = this.toSystem(request.messages);
    const messages = this.toMessages(request.messages);
    const tools: Anthropic.Beta.Messages.BetaTool[] = request.tools
      ? sanitizeTools(request.tools, this.logger).map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Beta.Messages.BetaTool.InputSchema,
        }))
      : [];

    const params = request.modelParams ?? {};
    const effort = pickEffort(model, params, request.maxTokens);
    const stop = params.stop_sequences ?? params.stop;
    const useFallbacks = FALLBACK_MODELS.test(model);

    // Sem `temperature`: os modelos atuais do Claude recusam valores fora do
    // padrão (400). O tom fica a cargo do prompt.
    const body = (msgs: MessageParam[]): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming => ({
      model,
      max_tokens: Math.max(request.maxTokens ?? 0, MIN_MAX_TOKENS),
      ...(system.length > 0 ? { system } : {}),
      messages: msgs,
      ...(tools.length > 0 ? { tools } : {}),
      // Cache automático: marca o último bloco cacheável, então o histórico
      // da conversa é reaproveitado entre as iterações do loop de tools.
      cache_control: { type: 'ephemeral' },
      ...(effort ? { output_config: { effort } } : {}),
      ...(Array.isArray(stop) ? { stop_sequences: stop.map(String) } : {}),
      ...(useFallbacks
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    });

    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await client.beta.messages.create(body(messages));
    } catch (err) {
      this.logError(err, model, messages.length, tools.map((t) => t.name));
      // 400 com imagem no payload: quase sempre a URL que o provedor não
      // conseguiu baixar. Refaz UMA vez só com o texto.
      const stripped = stripImages(messages);
      if (status(err) === 400 && stripped) {
        this.logger.warn(`LLM 400 com imagem no payload — retry sem as imagens [anthropic/${model}]`);
        try {
          response = await client.beta.messages.create(body(stripped));
        } catch (retryErr) {
          throw new LlmProviderError(errorMessage(retryErr), status(retryErr));
        }
      } else {
        throw new LlmProviderError(errorMessage(err), status(err));
      }
    }

    if (response.stop_reason === 'refusal') {
      this.logger.warn(
        `Claude recusou [anthropic/${response.model}] categoria=${response.stop_details?.category ?? '?'}`,
      );
    }

    return {
      message: this.fromResponse(response),
      stopReason: normalizeStopReason(response.stop_reason),
      usage: this.usage(response),
      rawModelId: `anthropic/${response.model ?? model}`,
    };
  }

  /** Mensagens `system` viram o campo `system`; partes marcadas `cache` ganham marcador. */
  private toSystem(input: LlmMessage[]): TextBlockParam[] {
    const blocks: TextBlockParam[] = [];
    let markers = 0;
    for (const m of input) {
      if (m.role !== 'system') continue;
      const parts = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
      for (const part of parts) {
        if (part.type !== 'text' || !part.text) continue;
        const cache = 'cache' in part && part.cache && markers < MAX_SYSTEM_CACHE_MARKERS;
        if (cache) markers++;
        blocks.push({
          type: 'text',
          text: part.text,
          ...(cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
        });
      }
    }
    return blocks;
  }

  private toMessages(input: LlmMessage[]): MessageParam[] {
    const out: MessageParam[] = [];
    // Resultados de tools consecutivos vão juntos numa única mensagem user
    // (separados, o Claude passa a evitar chamadas paralelas).
    const pushUser = (blocks: ContentBlockParam[]) => {
      if (blocks.length === 0) return;
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push(...blocks);
      } else {
        out.push({ role: 'user', content: blocks });
      }
    };

    for (const m of input) {
      if (m.role === 'system') continue;

      if (m.role === 'tool') {
        if (!m.toolCallId) {
          this.logger.warn('Tool message without toolCallId — dropping');
          continue;
        }
        pushUser([
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: textOnly(m.content) || '(empty)',
          },
        ]);
        continue;
      }

      if (m.role === 'user') {
        pushUser(toUserBlocks(m.content));
        continue;
      }

      // assistant: a resposta crua do Claude volta como veio (thinking incluso).
      const raw = m.providerData?.provider === 'anthropic' ? m.providerData.content : null;
      const blocks: ContentBlockParam[] = raw
        ? (raw as ContentBlockParam[])
        : [
            ...(textOnly(m.content) ? [{ type: 'text' as const, text: textOnly(m.content) }] : []),
            ...(m.toolCalls ?? []).map((tc) => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })),
          ];
      if (blocks.length === 0) continue;
      out.push({ role: 'assistant', content: blocks });
    }

    // A conversa precisa começar com o cliente e não pode terminar numa fala
    // do assistente (prefill é recusado pelos modelos atuais).
    if (out[0]?.role === 'assistant') {
      out.unshift({ role: 'user', content: '(início da conversa)' });
    }
    if (out.length === 0 || out[out.length - 1].role === 'assistant') {
      out.push({ role: 'user', content: '(continue)' });
    }
    return out;
  }

  private fromResponse(response: Anthropic.Beta.Messages.BetaMessage): LlmMessage {
    const text: string[] = [];
    const toolCalls: LlmToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text') text.push(block.text);
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments:
            block.input && typeof block.input === 'object' && !Array.isArray(block.input)
              ? (block.input as Record<string, unknown>)
              : {},
        });
      }
    }
    return {
      role: 'assistant',
      content: text.join(''),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      providerData: { provider: 'anthropic', content: echoableContent(response.content) },
    };
  }

  private usage(response: Anthropic.Beta.Messages.BetaMessage): LlmUsage {
    const u = response.usage;
    const input = u.input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    const price = findPricing(response.model, PRICING);
    const costUsd = price
      ? (input * price.input +
          cacheRead * price.cacheRead +
          cacheWrite * price.input * 1.25 +
          output * price.output) /
        1_000_000
      : 0;
    return {
      // `input_tokens` do Claude não inclui o que veio do cache; o resto do
      // app espera o total de entrada (como na OpenAI).
      inputTokens: input + cacheRead + cacheWrite,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      costUsd,
    };
  }

  private logError(err: unknown, model: string, messageCount: number, toolNames: string[]): void {
    this.logger.error(
      `LLM call failed [anthropic/${model}] status=${status(err) ?? '?'}: ${errorMessage(err)} | messages=${messageCount} tools=[${toolNames.join(',')}]`,
    );
  }
}

function toUserBlocks(content: LlmContent): ContentBlockParam[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  const blocks: ContentBlockParam[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) blocks.push({ type: 'text', text: part.text });
    } else if (part.url) {
      blocks.push({ type: 'image', source: { type: 'url', url: part.url } });
    } else if (part.base64) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.base64.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: part.base64.data,
        },
      });
    }
  }
  return blocks;
}

/**
 * Conteúdo da resposta pronto para reenviar. Se houve troca de modelo por
 * recusa no meio da resposta (bloco `fallback`), o que veio antes dele e não
 * é texto (thinking, tool_use, blocos internos) não pode voltar.
 */
function echoableContent(content: Anthropic.Beta.Messages.BetaContentBlock[]): unknown[] {
  const boundary = content.map((b) => b.type as string).lastIndexOf('fallback');
  if (boundary < 0) return content;
  return content.filter((block, i) => {
    if ((block.type as string) === 'fallback') return false;
    return i > boundary || block.type === 'text';
  });
}

function stripImages(messages: MessageParam[]): MessageParam[] | null {
  let found = false;
  const out = messages.map((m) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((block) => {
        if (block.type !== 'image') return block;
        found = true;
        return { type: 'text' as const, text: '[imagem enviada — não foi possível carregar pra eu visualizar]' };
      }),
    };
  });
  return found ? out : null;
}

/**
 * `effort` vem de `modelParams.effort` (ou `reasoning_effort`, nome da
 * OpenAI). Sem nada configurado, chamadas curtas (classificação, ranking,
 * juiz) usam `low`; o resto fica no padrão do modelo.
 */
function pickEffort(
  model: string,
  params: Record<string, unknown>,
  maxTokens: number | undefined,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null {
  if (!EFFORT_MODELS.test(model)) return null;
  const raw = params.effort ?? params.reasoning_effort;
  if (typeof raw === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(raw)) {
    return raw as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  }
  if (maxTokens !== undefined && maxTokens <= 1024) return 'low';
  return null;
}

function normalizeStopReason(reason: string | null | undefined): LlmCompletionResponse['stopReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'refusal':
      return 'content_filter';
    default:
      return 'other';
  }
}

function status(err: unknown): number | undefined {
  return err instanceof Anthropic.APIError ? err.status : (err as { status?: number })?.status;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
