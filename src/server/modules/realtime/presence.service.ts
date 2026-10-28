import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KvStore } from '../../runtime/kv-store';

export interface PresenceInfo {
  userId: string;
  status: 'online' | 'away' | 'offline';
  activeConversationId: string | null;
  lastSeen: string;
}

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  // Postgres (kv_store) no lugar do Redis — mesmo hash por org e TTL.
  private readonly redis = new KvStore();
  private readonly TTL = 120; // 2 min

  constructor(private readonly config: ConfigService) {}

  async setOnline(userId: string, orgId: string): Promise<void> {
    const key = `presence:${orgId}`;
    const data: PresenceInfo = {
      userId,
      status: 'online',
      activeConversationId: null,
      lastSeen: new Date().toISOString(),
    };
    await this.redis.hset(key, userId, JSON.stringify(data));
    await this.redis.expire(key, this.TTL * 1000);
  }

  async setOffline(userId: string, orgId: string): Promise<void> {
    const key = `presence:${orgId}`;
    await this.redis.hdel(key, userId);
  }

  async setActiveConversation(
    userId: string,
    orgId: string,
    conversationId: string | null,
  ): Promise<void> {
    const key = `presence:${orgId}`;
    const raw = await this.redis.hget(key, userId);
    if (!raw) return;

    const data: PresenceInfo = JSON.parse(raw);
    data.activeConversationId = conversationId;
    data.lastSeen = new Date().toISOString();
    await this.redis.hset(key, userId, JSON.stringify(data));
  }

  async getOnlineAgents(orgId: string): Promise<PresenceInfo[]> {
    const key = `presence:${orgId}`;
    const all = await this.redis.hgetall(key);
    return Object.values(all).map((v) => JSON.parse(v));
  }

  async isOnline(userId: string, orgId: string): Promise<boolean> {
    const key = `presence:${orgId}`;
    return this.redis.hexists(key, userId);
  }
}
