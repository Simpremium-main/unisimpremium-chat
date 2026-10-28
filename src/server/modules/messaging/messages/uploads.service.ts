import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { trackBackground } from '../../../runtime/background';
import { defaultUploadsDir } from '../../../runtime/paths';

const execFileAsync = promisify(execFile);

export interface UploadResult {
  url: string;
  mimeType: string;
  size: number;
  filename: string;
}

export type UploadKind = 'audio' | 'media';

export interface SignedUploadResult {
  /** false quando o storage remoto não está configurado — o client usa o multipart. */
  direct: boolean;
  path?: string;
  uploadUrl?: string;
}

/**
 * Stores user-uploaded media (agent recordings) and inbound media we
 * mirror (e.g., WhatsApp Cloud requires a Bearer token to download —
 * browsers can't load it directly, so we re-host it here).
 *
 * Storage driver:
 *  - Supabase Storage (bucket público) quando SUPABASE_URL +
 *    SUPABASE_SERVICE_ROLE_KEY estão definidos — obrigatório na Vercel,
 *    onde o disco é efêmero. URL pública do próprio Supabase.
 *  - Disco local em `uploads/`, servido por `/api/v1/uploads/*`, caso
 *    contrário (desenvolvimento).
 *
 * O layout de caminhos (`inbound/<canal>/<dia>/`, `media/<dia>/`,
 * `audio/<dia>/`) é o mesmo nos dois drivers.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  // 25MB matches OpenAI Whisper's upload cap, so audios we accept are also
  // transcribable without chunking.
  static readonly MAX_AUDIO_BYTES = 25 * 1024 * 1024;

  // 64MB upper bound for any inbound media we mirror. WhatsApp Cloud caps
  // documents at 100MB but most chat content is well under this — bigger
  // files we'd want to stream rather than buffer in memory anyway.
  static readonly MAX_INBOUND_BYTES = 64 * 1024 * 1024;

  private static readonly ALLOWED_AUDIO_MIME = new Set([
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/webm;codecs=opus',
  ]);

  // 64MB: acima do cap de vídeo do WhatsApp (16MB) e de imagem (5MB) — o
  // provider rejeita o que não aceitar; aqui só barramos abusos óbvios.
  static readonly MAX_MEDIA_BYTES = 64 * 1024 * 1024;

  private static readonly ALLOWED_MEDIA_MIME = new Set([
    // image
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    // video
    'video/mp4',
    'video/quicktime',
    'video/3gpp',
    'video/webm',
    // document
    'application/pdf',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ]);

  private readonly rootDir: string;
  private readonly publicBaseUrl: string;
  private readonly supabase: SupabaseClient | null;
  private readonly bucket: string;
  private bucketReady: Promise<void> | null = null;

  /** Prefixo dos uploads diretos (browser → Storage) ainda não finalizados. */
  private static readonly STAGING_PREFIX = 'staging';

  constructor(private readonly config: ConfigService) {
    this.rootDir = path.resolve(
      this.config.get<string>('UPLOADS_DIR') || defaultUploadsDir(),
    );
    const appUrl = this.config.get<string>('APP_URL') || '';
    this.publicBaseUrl = `${appUrl.replace(/\/$/, '')}/api/v1/uploads`;
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }

    const supabaseUrl = this.config.get<string>('SUPABASE_URL');
    const serviceKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.bucket = this.config.get<string>('SUPABASE_STORAGE_BUCKET') || 'chat-uploads';
    this.supabase =
      supabaseUrl && serviceKey
        ? createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
    if (!this.supabase && process.env.VERCEL) {
      this.logger.warn(
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes na Vercel — uploads vão para /tmp e se perdem',
      );
    }
  }

  get usesRemoteStorage(): boolean {
    return !!this.supabase;
  }

  /** Cria o bucket público na primeira escrita, se ainda não existir. */
  private ensureBucket(): Promise<void> {
    if (!this.supabase) return Promise.resolve();
    this.bucketReady ??= (async () => {
      const { data } = await this.supabase!.storage.getBucket(this.bucket);
      if (data) return;
      const { error } = await this.supabase!.storage.createBucket(this.bucket, { public: true });
      if (error && !/already exists/i.test(error.message)) {
        this.bucketReady = null;
        throw new Error(`Supabase bucket ${this.bucket}: ${error.message}`);
      }
    })();
    return this.bucketReady;
  }

  private remotePublicUrl(relPath: string): string {
    return this.supabase!.storage.from(this.bucket).getPublicUrl(relPath).data.publicUrl;
  }

  /**
   * Grava o buffer em `relPath` (layout `<pasta>/<...>/<arquivo>`) no driver
   * ativo e devolve a URL pública.
   */
  private async persist(relPath: string, buffer: Buffer, mime: string): Promise<string> {
    if (this.supabase) {
      await this.ensureBucket();
      const { error } = await this.supabase.storage
        .from(this.bucket)
        .upload(relPath, buffer, { contentType: mime, upsert: true });
      if (error) throw new Error(`Supabase upload ${relPath}: ${error.message}`);
      return this.remotePublicUrl(relPath);
    }
    const fullPath = path.join(this.rootDir, relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
    return `${this.publicBaseUrl}/${relPath}`;
  }

  /**
   * Persists an inbound media buffer (any type — image, video, audio,
   * document, sticker) under a per-channel/per-day folder and returns a
   * playable public URL. Used by adapters whose providers deliver media
   * gated behind auth (WhatsApp Cloud) or via short-lived signed URLs we
   * don't want to depend on.
   *
   * `originalFilename` is preserved when the provider gives one (typical
   * for documents) — useful for the UI to render a familiar filename and
   * for the browser's "Save As" dialog to default sensibly.
   */
  async saveInboundMedia(input: {
    buffer: Buffer;
    mimeType: string;
    channelId: string;
    originalFilename?: string | null;
  }): Promise<UploadResult> {
    if (!input?.buffer?.byteLength) {
      throw new BadRequestException('Empty inbound media');
    }
    if (input.buffer.byteLength > UploadsService.MAX_INBOUND_BYTES) {
      throw new BadRequestException(
        `Inbound media too large (max ${UploadsService.MAX_INBOUND_BYTES / 1024 / 1024}MB)`,
      );
    }

    const mime = (input.mimeType || 'application/octet-stream').split(';')[0].trim();
    const dateFolder = new Date().toISOString().slice(0, 10);
    const safeChannel = (input.channelId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

    const id = crypto.randomBytes(16).toString('hex');
    const ext = this.extFor(mime, input.originalFilename);
    const filename = `${id}${ext}`;
    const relPath = `inbound/${safeChannel}/${dateFolder}/${filename}`;
    const url = await this.persist(relPath, input.buffer, mime);
    this.logger.log(`Inbound media saved: ${relPath} -> ${url}`);
    return {
      url,
      mimeType: mime,
      size: input.buffer.byteLength,
      filename: input.originalFilename || filename,
    };
  }

  /**
   * Upload de mídia do operador (anexo do chat): imagem, vídeo ou documento.
   * Áudio gravado no app continua indo pelo saveAudio (que transcoda pra
   * OGG/Opus voice note); aqui é o caminho do clipe de papel.
   */
  async saveMedia(file: {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
  }): Promise<UploadResult> {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('Empty upload');
    }
    if (file.buffer.byteLength > UploadsService.MAX_MEDIA_BYTES) {
      throw new BadRequestException(
        `File too large (max ${UploadsService.MAX_MEDIA_BYTES / 1024 / 1024}MB)`,
      );
    }
    const mime = (file.mimetype || 'application/octet-stream')
      .split(';')[0]
      .trim();
    if (!UploadsService.ALLOWED_MEDIA_MIME.has(mime)) {
      throw new BadRequestException(`Unsupported file type: ${mime}`);
    }

    const dateFolder = new Date().toISOString().slice(0, 10);

    const id = crypto.randomBytes(16).toString('hex');
    const ext = this.extFor(mime, file.originalname);
    const filename = `${id}${ext}`;
    const relPath = `media/${dateFolder}/${filename}`;
    const url = await this.persist(relPath, file.buffer, mime);
    this.logger.log(`Media saved: ${relPath} -> ${url}`);
    return {
      url,
      mimeType: mime,
      size: file.buffer.byteLength,
      filename: file.originalname || filename,
    };
  }

  async saveAudio(file: {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
  }): Promise<UploadResult> {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('Empty upload');
    }
    if (file.buffer.byteLength > UploadsService.MAX_AUDIO_BYTES) {
      throw new BadRequestException(
        `Audio too large (max ${UploadsService.MAX_AUDIO_BYTES / 1024 / 1024}MB)`,
      );
    }
    // Normalise mimetype: browsers sometimes send `audio/webm;codecs=opus`.
    const mime = (file.mimetype || '').split(';')[0].trim() || 'audio/webm';
    if (!UploadsService.ALLOWED_AUDIO_MIME.has(file.mimetype) && !UploadsService.ALLOWED_AUDIO_MIME.has(mime)) {
      throw new BadRequestException(`Unsupported audio mime type: ${file.mimetype}`);
    }

    const dateFolder = new Date().toISOString().slice(0, 10);
    // ffmpeg trabalha com arquivos: transcodifica num diretório temporário
    // e depois grava o resultado no driver ativo.
    const dir = path.join(os.tmpdir(), 'unisimpremium-audio');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const id = crypto.randomBytes(16).toString('hex');
    const srcExt = this.extFor(mime);
    const srcPath = path.join(dir, `${id}${srcExt}`);
    await fs.promises.writeFile(srcPath, file.buffer);

    // WhatsApp voice notes require OGG/Opus. Browsers (esp. Chrome/Firefox)
    // record in WebM/Opus via MediaRecorder — the codec is compatible but
    // the container is not, so Zappfy rejects the send (HTTP 500). We also
    // rely on the re-encode to write proper duration headers (MediaRecorder
    // streams webm without duration, so the <audio> element shows 0:00).
    let finalPath = srcPath;
    let finalMime = mime;
    if (mime !== 'audio/ogg') {
      const oggPath = path.join(dir, `${id}.ogg`);
      try {
        await execFileAsync(
          UploadsService.ffmpegPath(),
          [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', srcPath,
            '-vn',
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-ac', '1',
            '-ar', '48000',
            '-application', 'voip',
            oggPath,
          ],
          { timeout: 30_000 },
        );
        await fs.promises.unlink(srcPath).catch(() => undefined);
        finalPath = oggPath;
        finalMime = 'audio/ogg';
      } catch (err: any) {
        await fs.promises.unlink(srcPath).catch(() => undefined);
        this.logger.error(`ffmpeg transcode failed: ${err.message}`);
        throw new BadRequestException('Failed to process audio');
      }
    }

    const finalBuffer = await fs.promises.readFile(finalPath);
    await fs.promises.unlink(finalPath).catch(() => undefined);
    const finalSize = finalBuffer.byteLength;
    const finalName = path.basename(finalPath);
    const relPath = `audio/${dateFolder}/${finalName}`;
    const url = await this.persist(relPath, finalBuffer, finalMime);
    this.logger.log(`Audio saved: ${relPath} -> ${url}`);
    return { url, mimeType: finalMime, size: finalSize, filename: finalName };
  }

  /** Binário do ffmpeg: FFMPEG_PATH > ffmpeg-static (empacotado p/ Vercel) > PATH. */
  private static ffmpegPath(): string {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bundled = require('ffmpeg-static') as string | null;
      if (bundled && fs.existsSync(bundled)) return bundled;
    } catch {
      // pacote ausente — cai no ffmpeg do sistema
    }
    return 'ffmpeg';
  }

  // ─── Upload direto (browser → Supabase Storage) ────────────────────
  //
  // A Vercel limita o corpo da request a 4,5MB, abaixo dos limites de
  // áudio (25MB) e mídia (64MB). O client pede uma URL assinada, envia o
  // arquivo direto ao Storage em `staging/…` e chama `completeDirectUpload`,
  // que aplica exatamente as mesmas validações/processamento do multipart.

  async createDirectUpload(input: {
    kind: UploadKind;
    mimeType: string;
    size: number;
    filename?: string;
  }): Promise<SignedUploadResult> {
    if (!this.supabase) return { direct: false };
    this.assertAcceptable(input.kind, input.mimeType, input.size);

    await this.ensureBucket();
    const mime = (input.mimeType || '').split(';')[0].trim();
    const id = crypto.randomBytes(16).toString('hex');
    const ext = this.extFor(mime, input.filename);
    const relPath = `${UploadsService.STAGING_PREFIX}/${input.kind}/${id}${ext}`;
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUploadUrl(relPath);
    if (error || !data) {
      throw new BadRequestException(`Could not create upload URL: ${error?.message ?? 'unknown'}`);
    }
    return { direct: true, path: relPath, uploadUrl: data.signedUrl };
  }

  async completeDirectUpload(input: {
    kind: UploadKind;
    path: string;
    mimeType: string;
    filename?: string;
  }): Promise<UploadResult> {
    if (!this.supabase) throw new BadRequestException('Direct upload not available');
    const expectedPrefix = `${UploadsService.STAGING_PREFIX}/${input.kind}/`;
    if (
      !input.path.startsWith(expectedPrefix) ||
      !/^[a-f0-9]{32}\.[a-z0-9]{1,8}$/i.test(input.path.slice(expectedPrefix.length))
    ) {
      throw new BadRequestException('Invalid upload path');
    }

    const { data: blob, error } = await this.supabase.storage
      .from(this.bucket)
      .download(input.path);
    if (error || !blob) {
      throw new BadRequestException(`Uploaded file not found: ${error?.message ?? input.path}`);
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    // Remove o staging qualquer que seja o resultado da validação.
    trackBackground(
      this.supabase.storage
        .from(this.bucket)
        .remove([input.path])
        .then(({ error: rmErr }) => {
          if (rmErr) this.logger.warn(`staging cleanup ${input.path}: ${rmErr.message}`);
        }),
    );

    const file = { buffer, mimetype: input.mimeType, originalname: input.filename };
    return input.kind === 'audio' ? this.saveAudio(file) : this.saveMedia(file);
  }

  /** Mesmas regras de tamanho/tipo dos endpoints multipart, checadas antes do upload. */
  private assertAcceptable(kind: UploadKind, mimeType: string, size: number): void {
    const mime = (mimeType || '').split(';')[0].trim();
    if (kind === 'audio') {
      if (size > UploadsService.MAX_AUDIO_BYTES) {
        throw new BadRequestException(
          `Audio too large (max ${UploadsService.MAX_AUDIO_BYTES / 1024 / 1024}MB)`,
        );
      }
      if (!UploadsService.ALLOWED_AUDIO_MIME.has(mimeType) && !UploadsService.ALLOWED_AUDIO_MIME.has(mime || 'audio/webm')) {
        throw new BadRequestException(`Unsupported audio mime type: ${mimeType}`);
      }
      return;
    }
    if (size > UploadsService.MAX_MEDIA_BYTES) {
      throw new BadRequestException(
        `File too large (max ${UploadsService.MAX_MEDIA_BYTES / 1024 / 1024}MB)`,
      );
    }
    if (!UploadsService.ALLOWED_MEDIA_MIME.has(mime || 'application/octet-stream')) {
      throw new BadRequestException(`Unsupported file type: ${mime}`);
    }
  }

  private extFor(mime: string, originalFilename?: string | null): string {
    // Prefer the extension from the provider-given filename when present —
    // it survives mime-sniffing oddities (e.g., Meta sometimes returns
    // application/octet-stream for known doc types).
    if (originalFilename) {
      const ext = path.extname(originalFilename).toLowerCase();
      if (ext && /^\.[a-z0-9]{1,8}$/i.test(ext)) return ext;
    }
    const m = (mime || '').toLowerCase();
    // audio
    if (m.includes('ogg')) return '.ogg';
    if (m.includes('mpeg') && m.startsWith('audio/')) return '.mp3';
    if (m.includes('m4a') || (m.includes('mp4') && m.startsWith('audio/'))) return '.m4a';
    if (m.includes('wav')) return '.wav';
    if (m.includes('webm') && m.startsWith('audio/')) return '.webm';
    // image
    if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
    if (m === 'image/png') return '.png';
    if (m === 'image/gif') return '.gif';
    if (m === 'image/webp') return '.webp';
    if (m === 'image/heic') return '.heic';
    // video
    if (m === 'video/mp4') return '.mp4';
    if (m === 'video/quicktime') return '.mov';
    if (m === 'video/3gpp') return '.3gp';
    if (m === 'video/webm') return '.webm';
    // document
    if (m === 'application/pdf') return '.pdf';
    if (m === 'application/zip') return '.zip';
    if (m === 'application/msword') return '.doc';
    if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
    if (m === 'application/vnd.ms-excel') return '.xls';
    if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx';
    if (m === 'application/vnd.ms-powerpoint') return '.ppt';
    if (m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx';
    if (m === 'text/plain') return '.txt';
    if (m === 'text/csv') return '.csv';
    return '.bin';
  }
}
