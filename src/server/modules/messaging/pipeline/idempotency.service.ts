import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KvStore } from '../../../runtime/kv-store';

/**
 * Atomic idempotency + distributed locks, backed by the KvStore
 * (Postgres `kv_store`, same keys/TTLs the Redis version used).
 *
 * `claimProcessing` uses SET NX EX so two concurrent workers cannot both
 * believe they are the first to process a given externalMessageId.
 *
 * `acquireLock` / `releaseLock` implement a per-key mutex for serialising
 * contact/conversation upserts to avoid duplicate rows when a burst of
 * messages from the same new contact arrives.
 */
@Injectable()
export class IdempotencyService implements OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly kv = new KvStore();
  private static readonly TTL_SECONDS = 24 * 60 * 60; // 24h
  private static readonly LOCK_TTL_MS = 10_000;

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    // KvStore usa o pool compartilhado do runtime — nada a fechar aqui.
  }

  private key(channelId: string, externalMessageId: string): string {
    return `idemp:${channelId}:${externalMessageId}`;
  }

  /**
   * Atomic claim. Returns true when THIS caller won the race (and therefore
   * must process the message). Returns false when the message was already
   * claimed — caller MUST skip.
   */
  async claimProcessing(
    externalMessageId: string,
    channelId: string,
  ): Promise<boolean> {
    if (!externalMessageId) return true;
    return this.kv.set(this.key(channelId, externalMessageId), '1', {
      ttlMs: IdempotencyService.TTL_SECONDS * 1000,
      nx: true,
    });
  }

  /** Post-hoc mark — only used when we SKIP the processing path but
   *  still want to short-circuit later duplicate webhooks (e.g. an outbound
   *  that was already persisted by MessagesService). */
  async markProcessed(
    externalMessageId: string,
    channelId: string,
  ): Promise<void> {
    if (!externalMessageId) return;
    await this.kv.set(this.key(channelId, externalMessageId), '1', {
      ttlMs: IdempotencyService.TTL_SECONDS * 1000,
    });
  }

  /** Undo a claim so a retry of the same message can process it again. */
  async releaseClaim(
    externalMessageId: string,
    channelId: string,
  ): Promise<void> {
    if (!externalMessageId) return;
    await this.kv.del(this.key(channelId, externalMessageId));
  }

  async isDuplicate(
    externalMessageId: string,
    channelId: string,
  ): Promise<boolean> {
    if (!externalMessageId) return false;
    return this.kv.exists(this.key(channelId, externalMessageId));
  }

  /**
   * Cooperative lock for serialising upserts. Returns a release token when
   * the lock was acquired, null otherwise. Caller retries with small jitter.
   */
  async acquireLock(lockKey: string, ttlMs = IdempotencyService.LOCK_TTL_MS): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const acquired = await this.kv.set(`lock:${lockKey}`, token, { ttlMs, nx: true });
    return acquired ? token : null;
  }

  async releaseLock(lockKey: string, token: string): Promise<void> {
    // Delete only if value matches (prevents releasing someone else's lock)
    try {
      await this.kv.delIfEquals(`lock:${lockKey}`, token);
    } catch (err: any) {
      this.logger.warn(`releaseLock failed for ${lockKey}: ${err.message}`);
    }
  }

  async withLock<T>(
    lockKey: string,
    fn: () => Promise<T>,
    opts: { ttlMs?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    const ttlMs = opts.ttlMs ?? IdempotencyService.LOCK_TTL_MS;
    const timeoutMs = opts.timeoutMs ?? 5_000;
    const start = Date.now();
    while (true) {
      const token = await this.acquireLock(lockKey, ttlMs);
      if (token) {
        try {
          return await fn();
        } finally {
          await this.releaseLock(lockKey, token);
        }
      }
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`Timed out acquiring lock ${lockKey}`);
      }
      await new Promise((r) => setTimeout(r, 25 + Math.floor(Math.random() * 50)));
    }
  }
}
