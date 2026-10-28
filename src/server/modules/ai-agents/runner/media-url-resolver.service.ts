import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Message } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../../database/prisma.service';
import { defaultUploadsDir } from '../../../runtime/paths';
import { ChannelAdapterRegistry } from '../../channel-hub/channel-adapter.registry';

/**
 * Resolve URLs playable de mídia inbound em batch, pré-build do prompt.
 * Reusa o cache em `Message.content.mediaUrl` (mesmo campo que a UI lê
 * via MediaResolverService) então cada mensagem paga o adapter no máximo
 * uma vez.
 *
 * Por que não reusar `MediaResolverService` direto: aquele vive em
 * MessagingModule, que já importa AiAgentsModule. Importar Messaging aqui
 * fecharia o ciclo. Este service é o subset mínimo: lê content, resolve
 * via adapter, persiste.
 */
/** Mídia pronta para o prompt: URL e, para imagens recentes, os bytes. */
export interface MediaForPrompt {
  url: string;
  mimeType?: string;
  base64?: { mediaType: string; data: string };
}

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Tipo da imagem pelos primeiros bytes (o content-type da CDN nem sempre vem certo). */
export function imageMime(bytes: Buffer, declared?: string | null): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  const d = (declared ?? '').split(';')[0].trim().toLowerCase();
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(d) ? d : null;
}

@Injectable()
export class MediaUrlResolverService {
  private readonly logger = new Logger(MediaUrlResolverService.name);

  /** Diretório físico servido em `/api/v1/uploads` (mesmo cálculo do main.ts). */
  private readonly uploadsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: ChannelAdapterRegistry,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = path.resolve(
      this.config.get<string>('UPLOADS_DIR') || defaultUploadsDir(),
    );
  }

  /**
   * Garante que cada Message recebida (com type=IMAGE/VIDEO/STICKER/
   * DOCUMENT) tem `content.mediaUrl` setado. Mensagens já resolvidas são
   * no-op. Falhas são logadas mas não throw — IA segue com texto descritivo.
   *
   * Retorna um Map<messageId, {url, mimeType}> para uso direto no prompt
   * builder. Mensagens cuja resolução falhou ficam fora do map.
   */
  async resolveMany(
    messages: Message[],
    channelTypeByConversation: Map<string, string>,
  ): Promise<Map<string, { url: string; mimeType?: string }>> {
    const out = new Map<string, { url: string; mimeType?: string }>();

    const mediaTypes = new Set([
      'IMAGE',
      'VIDEO',
      'STICKER',
      'DOCUMENT',
      'AUDIO',
    ]);
    const candidates = messages.filter((m) =>
      mediaTypes.has(m.type as string),
    );
    if (candidates.length === 0) return out;

    for (const message of candidates) {
      try {
        const content = (message.content ?? {}) as Record<string, unknown>;
        const cachedUrl =
          typeof content.mediaUrl === 'string' ? content.mediaUrl : null;
        const cachedMime =
          typeof content.mimeType === 'string' ? content.mimeType : undefined;

        if (cachedUrl && this.isStillServable(cachedUrl)) {
          out.set(message.id, { url: cachedUrl, mimeType: cachedMime });
          continue;
        }

        if (cachedUrl) {
          // URL nossa apontando pra arquivo que não existe mais no disco
          // (upload perdido em troca de container). Mandar ela pro provider
          // faz o download dele falhar e a API devolver 400 "invalid
          // request" — o run INTEIRO morre por causa de uma imagem velha.
          // Tenta re-hospedar a partir do provedor; se não der, a mensagem
          // fica fora do map e o prompt cai no fallback textual.
          this.logger.warn(
            `media-url-resolver: mediaUrl morta pra msg=${message.id} (${cachedUrl}) — tentando re-resolver`,
          );
        }

        if (!message.externalId) continue;

        const channelType = channelTypeByConversation.get(
          message.conversationId,
        );
        if (!channelType) continue;

        const adapter = this.adapterRegistry.getOutbound(channelType as never);
        if (!adapter.resolveInboundMediaUrl) continue;

        const channel = await this.prisma.channel.findFirst({
          where: { conversations: { some: { id: message.conversationId } } },
        });
        if (!channel) continue;

        const { fileUrl, mimeType } = await adapter.resolveInboundMediaUrl(
          channel,
          {
            externalMessageId: message.externalId,
            mediaId:
              typeof content.mediaId === 'string' ? content.mediaId : undefined,
            mimeType: cachedMime,
            originalFilename:
              typeof content.fileName === 'string'
                ? content.fileName
                : undefined,
          },
        );

        // Persiste no Message.content pra UI e próximos runs reusarem.
        await this.prisma.message
          .update({
            where: { id: message.id },
            data: {
              content: {
                ...content,
                mediaUrl: fileUrl,
                ...(mimeType && !cachedMime ? { mimeType } : {}),
              } as never,
            },
          })
          .catch((err: unknown) =>
            this.logger.warn(
              `media-url-resolver: failed to persist mediaUrl for msg=${message.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );

        out.set(message.id, {
          url: fileUrl,
          mimeType: mimeType || cachedMime,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `media-url-resolver: failed for msg=${message.id} type=${message.type}: ${msg}`,
        );
      }
    }

    return out;
  }

  /**
   * Baixa aqui as imagens mais recentes e manda os bytes (base64) ao modelo.
   * Pela URL, o provedor às vezes não consegue baixar a mídia da Zappfy e o
   * run caía no fallback "imagem não carregou" — a IA não via o print.
   */
  async inlineRecentImages(
    messages: Message[],
    media: Map<string, MediaForPrompt>,
    limit = 3,
  ): Promise<void> {
    const images = messages
      .filter((m) => m.type === 'IMAGE' && m.direction === 'INBOUND' && media.get(m.id)?.url)
      .slice(-limit);
    for (const m of images) {
      const entry = media.get(m.id)!;
      try {
        const res = await fetch(entry.url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_INLINE_IMAGE_BYTES) continue;
        const mediaType = imageMime(bytes, res.headers.get('content-type') ?? entry.mimeType);
        if (!mediaType) continue;
        media.set(m.id, { ...entry, mimeType: mediaType, base64: { mediaType, data: bytes.toString('base64') } });
      } catch (err: unknown) {
        this.logger.warn(
          `media-url-resolver: não deu pra baixar a imagem msg=${m.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Uma URL só é enviada ao provider se ele conseguir baixá-la. Pra mídia
   * re-hospedada por nós isso é verificável em disco; pra URL de terceiro
   * assumimos que está viva (não vale um HEAD por mensagem a cada run).
   */
  private isStillServable(url: string): boolean {
    const localPath = this.localUploadPath(url);
    if (!localPath) return true;
    return fs.existsSync(localPath);
  }

  /**
   * Traduz uma URL pública `/api/v1/uploads/...` no caminho físico dentro
   * de UPLOADS_DIR. Retorna null quando a URL não é um upload local nosso.
   */
  private localUploadPath(url: string): string | null {
    const marker = '/api/v1/uploads/';
    const idx = url.indexOf(marker);
    if (idx === -1) return null;

    const appUrl = (this.config.get<string>('APP_URL') || '').replace(
      /\/$/,
      '',
    );
    if (appUrl && !url.startsWith(`${appUrl}${marker}`)) {
      // Mesmo path, outro host: não é o nosso disco.
      return null;
    }

    let relative = url.slice(idx + marker.length).split(/[?#]/)[0];
    try {
      relative = decodeURIComponent(relative);
    } catch {
      // Mantém cru — pior caso o existsSync dá false e a gente re-resolve.
    }

    const full = path.resolve(this.uploadsDir, relative);
    // Path traversal: só aceita o que fica dentro do diretório de uploads.
    if (full !== this.uploadsDir && !full.startsWith(this.uploadsDir + path.sep)) {
      return null;
    }
    return full;
  }
}
