import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KvStore } from '../../../runtime/kv-store';
import { ChatbotSession } from './chatbot-session.types';
import { chatbotSessionKey } from './chatbot-session.keys';

@Injectable()
export class ChatbotSessionService {
  private readonly logger = new Logger(ChatbotSessionService.name);
  // Postgres (kv_store) no lugar do Redis — mesmas chaves e TTL.
  private readonly kv = new KvStore();
  private readonly TTL = 86400; // 24h

  constructor(private readonly config: ConfigService) {}

  private key(conversationId: string): string {
    return chatbotSessionKey(conversationId);
  }

  async get(conversationId: string): Promise<ChatbotSession | null> {
    const raw = await this.kv.get(this.key(conversationId));
    return raw ? JSON.parse(raw) : null;
  }

  async create(conversationId: string, flowId: string, startNodeId: string): Promise<ChatbotSession> {
    const session: ChatbotSession = {
      flowId,
      conversationId,
      currentNodeId: startNodeId,
      variables: {},
      waitingForInput: false,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    await this.kv.set(this.key(conversationId), JSON.stringify(session), { ttlMs: this.TTL * 1000 });
    return session;
  }

  async update(conversationId: string, updates: Partial<ChatbotSession>): Promise<ChatbotSession | null> {
    const session = await this.get(conversationId);
    if (!session) return null;
    const updated = { ...session, ...updates, lastActivityAt: new Date().toISOString() };
    await this.kv.set(this.key(conversationId), JSON.stringify(updated), { ttlMs: this.TTL * 1000 });
    return updated;
  }

  async setVariable(conversationId: string, name: string, value: any): Promise<void> {
    const session = await this.get(conversationId);
    if (!session) return;
    session.variables[name] = value;
    session.lastActivityAt = new Date().toISOString();
    await this.kv.set(this.key(conversationId), JSON.stringify(session), { ttlMs: this.TTL * 1000 });
  }

  async destroy(conversationId: string): Promise<void> {
    await this.kv.del(this.key(conversationId));
  }

  async exists(conversationId: string): Promise<boolean> {
    return this.kv.exists(this.key(conversationId));
  }
}
