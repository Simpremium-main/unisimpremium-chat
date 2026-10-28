import { FactoryProvider } from '@nestjs/common';
import { KvStore } from '../../../../runtime/kv-store';

/**
 * Armazenamento da memória curta (últimas mensagens da conversa).
 *
 * Era um cliente Redis local; agora é o KvStore em Postgres (tabela
 * kv_store), com as mesmas chaves, limite de tamanho e TTL. O token foi
 * mantido para não mexer na injeção do ShortTermMemoryService.
 */
export const REDIS_CLIENT_TOKEN = 'SHORT_TERM_REDIS_CLIENT';

export const redisProvider: FactoryProvider<KvStore> = {
  provide: REDIS_CLIENT_TOKEN,
  useFactory: (): KvStore => new KvStore(),
};
