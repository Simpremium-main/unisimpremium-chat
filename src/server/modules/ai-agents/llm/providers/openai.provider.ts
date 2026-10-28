import { Logger } from '@nestjs/common';
import OpenAI from 'openai';

import {
  LlmCompletionResponse,
  LlmContent,
  LlmContentPart,
  LlmMessage,
  LlmToolCall,
  LlmUsage,
} from '../llm.types';
import {
  LlmProviderClient,
  LlmProviderError,
  Pricing,
  ProviderCall,
  findPricing,
  parseToolArguments,
  safeStringify,
  sanitizeTools,
  textOnly,
} from './shared';

type OpenAiMessage = Record<string, unknown>;
type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

const TIMEOUT_MS = 120_000;

const PRICING: Record<string, Pricing> = {
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.005 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.025 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
};

/** Parâmetros extras de `AiAgent.modelParams` que a Chat Completions aceita. */
const ALLOWED_PARAMS = new Set([
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'seed',
  'stop',
  'response_format',
  'tool_choice',
  'parallel_tool_calls',
  'service_tier',
  'reasoning_effort',
  'verbosity',
]);

/** ChatGPT via API da OpenAI (Chat Completions). */
export class OpenAiProvider implements LlmProviderClient {
  private readonly logger = new Logger('LlmService:openai');

  async complete({ apiKey, model, request }: ProviderCall): Promise<LlmCompletionResponse> {
    const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS });
    const messages = this.toMessages(request.messages);
    const tools = request.tools
      ? sanitizeTools(request.tools, this.logger).map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : [];

    const body = (msgs: OpenAiMessage[]) => ({
      model,
      messages: msgs as any,
      // `max_tokens` foi substituído por `max_completion_tokens` (os modelos
      // de raciocínio recusam o antigo). Nos de raciocínio o limite também
      // cobre o raciocínio, então o teto do agente (pensado pra resposta)
      // cortaria a mensagem no meio — sobe pra 16k.
      max_completion_tokens: isReasoningModel(model)
        ? Math.max(request.maxTokens ?? 2048, 16_000)
        : (request.maxTokens ?? 2048),
      // Modelos de raciocínio (gpt-5*, o*) só aceitam a temperatura padrão.
      ...(isReasoningModel(model) ? {} : { temperature: request.temperature ?? 0.7 }),
      ...(tools.length > 0 ? { tools } : {}),
      ...(request.cacheKey ? { prompt_cache_key: request.cacheKey } : {}),
      ...this.sanitizeModelParams(request.modelParams),
    });

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create(body(messages) as any);
    } catch (err) {
      this.logError(err, model, messages.length, tools.map((t) => t.function.name));
      // 400 com imagem no payload quase sempre é o provedor sem conseguir
      // baixar a URL. Perder a visão de uma imagem velha é melhor que o
      // agente não responder — refaz UMA vez só com o texto.
      const stripped = stripImageParts(messages);
      if (status(err) === 400 && stripped) {
        this.logger.warn(`LLM 400 com imagem no payload — retry sem os image blocks [openai/${model}]`);
        try {
          response = await client.chat.completions.create(body(stripped) as any);
        } catch (retryErr) {
          throw new LlmProviderError(errorMessage(retryErr), status(retryErr));
        }
      } else {
        throw new LlmProviderError(errorMessage(err), status(err));
      }
    }

    const choice = response.choices?.[0];
    if (!choice?.message) throw new LlmProviderError('OpenAI não devolveu mensagem');

    return {
      message: this.fromMessage(choice.message),
      stopReason: normalizeStopReason(choice.finish_reason),
      usage: this.usage(response.usage as OpenAiUsage | undefined, model),
      rawModelId: `openai/${response.model ?? model}`,
    };
  }

  private toMessages(input: LlmMessage[]): OpenAiMessage[] {
    const out: OpenAiMessage[] = [];
    for (const m of input) {
      if (m.role === 'system') {
        const text = textOnly(m.content);
        if (text) out.push({ role: 'system', content: text });
        continue;
      }
      if (m.role === 'tool') {
        if (!m.toolCallId) {
          this.logger.warn('Tool message without toolCallId — dropping');
          continue;
        }
        out.push({
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: textOnly(m.content) || '(empty)',
        });
        continue;
      }
      if (m.role === 'user') {
        const content = toUserContent(m.content);
        if (content !== '' && !(Array.isArray(content) && content.length === 0)) {
          out.push({ role: 'user', content });
        }
        continue;
      }
      // assistant
      const content = textOnly(m.content);
      const toolCalls = (m.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: safeStringify(tc.arguments) },
      }));
      if (!content && toolCalls.length === 0) continue;
      out.push({
        role: 'assistant',
        content: content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    }
    return out;
  }

  private fromMessage(message: OpenAI.Chat.Completions.ChatCompletionMessage): LlmMessage {
    const toolCalls: LlmToolCall[] = [];
    for (const call of message.tool_calls ?? []) {
      const fn =
        call.type === 'function'
          ? { name: call.function.name, raw: call.function.arguments }
          : { name: call.custom?.name, raw: call.custom?.input };
      if (!fn.name) continue;
      toolCalls.push({
        id: call.id ?? `tool_${toolCalls.length + 1}`,
        name: fn.name,
        arguments: parseToolArguments(fn.raw, fn.name, this.logger),
      });
    }
    return {
      role: 'assistant',
      content: message.content ?? '',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  private sanitizeModelParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!params) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k === 'stop_sequences' && v !== undefined) out.stop = v;
      else if (k === 'effort' && typeof v === 'string') out.reasoning_effort = v;
      else if (ALLOWED_PARAMS.has(k)) out[k] = v;
    }
    return out;
  }

  private usage(usage: OpenAiUsage | undefined, model: string): LlmUsage {
    const input = usage?.prompt_tokens ?? 0;
    const output = usage?.completion_tokens ?? 0;
    const cacheRead = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const price = findPricing(model, PRICING);
    const costUsd = price
      ? ((input - cacheRead) * price.input + cacheRead * price.cacheRead + output * price.output) /
        1_000_000
      : 0;
    return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: 0, costUsd };
  }

  private logError(err: unknown, model: string, messageCount: number, toolNames: string[]): void {
    this.logger.error(
      `LLM call failed [openai/${model}] status=${status(err) ?? '?'}: ${errorMessage(err)} | messages=${messageCount} tools=[${toolNames.join(',')}]`,
    );
  }
}

function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}

function toUserContent(content: LlmContent): unknown {
  if (typeof content === 'string') return content;
  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) parts.push({ type: 'text', text: part.text });
      continue;
    }
    const url = imageUrl(part);
    if (url) parts.push({ type: 'image_url', image_url: { url } });
  }
  if (parts.length === 0) return '';
  if (parts.every((p) => p.type === 'text')) return parts.map((p) => String(p.text ?? '')).join('\n');
  return parts;
}

function imageUrl(part: Extract<LlmContentPart, { type: 'image' }>): string | null {
  if (part.url) return part.url;
  if (part.base64) return `data:${part.base64.mediaType};base64,${part.base64.data}`;
  return null;
}

/** Cópia das mensagens com cada `image_url` trocado por um aviso; null se não havia imagem. */
function stripImageParts(messages: OpenAiMessage[]): OpenAiMessage[] | null {
  let found = false;
  const out = messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const parts = (message.content as Array<Record<string, unknown>>).map((part) => {
      if (part?.type !== 'image_url') return part;
      found = true;
      return { type: 'text', text: '[imagem enviada — não foi possível carregar pra eu visualizar]' };
    });
    const onlyText = parts.every((p) => p.type === 'text');
    return {
      ...message,
      content: onlyText ? parts.map((p) => String(p.text ?? '')).join('\n') : parts,
    };
  });
  return found ? out : null;
}

function normalizeStopReason(reason: string | null | undefined): LlmCompletionResponse['stopReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'other';
  }
}

function status(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
