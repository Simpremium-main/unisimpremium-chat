import { Logger } from '@nestjs/common';

import { LlmCompletionRequest, LlmCompletionResponse, LlmContent, LlmToolDefinition } from '../llm.types';

/** O que cada provedor recebe do LlmService já resolvido. */
export interface ProviderCall {
  apiKey: string;
  /** ID do modelo na API do provedor (sem prefixo). */
  model: string;
  request: LlmCompletionRequest;
}

export interface LlmProviderClient {
  complete(call: ProviderCall): Promise<LlmCompletionResponse>;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Filtra tools com schema obviamente quebrado antes de mandar pra API. */
export function sanitizeTools(tools: LlmToolDefinition[], logger: Logger): LlmToolDefinition[] {
  const valid: LlmToolDefinition[] = [];
  for (const t of tools) {
    const reason = validateToolSchema(t);
    if (reason) {
      logger.warn(`Dropping tool ${t.name} from LLM request: ${reason}`);
      continue;
    }
    valid.push(t);
  }
  return valid;
}

function validateToolSchema(t: LlmToolDefinition): string | null {
  if (!t.name || typeof t.name !== 'string') return 'missing name';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)) {
    return `invalid name "${t.name}" — must match [a-zA-Z0-9_-]{1,64}`;
  }
  if (!t.description || typeof t.description !== 'string') {
    return 'missing description';
  }
  const p = t.parameters as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return 'parameters not an object';
  if (p.type !== 'object') {
    return `parameters.type must be "object", got ${JSON.stringify(p.type)}`;
  }
  if (p.properties && typeof p.properties !== 'object') {
    return 'parameters.properties must be an object';
  }
  return null;
}

export function textOnly(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function parseToolArguments(
  raw: string | undefined,
  toolName: string,
  logger: Logger,
): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    logger.warn(`Tool ${toolName} returned non-object arguments — using empty object`);
    return {};
  } catch {
    logger.warn(`Tool ${toolName} returned malformed JSON arguments: ${raw.slice(0, 300)}`);
    return {};
  }
}

/**
 * Preço por 1M tokens (USD). Prefixo mais longo vence, então `gpt-5-mini`
 * não cai no preço do `gpt-5`. Modelo fora da tabela registra custo 0.
 */
export interface Pricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite?: number;
}

export function findPricing(model: string, table: Record<string, Pricing>): Pricing | null {
  const keys = Object.keys(table)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length);
  return keys.length ? table[keys[0]] : null;
}

export function safeStringify(input: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(input, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  } catch (err) {
    return `[unstringifyable: ${(err as Error)?.message}]`;
  }
}
