import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

import { PrismaService } from '../../../database/prisma.service';
import {
  DEFAULT_MODEL_ALIAS,
  FALLBACK_MODEL_BY_PROVIDER,
  LLM_PROVIDERS,
  LlmProvider,
  SUGGESTED_MODELS,
  formatModelId,
  parseModelId,
} from './llm.constants';

/**
 * Bloco `settings.ai` da Organization (JSON, sem migration). As chaves ficam
 * cifradas com AES-256-GCM; nunca saem do servidor em claro.
 */
interface StoredAiSettings {
  openaiKey?: string;
  anthropicKey?: string;
  defaultModel?: string;
}

interface ResolvedAiSettings {
  keys: Partial<Record<LlmProvider, string>>;
  /** De onde veio cada chave — a da org tem prioridade sobre a env. */
  sources: Partial<Record<LlmProvider, 'organization' | 'env'>>;
  defaultModel: string | null;
}

export interface AiProvidersView {
  providers: Record<
    LlmProvider,
    { configured: boolean; source: 'organization' | 'env' | null; hint: string | null }
  >;
  defaultModel: string | null;
  /** Modelo efetivamente usado quando o agente/tarefa pede o padrão. */
  effectiveDefaultModel: string | null;
}

export interface UpdateAiProvidersInput {
  /** string = salva/troca; null = remove; ausente = mantém. */
  openaiKey?: string | null;
  anthropicKey?: string | null;
  defaultModel?: string | null;
}

export interface AvailableModel {
  id: string;
  provider: LlmProvider;
  label: string;
}

const KEY_FIELD: Record<LlmProvider, 'openaiKey' | 'anthropicKey'> = {
  openai: 'openaiKey',
  anthropic: 'anthropicKey',
};
const ENV_FIELD: Record<LlmProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};
const SETTINGS_TTL_MS = 30_000;
const MODELS_TTL_MS = 10 * 60_000;

/**
 * Chaves de API e modelo padrão da IA, por organização (Configurações → IA).
 * Também lista os modelos que cada chave enxerga, direto da API do provedor.
 */
@Injectable()
export class AiCredentialsService {
  private readonly logger = new Logger(AiCredentialsService.name);
  private readonly cipherKey: Buffer;
  private readonly settingsCache = new Map<string, { at: number; value: ResolvedAiSettings }>();
  private readonly modelsCache = new Map<string, { at: number; value: AvailableModel[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const secret =
      this.config.get<string>('AI_KEYS_SECRET') || this.config.get<string>('JWT_SECRET');
    if (!secret) {
      this.logger.warn('Nem AI_KEYS_SECRET nem JWT_SECRET definidos — chaves de IA não podem ser salvas');
    }
    this.cipherKey = createHash('sha256').update(`ai-keys:${secret ?? ''}`).digest();
  }

  // ─── leitura (runtime) ─────────────────────────────────────────────

  async getApiKey(organizationId: string | undefined, provider: LlmProvider): Promise<string | null> {
    if (!organizationId) return this.envKey(provider);
    const settings = await this.resolve(organizationId);
    return settings.keys[provider] ?? null;
  }

  /**
   * Modelo padrão da org no formato `provedor/modelo`. Se ela não escolheu
   * (ou escolheu um de provedor sem chave), usa o mais barato de um provedor
   * que tenha chave. Null quando não há chave nenhuma.
   */
  async getDefaultModel(organizationId: string | undefined): Promise<string | null> {
    const settings = organizationId
      ? await this.resolve(organizationId)
      : this.envOnlySettings();
    return this.effectiveDefault(settings);
  }

  // ─── tela de configurações ────────────────────────────────────────

  async getView(organizationId: string): Promise<AiProvidersView> {
    const settings = await this.resolve(organizationId, true);
    const providers = {} as AiProvidersView['providers'];
    for (const p of LLM_PROVIDERS) {
      const key = settings.keys[p];
      providers[p] = {
        configured: !!key,
        source: settings.sources[p] ?? null,
        hint: key ? maskKey(key) : null,
      };
    }
    return {
      providers,
      defaultModel: settings.defaultModel,
      effectiveDefaultModel: this.effectiveDefault(settings),
    };
  }

  async update(organizationId: string, input: UpdateAiProvidersInput): Promise<AiProvidersView> {
    // Valida as chaves novas antes de gravar — evita salvar chave errada e
    // só descobrir quando o agente falhar com o cliente esperando.
    for (const p of LLM_PROVIDERS) {
      const value = input[KEY_FIELD[p]];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) throw new BadRequestException(`Chave ${providerLabel(p)} vazia`);
        await this.verifyKey(p, trimmed);
      }
    }
    if (input.defaultModel != null && input.defaultModel !== DEFAULT_MODEL_ALIAS) {
      if (!parseModelId(input.defaultModel)) {
        throw new BadRequestException(`Modelo inválido: ${input.defaultModel}`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Lock da linha: dois admins salvando ao mesmo tempo não se sobrescrevem.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { settings: true },
      });
      const settings = asObject(org.settings);
      const ai: StoredAiSettings = { ...asObject(settings.ai) };

      for (const p of LLM_PROVIDERS) {
        const field = KEY_FIELD[p];
        const value = input[field];
        if (value === null) delete ai[field];
        else if (typeof value === 'string') ai[field] = this.encrypt(value.trim());
      }
      if (input.defaultModel !== undefined) {
        const model = input.defaultModel ? normalizeModelId(input.defaultModel) : null;
        if (model && model !== DEFAULT_MODEL_ALIAS) ai.defaultModel = model;
        else delete ai.defaultModel;
      }

      await tx.organization.update({
        where: { id: organizationId },
        data: { settings: { ...settings, ai } as unknown as Prisma.InputJsonValue },
      });
    });

    this.settingsCache.delete(organizationId);
    this.modelsCache.delete(organizationId);
    return this.getView(organizationId);
  }

  /** Testa a chave salva (ou a da env) de um provedor. */
  async test(organizationId: string, provider: LlmProvider): Promise<{ ok: true; models: number }> {
    const key = await this.getApiKey(organizationId, provider);
    if (!key) throw new BadRequestException(`Nenhuma chave ${providerLabel(provider)} configurada`);
    const models = await this.verifyKey(provider, key);
    return { ok: true, models: models.length };
  }

  /**
   * Modelos de texto disponíveis para as chaves da org, direto da API de
   * cada provedor (cache de 10 min). Sem chave, devolve só as sugestões.
   */
  async listModels(organizationId: string): Promise<{ models: AvailableModel[]; errors: Partial<Record<LlmProvider, string>> }> {
    const cached = this.modelsCache.get(organizationId);
    if (cached && Date.now() - cached.at < MODELS_TTL_MS) {
      return { models: cached.value, errors: {} };
    }

    const settings = await this.resolve(organizationId);
    const errors: Partial<Record<LlmProvider, string>> = {};
    const lists = await Promise.all(
      LLM_PROVIDERS.map(async (p) => {
        const key = settings.keys[p];
        if (!key) return [] as AvailableModel[];
        try {
          return await this.fetchModels(p, key);
        } catch (err) {
          errors[p] = errorMessage(err);
          return [] as AvailableModel[];
        }
      }),
    );

    let models = lists.flat();
    if (!models.some((m) => m.provider === 'anthropic') && !errors.anthropic) {
      models = [...models, ...SUGGESTED_MODELS];
    }
    if (Object.keys(errors).length === 0) {
      this.modelsCache.set(organizationId, { at: Date.now(), value: models });
    }
    return { models, errors };
  }

  // ─── internos ─────────────────────────────────────────────────────

  private async resolve(organizationId: string, fresh = false): Promise<ResolvedAiSettings> {
    const cached = this.settingsCache.get(organizationId);
    if (!fresh && cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.value;

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    const stored = asObject(asObject(org?.settings).ai) as StoredAiSettings;

    const value = this.envOnlySettings();
    for (const p of LLM_PROVIDERS) {
      const enc = stored[KEY_FIELD[p]];
      const key = enc ? this.decrypt(enc, organizationId, p) : null;
      if (key) {
        value.keys[p] = key;
        value.sources[p] = 'organization';
      }
    }
    value.defaultModel = typeof stored.defaultModel === 'string' ? stored.defaultModel : null;

    this.settingsCache.set(organizationId, { at: Date.now(), value });
    return value;
  }

  private envOnlySettings(): ResolvedAiSettings {
    const value: ResolvedAiSettings = { keys: {}, sources: {}, defaultModel: null };
    for (const p of LLM_PROVIDERS) {
      const key = this.envKey(p);
      if (key) {
        value.keys[p] = key;
        value.sources[p] = 'env';
      }
    }
    return value;
  }

  private envKey(provider: LlmProvider): string | null {
    return this.config.get<string>(ENV_FIELD[provider])?.trim() || null;
  }

  private effectiveDefault(settings: ResolvedAiSettings): string | null {
    const chosen = parseModelId(settings.defaultModel);
    if (chosen && settings.keys[chosen.provider]) {
      return formatModelId(chosen.provider, chosen.model);
    }
    if (settings.keys.anthropic) return FALLBACK_MODEL_BY_PROVIDER.anthropic;
    if (settings.keys.openai) return FALLBACK_MODEL_BY_PROVIDER.openai;
    return null;
  }

  private async verifyKey(provider: LlmProvider, key: string): Promise<AvailableModel[]> {
    try {
      return await this.fetchModels(provider, key);
    } catch (err) {
      throw new BadRequestException(
        `A chave ${providerLabel(provider)} não funcionou: ${errorMessage(err)}`,
      );
    }
  }

  private async fetchModels(provider: LlmProvider, key: string): Promise<AvailableModel[]> {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: key, timeout: 15_000, maxRetries: 1 });
      const out: AvailableModel[] = [];
      for await (const m of client.models.list({ limit: 100 })) {
        out.push({ id: formatModelId('anthropic', m.id), provider, label: m.display_name || m.id });
      }
      return out;
    }

    const client = new OpenAI({ apiKey: key, timeout: 15_000, maxRetries: 1 });
    const out: AvailableModel[] = [];
    for await (const m of client.models.list()) {
      if (!isOpenAiChatModel(m.id)) continue;
      out.push({ id: formatModelId('openai', m.id), provider, label: m.id });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.cipherKey, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  private decrypt(value: string, organizationId: string, provider: LlmProvider): string | null {
    try {
      const [version, iv, tag, data] = value.split(':');
      if (version !== 'v1' || !iv || !tag || !data) throw new Error('formato desconhecido');
      const decipher = createDecipheriv('aes-256-gcm', this.cipherKey, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (err) {
      // Normalmente: AI_KEYS_SECRET/JWT_SECRET trocado depois de salvar a chave.
      this.logger.error(
        `Não foi possível decifrar a chave ${provider} da org ${organizationId} (${errorMessage(err)}) — salve a chave de novo em Configurações → IA`,
      );
      return null;
    }
  }
}

/** Remove o bloco de chaves antes de devolver a Organization para o front. */
export function stripAiSecrets<T extends { settings?: unknown }>(org: T): T {
  const settings = asObject(org.settings);
  if (!('ai' in settings)) return org;
  const { ai: _ai, ...rest } = settings;
  return { ...org, settings: rest };
}

function isOpenAiChatModel(id: string): boolean {
  if (!/^(gpt-|chatgpt-|o\d)/.test(id)) return false;
  return !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex)/.test(id);
}

function normalizeModelId(id: string): string {
  const parsed = parseModelId(id);
  return parsed ? formatModelId(parsed.provider, parsed.model) : id.trim();
}

function maskKey(key: string): string {
  return key.length <= 8 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`;
}

function providerLabel(p: LlmProvider): string {
  return p === 'openai' ? 'OpenAI (ChatGPT)' : 'Anthropic (Claude)';
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
