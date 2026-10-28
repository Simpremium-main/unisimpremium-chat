import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { KvStore } from '../../../runtime/kv-store';
import {
  CONTACT_LOCK_TTL_MS,
} from '../automations.constants';

// Locks e rate limit do motor de automações. Eram chaves Redis (SET NX PX
// + release em Lua + sorted set); agora vivem no KvStore em Postgres
// (tabela kv_store), com as mesmas chaves e a mesma semântica.
@Injectable()
export class AutomationRedisService {
  private readonly logger = new Logger(AutomationRedisService.name);
  private readonly kv = new KvStore();

  constructor(private readonly config: ConfigService) {}

  // Acquire a per-contact lock. Returns the unlock token on success, null
  // on failure (already held). Caller MUST always call `release` even if
  // its work threw — finally block is mandatory.
  async acquireContactLock(contactId: string): Promise<string | null> {
    const key = `automation:lock:contact:${contactId}`;
    const token = randomUUID();
    const acquired = await this.kv.set(key, token, {
      ttlMs: CONTACT_LOCK_TTL_MS,
      nx: true,
    });
    return acquired ? token : null;
  }

  async releaseContactLock(contactId: string, token: string): Promise<void> {
    const key = `automation:lock:contact:${contactId}`;
    // Atomic release: only delete the key if our token still owns the lock.
    // Without this, a slow worker whose lease expired could delete a lock
    // that another worker has already re-acquired.
    await this.kv
      .delIfEquals(key, token)
      .catch((err) =>
        this.logger.warn(`lock release failed for ${contactId}: ${err.message}`),
      );
  }

  // Sliding-window rate limit over 60s. Returns true if the request fits
  // under the limit and was counted; false if the window is full.
  //
  // Implementation: one timestamp list per (automation, conversation) in
  // the KvStore; each call drops entries older than 60s and records itself
  // only if it still fits — atomically (row lock).
  async tryConsumeRateLimit(
    automationId: string,
    conversationId: string | null | undefined,
    perMinute: number,
  ): Promise<boolean> {
    if (!conversationId) return true; // no conversation = no per-conv limit
    if (perMinute <= 0) return true;

    const key = `automation:rate:${automationId}:${conversationId}`;
    const windowMs = 60_000;
    return this.kv.slidingWindowConsume(key, perMinute, windowMs);
  }
}
