import { Pool } from 'pg';
import { runtimePool } from './pg';

/**
 * Armazenamento chave-valor com expiração sobre Postgres (tabela
 * `kv_store`) — substitui os usos diretos de Redis (locks, idempotência,
 * sessões do chatbot, memória curta da IA, presença, rate limit).
 *
 * Cada método reproduz a semântica do comando Redis equivalente,
 * indicado no comentário. Chave expirada = chave inexistente; o relógio
 * é sempre o do banco (`now()`), igual para todas as instâncias.
 * Toda operação é atômica (uma instrução, ou transação com lock da linha).
 */

const ALIVE = `(kv_store.expires_at IS NULL OR kv_store.expires_at > now())`;
const ttlExpr = (param: string) =>
  `CASE WHEN ${param}::bigint IS NULL THEN NULL ELSE now() + ${param}::bigint * interval '1 millisecond' END`;

export class KvStore {
  constructor(private readonly pool: Pool = runtimePool()) {}

  /** GET */
  async get(key: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT value #>> '{}' AS v FROM kv_store WHERE key = $1 AND ${ALIVE}`,
      [key],
    );
    return rows[0]?.v ?? null;
  }

  /**
   * SET key value [PX ttlMs] [NX]. Retorna true quando gravou ('OK' no
   * Redis) e false quando NX encontrou a chave viva (null no Redis).
   */
  async set(key: string, value: string, opts: { ttlMs?: number; nx?: boolean } = {}): Promise<boolean> {
    const ttl = opts.ttlMs ?? null;
    const sql = opts.nx
      ? `INSERT INTO kv_store (key, value, expires_at) VALUES ($1, to_jsonb($2::text), ${ttlExpr('$3')})
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
         WHERE NOT ${ALIVE}
         RETURNING key`
      : `INSERT INTO kv_store (key, value, expires_at) VALUES ($1, to_jsonb($2::text), ${ttlExpr('$3')})
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
         RETURNING key`;
    const res = await this.pool.query(sql, [key, value, ttl]);
    return res.rowCount === 1;
  }

  /** DEL — retorna quantas chaves vivas foram apagadas. */
  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const { rows } = await this.pool.query(
      `DELETE FROM kv_store WHERE key = ANY($1::text[]) RETURNING ${ALIVE} AS alive`,
      [keys],
    );
    return rows.filter((r) => r.alive).length;
  }

  /** EXISTS (uma chave) */
  async exists(key: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM kv_store WHERE key = $1 AND ${ALIVE}`,
      [key],
    );
    return rowCount === 1;
  }

  /** Quais destas chaves existem (vivas) — uma query pra várias. */
  async existingKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const { rows } = await this.pool.query<{ key: string }>(
      `SELECT key FROM kv_store WHERE key = ANY($1::text[]) AND ${ALIVE}`,
      [keys],
    );
    return new Set(rows.map((r) => r.key));
  }

  /** Chaves vivas com o prefixo (ex.: todas as sessões de robô ativas). */
  async keysWithPrefix(prefix: string, limit = 5000): Promise<string[]> {
    const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { rows } = await this.pool.query<{ key: string }>(
      `SELECT key FROM kv_store WHERE key LIKE $1 AND ${ALIVE} LIMIT $2`,
      [`${escaped}%`, limit],
    );
    return rows.map((r) => r.key);
  }

  /** PEXPIRE — só em chave viva. */
  async expire(key: string, ttlMs: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE kv_store SET expires_at = ${ttlExpr('$2')} WHERE key = $1 AND ${ALIVE}`,
      [key, ttlMs],
    );
    return res.rowCount === 1;
  }

  /**
   * Libera lock só se o valor ainda for o nosso — equivalente ao script
   * Lua `if get(k) == v then del(k)` usado nos locks.
   */
  async delIfEquals(key: string, value: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM kv_store WHERE key = $1 AND value = to_jsonb($2::text) AND ${ALIVE}`,
      [key, value],
    );
    return res.rowCount === 1;
  }

  // ─── Hash ───────────────────────────────────────────────────────

  /** HSET key field value (preserva o TTL de uma chave viva). */
  async hset(key: string, field: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO kv_store (key, value, expires_at) VALUES ($1, jsonb_build_object($2::text, $3::text), NULL)
       ON CONFLICT (key) DO UPDATE SET
         value = CASE WHEN ${ALIVE} THEN kv_store.value || EXCLUDED.value ELSE EXCLUDED.value END,
         expires_at = CASE WHEN ${ALIVE} THEN kv_store.expires_at ELSE NULL END`,
      [key, field, value],
    );
  }

  /** HGET */
  async hget(key: string, field: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT value ->> $2::text AS v FROM kv_store WHERE key = $1 AND ${ALIVE}`,
      [key, field],
    );
    return rows[0]?.v ?? null;
  }

  /** HDEL — apaga a chave quando o hash fica vazio, como o Redis. */
  async hdel(key: string, field: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE kv_store SET value = value - $2::text
         WHERE key = $1 AND ${ALIVE} AND value ? $2::text
         RETURNING value = '{}'::jsonb AS empty`,
        [key, field],
      );
      if (rows[0]?.empty) await client.query(`DELETE FROM kv_store WHERE key = $1`, [key]);
      await client.query('COMMIT');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** HEXISTS */
  async hexists(key: string, field: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM kv_store WHERE key = $1 AND ${ALIVE} AND value ? $2::text`,
      [key, field],
    );
    return rowCount === 1;
  }

  /** HGETALL */
  async hgetall(key: string): Promise<Record<string, string>> {
    const { rows } = await this.pool.query(
      `SELECT value FROM kv_store WHERE key = $1 AND ${ALIVE}`,
      [key],
    );
    const obj = (rows[0]?.value ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
  }

  // ─── Lista ──────────────────────────────────────────────────────

  /** MULTI LPUSH key item / LTRIM key 0 maxLen-1 / EXPIRE key ttl / EXEC */
  async listPushTrim(key: string, item: string, maxLen: number, ttlMs: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO kv_store (key, value, expires_at) VALUES ($1, jsonb_build_array($2::text), ${ttlExpr('$4')})
       ON CONFLICT (key) DO UPDATE SET
         value = (
           SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
           FROM jsonb_array_elements(
             jsonb_build_array($2::text) ||
             CASE WHEN ${ALIVE} AND jsonb_typeof(kv_store.value) = 'array' THEN kv_store.value ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(e, ord)
           WHERE ord <= $3::int
         ),
         expires_at = ${ttlExpr('$4')}`,
      [key, item, maxLen, ttlMs],
    );
  }

  /** LRANGE key start stop (índices inclusivos; stop = -1 → até o fim) */
  async listRange(key: string, start: number, stop: number): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT e #>> '{}' AS v
       FROM kv_store, jsonb_array_elements(kv_store.value) WITH ORDINALITY AS t(e, ord)
       WHERE key = $1 AND ${ALIVE} AND jsonb_typeof(kv_store.value) = 'array'
         AND ord - 1 >= $2::int AND ($3::int < 0 OR ord - 1 <= $3::int)
       ORDER BY ord`,
      [key, start, stop],
    );
    return rows.map((r) => r.v);
  }

  // ─── Janela deslizante ──────────────────────────────────────────

  /**
   * Rate limit de janela deslizante: registra a chamada e retorna true se,
   * contando com ela, cabem no máximo `limit` chamadas nos últimos
   * `windowMs`; senão não registra e retorna false. Equivale ao pipeline
   * ZREMRANGEBYSCORE / ZADD / ZCARD / PEXPIRE + ZREM de rollback.
   */
  async slidingWindowConsume(key: string, limit: number, windowMs: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO kv_store (key, value, expires_at) VALUES ($1, '[]'::jsonb, NULL) ON CONFLICT (key) DO NOTHING`,
        [key],
      );
      const { rows } = await client.query(
        `SELECT CASE WHEN ${ALIVE} AND jsonb_typeof(value) = 'array' THEN value ELSE '[]'::jsonb END AS value,
                (extract(epoch from now()) * 1000)::bigint AS now_ms
         FROM kv_store WHERE key = $1 FOR UPDATE`,
        [key],
      );
      const nowMs = Number(rows[0].now_ms);
      const recent = (rows[0].value as number[]).filter((ts) => ts > nowMs - windowMs);
      const allowed = recent.length + 1 <= limit;
      if (allowed) recent.push(nowMs);
      await client.query(
        `UPDATE kv_store SET value = $2::jsonb, expires_at = now() + $3::bigint * interval '1 millisecond' WHERE key = $1`,
        [key, JSON.stringify(recent), windowMs * 2],
      );
      await client.query('COMMIT');
      return allowed;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Limpeza periódica das chaves expiradas (chamada pelo tick). */
  async purgeExpired(): Promise<number> {
    const res = await this.pool.query(`DELETE FROM kv_store WHERE expires_at <= now()`);
    return res.rowCount ?? 0;
  }
}
