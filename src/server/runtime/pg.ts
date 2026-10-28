import { Pool, PoolConfig } from 'pg';

/**
 * Pool `pg` do runtime (fila e chave-valor). Separado do Prisma porque a
 * fila é criada pelo @nestjs/bullmq fora da injeção de dependência.
 *
 * Usa a mesma DATABASE_URL do Prisma, removendo os parâmetros que só o
 * Prisma entende (o `pg` os mandaria ao servidor como configuração de
 * sessão). Compatível com o pooler do Supabase em transaction mode: só
 * instruções isoladas e transações curtas, sem estado de sessão.
 */
const PRISMA_ONLY_PARAMS = [
  'pgbouncer',
  'connection_limit',
  'pool_timeout',
  'connect_timeout',
  'socket_timeout',
  'statement_cache_size',
  'schema',
  'sslaccept',
  'sslcert',
  'sslidentity',
  'sslpassword',
];

export function pgConfigFromUrl(url: string): PoolConfig {
  const u = new URL(url);
  for (const p of PRISMA_ONLY_PARAMS) u.searchParams.delete(p);
  const sslmode = u.searchParams.get('sslmode');
  u.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  return {
    connectionString: u.toString(),
    // Supabase aceita TLS; local (embedded/docker) normalmente não.
    ssl: sslmode === 'disable' || (local && sslmode !== 'require') ? false : { rejectUnauthorized: false },
    max: Number(process.env.RUNTIME_PG_POOL_MAX || 3),
    idleTimeoutMillis: 10_000,
  };
}

const g = globalThis as unknown as { __runtimePgPool?: Pool };

export function runtimePool(): Pool {
  if (!g.__runtimePgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definido');
    g.__runtimePgPool = new Pool(pgConfigFromUrl(url));
    g.__runtimePgPool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[runtime-pg] idle client error:', err.message);
    });
  }
  return g.__runtimePgPool;
}
