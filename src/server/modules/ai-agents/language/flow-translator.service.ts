import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { KvStore } from '../../../runtime/kv-store';
import { LlmService } from '../llm/llm.service';
import { runWithLlmOrg } from '../llm/llm-context';
import { DEFAULT_MODEL_ALIAS } from '../llm/llm.constants';
import { CustomerLanguage, LANGUAGE_NAMES, detectLanguage } from './customer-language';

/** Tradução guardada: o mesmo texto no mesmo idioma é traduzido uma vez só. */
const CACHE_TTL_MS = 180 * 24 * 3_600_000;
const cacheKey = (lang: string, text: string) =>
  `tr:${lang}:${createHash('sha1').update(text).digest('hex')}`;

/**
 * Traduz as mensagens fixas (fluxos, avisos) para o idioma do cliente.
 * Cliente em português: nada muda. Falha na tradução: manda o original.
 */
@Injectable()
export class FlowTranslatorService {
  private readonly logger = new Logger(FlowTranslatorService.name);
  private readonly kv = new KvStore();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** Idioma das últimas mensagens do cliente nesta conversa. */
  async languageOf(conversationId: string): Promise<CustomerLanguage> {
    const recent = await this.prisma.message.findMany({
      where: { conversationId, direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { content: true },
    });
    return detectLanguage(
      recent.reverse().map((m) => String((m.content as { text?: unknown; caption?: unknown } | null)?.text ?? '')),
    );
  }

  async translate(
    texts: string[],
    lang: CustomerLanguage,
    ctx: { organizationId: string; agentId?: string },
  ): Promise<string[]> {
    if (lang === 'pt' || texts.length === 0) return texts;
    const out = [...texts];
    const missing: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (!texts[i].trim()) continue;
      const cached = await this.kv.get(cacheKey(lang, texts[i])).catch(() => null);
      if (cached !== null) out[i] = cached;
      else missing.push(i);
    }
    if (missing.length === 0) return out;

    try {
      const translated = await this.callLlm(
        missing.map((i) => texts[i]),
        lang,
        ctx,
      );
      missing.forEach((i, j) => {
        const t = translated[j];
        if (typeof t !== 'string' || !t.trim()) return;
        out[i] = t;
        void this.kv.set(cacheKey(lang, texts[i]), t, { ttlMs: CACHE_TTL_MS }).catch(() => undefined);
      });
    } catch (err) {
      this.logger.warn(`tradução para ${lang} falhou — enviando em português: ${(err as Error)?.message ?? err}`);
    }
    return out;
  }

  private async callLlm(
    texts: string[],
    lang: Exclude<CustomerLanguage, 'pt'>,
    ctx: { organizationId: string; agentId?: string },
  ): Promise<string[]> {
    const agent = ctx.agentId
      ? await this.prisma.aiAgent.findUnique({ where: { id: ctx.agentId }, select: { modelId: true } })
      : null;
    const target = LANGUAGE_NAMES[lang].en;
    const resp = await runWithLlmOrg(ctx.organizationId, () =>
      this.llm.complete({
        modelId: agent?.modelId ?? DEFAULT_MODEL_ALIAS,
        temperature: 0.2,
        maxTokens: 4000,
        messages: [
          {
            role: 'system',
            content: `You translate customer-service WhatsApp messages from Brazilian Portuguese to ${target}. Keep exactly: WhatsApp formatting (*bold*, _italic_, line breaks, lists), emojis, URLs, e-mails, numbers, prices, currencies, dates, coupon codes (e.g. MINHAVIAGEM), product and brand names. Phone menu paths (e.g. "Ajustes > Celular") must use the labels the phone shows in ${target} (e.g. "Settings > Cellular"). Do not add or remove content. Answer ONLY with a JSON array of strings, same order and length as the input.`,
          },
          { role: 'user', content: JSON.stringify(texts) },
        ],
      }),
    );
    const raw =
      typeof resp.message.content === 'string'
        ? resp.message.content
        : resp.message.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as { text: string }).text)
            .join('');
    const match = raw.match(/\[[\s\S]*\]/);
    const parsed = match ? (JSON.parse(match[0]) as unknown) : null;
    if (!Array.isArray(parsed) || parsed.length !== texts.length) {
      throw new Error('resposta da tradução fora do formato');
    }
    return parsed.map((t) => String(t));
  }
}
