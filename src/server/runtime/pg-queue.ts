import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { parseExpression } from 'cron-parser';
import { runtimePool } from './pg';

/**
 * Fila sobre Postgres (tabelas `queue_jobs` e `queue_schedulers`) com a
 * semântica do BullMQ que o app usa — entregue ao @nestjs/bullmq via
 * `BullModule.queueClass`, então `@InjectQueue` / `queue.add(...)` /
 * `@Processor` continuam iguais.
 *
 * Suportado (é tudo o que o código usa):
 *  - add(name, data, { delay, attempts, backoff, jobId, removeOnComplete,
 *    removeOnFail, deduplication: { id, ttl, extend, replace },
 *    repeat: { pattern } })
 *  - getJob(id) → job.remove(); getJobCounts(...)
 *
 * Semântica (BullMQ 5):
 *  - jobId: se já existe job com o mesmo id (em qualquer estado, enquanto
 *    não removido pela retenção), o add não faz nada e devolve o existente.
 *  - attempts (padrão 1) + backoff exponencial `delay * 2^(tentativa-1)`
 *    ou fixo.
 *  - removeOnComplete/removeOnFail: true apaga; número N mantém os N mais
 *    recentes; { age, count } apaga mais velhos que `age` s e além de
 *    `count`; ausente/false mantém.
 *  - deduplication: com job pendente (waiting/delayed/active) de mesma id
 *    e dentro do ttl, o add é ignorado; `extend` renova o ttl; `replace`
 *    troca dados/opções e reinicia o delay se o job ainda está delayed.
 *  - repeat.pattern: agenda (cron) — um job por ocorrência, sem
 *    recuperar ocorrências perdidas.
 *  - jobs travados (lock vencido) voltam para a fila uma vez; na segunda
 *    vez falham (maxStalledCount = 1).
 */

export type JobState = 'waiting' | 'delayed' | 'active' | 'completed' | 'failed';

type KeepJobs = boolean | number | { age?: number; count?: number };

interface Backoff {
  type?: 'exponential' | 'fixed';
  delay?: number;
}

export interface AddOptions {
  delay?: number;
  attempts?: number;
  backoff?: number | Backoff;
  jobId?: string;
  removeOnComplete?: KeepJobs;
  removeOnFail?: KeepJobs;
  deduplication?: { id: string; ttl?: number; extend?: boolean; replace?: boolean };
  repeat?: { pattern: string };
  [key: string]: unknown;
}

interface StoredOpts extends AddOptions {
  /** Validade da deduplicação (epoch ms); ausente = enquanto pendente. */
  dedupUntil?: number;
}

export interface JobRow {
  id: string; // bigint
  queue: string;
  job_id: string;
  name: string;
  data: any;
  opts: StoredOpts;
  state: JobState;
  attempts_made: number;
  created_at: Date;
  processed_at: Date | null;
  finished_at: Date | null;
  failed_reason: string | null;
  return_value: any;
  lock_token: string | null;
}

// ─── Sinal de "fila suja" para o runtime drenar após a resposta ──────

const g = globalThis as unknown as { __pgDirtyQueues?: Set<string> };
const dirtyQueues: Set<string> = (g.__pgDirtyQueues ??= new Set());

export function hasDirtyQueues(): boolean {
  return dirtyQueues.size > 0;
}

export function consumeDirtyQueues(): string[] {
  const list = [...dirtyQueues];
  dirtyQueues.clear();
  return list;
}

// ─── Job ─────────────────────────────────────────────────────────────

/** Subconjunto da API de `Job` do BullMQ usado pelo app e pelos processors. */
export class PgJob<T = any> {
  readonly id: string;
  readonly name: string;
  data: T;
  readonly opts: StoredOpts;
  readonly queueName: string;
  attemptsMade: number;
  readonly timestamp: number;
  readonly delay: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  returnvalue: any;
  progress = 0;

  constructor(
    private readonly store: PgQueueStore,
    readonly row: JobRow,
  ) {
    this.id = row.job_id;
    this.name = row.name;
    this.data = row.data;
    this.opts = row.opts ?? {};
    this.queueName = row.queue;
    this.attemptsMade = row.attempts_made;
    this.timestamp = new Date(row.created_at).getTime();
    this.delay = this.opts.delay ?? 0;
    this.processedOn = row.processed_at ? new Date(row.processed_at).getTime() : undefined;
    this.finishedOn = row.finished_at ? new Date(row.finished_at).getTime() : undefined;
    this.failedReason = row.failed_reason ?? undefined;
    this.returnvalue = row.return_value;
  }

  /** Como no BullMQ: não remove job em processamento (lock de outro worker). */
  async remove(): Promise<void> {
    await this.store.removeJob(this.queueName, this.id);
  }

  async getState(): Promise<JobState | 'unknown'> {
    return (await this.store.getState(this.queueName, this.id)) ?? 'unknown';
  }

  async updateProgress(progress: number): Promise<void> {
    this.progress = progress;
  }

  async log(): Promise<number> {
    return 0;
  }
}

// ─── Acesso ao banco ─────────────────────────────────────────────────

const LOCK_MS = 30_000;

function backoffDelay(backoff: AddOptions['backoff'], attemptsMade: number): number {
  if (backoff === undefined || backoff === null) return 0;
  if (typeof backoff === 'number') return backoff;
  const base = backoff.delay ?? 0;
  if (backoff.type === 'exponential') return Math.round(Math.pow(2, attemptsMade - 1) * base);
  return base;
}

function nextCronRun(pattern: string, after: Date): Date {
  return parseExpression(pattern, { currentDate: after }).next().toDate();
}

export class PgQueueStore {
  constructor(private readonly pool: Pool = runtimePool()) {}

  async add(queue: string, name: string, data: unknown, opts: AddOptions = {}): Promise<PgJob> {
    if (opts.repeat?.pattern) return this.upsertScheduler(queue, name, data, opts);

    const delay = Math.max(0, Number(opts.delay ?? 0));
    const jobId = opts.jobId != null ? String(opts.jobId) : randomUUID();
    const stored: StoredOpts = { ...opts, delay };
    const dataJson = JSON.stringify(data ?? {});

    const row = opts.deduplication
      ? await this.addDeduplicated(queue, name, dataJson, jobId, stored, delay)
      : await this.insert(this.pool, queue, name, dataJson, jobId, stored, delay, null);

    dirtyQueues.add(queue);
    return new PgJob(this, row);
  }

  private async insert(
    db: Pool | import('pg').PoolClient,
    queue: string,
    name: string,
    dataJson: string,
    jobId: string,
    opts: StoredOpts,
    delay: number,
    dedupId: string | null,
  ): Promise<JobRow> {
    const ins = await db.query(
      `INSERT INTO queue_jobs (queue, job_id, name, data, opts, state, run_at, dedup_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, now() + $7::bigint * interval '1 millisecond', $8)
       ON CONFLICT (queue, job_id) DO NOTHING
       RETURNING *`,
      [queue, jobId, name, dataJson, JSON.stringify(opts), delay > 0 ? 'delayed' : 'waiting', delay, dedupId],
    );
    if (ins.rows[0]) return ins.rows[0];
    // jobId repetido: o add é ignorado e devolve o job existente.
    const existing = await db.query(`SELECT * FROM queue_jobs WHERE queue = $1 AND job_id = $2`, [queue, jobId]);
    return existing.rows[0];
  }

  private async addDeduplicated(
    queue: string,
    name: string,
    dataJson: string,
    jobId: string,
    opts: StoredOpts,
    delay: number,
  ): Promise<JobRow> {
    const dedup = opts.deduplication!;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializa adds concorrentes da mesma chave de deduplicação.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`dedup:${queue}:${dedup.id}`]);
      const { rows } = await client.query(
        `SELECT *, (extract(epoch from now()) * 1000)::bigint AS now_ms FROM queue_jobs
         WHERE queue = $1 AND dedup_id = $2 AND state IN ('waiting', 'delayed', 'active')
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [queue, dedup.id],
      );
      const existing = rows[0] as (JobRow & { now_ms: string }) | undefined;
      const nowMs = existing ? Number(existing.now_ms) : Date.now();
      const alive =
        existing && (existing.opts?.dedupUntil === undefined || existing.opts.dedupUntil > nowMs);

      let result: JobRow;
      if (existing && alive) {
        const dedupUntil = dedup.extend && dedup.ttl ? nowMs + dedup.ttl : existing.opts.dedupUntil;
        if (dedup.replace && existing.state === 'delayed') {
          const upd = await client.query(
            `UPDATE queue_jobs SET name = $2, data = $3::jsonb, opts = $4::jsonb,
               run_at = now() + $5::bigint * interval '1 millisecond'
             WHERE id = $1 RETURNING *`,
            [existing.id, name, dataJson, JSON.stringify({ ...opts, dedupUntil }), delay],
          );
          result = upd.rows[0];
        } else if (dedup.extend && dedup.ttl) {
          const upd = await client.query(
            `UPDATE queue_jobs SET opts = opts || jsonb_build_object('dedupUntil', $2::bigint) WHERE id = $1 RETURNING *`,
            [existing.id, dedupUntil],
          );
          result = upd.rows[0];
        } else {
          result = existing;
        }
      } else {
        const dedupUntil = dedup.ttl ? nowMs + dedup.ttl : undefined;
        result = await this.insert(client, queue, name, dataJson, jobId, { ...opts, dedupUntil }, delay, dedup.id);
      }
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async upsertScheduler(queue: string, name: string, data: unknown, opts: AddOptions): Promise<PgJob> {
    const pattern = opts.repeat!.pattern;
    const key = opts.jobId != null ? String(opts.jobId) : `${name}:${pattern}`;
    const { repeat: _repeat, jobId: _jobId, ...jobOpts } = opts;
    const next = nextCronRun(pattern, new Date());
    // Reregistrar com o mesmo padrão mantém a próxima execução já agendada
    // (cada cold start registra os crons de novo).
    await this.pool.query(
      `INSERT INTO queue_schedulers (queue, key, name, pattern, data, opts, next_run_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, now())
       ON CONFLICT (queue, key) DO UPDATE SET
         name = EXCLUDED.name, data = EXCLUDED.data, opts = EXCLUDED.opts, updated_at = now(),
         next_run_at = CASE WHEN queue_schedulers.pattern = EXCLUDED.pattern
                            THEN queue_schedulers.next_run_at ELSE EXCLUDED.next_run_at END,
         pattern = EXCLUDED.pattern`,
      [queue, key, name, pattern, JSON.stringify(data ?? {}), JSON.stringify(jobOpts), next],
    );
    const now = new Date();
    return new PgJob(this, {
      id: '0', queue, job_id: `repeat:${key}`, name, data, opts: jobOpts, state: 'delayed',
      attempts_made: 0, created_at: now, processed_at: null, finished_at: null,
      failed_reason: null, return_value: null, lock_token: null,
    });
  }

  /** Materializa as ocorrências de cron vencidas em jobs. */
  async promoteSchedulers(queues?: string[]): Promise<number> {
    const client = await this.pool.connect();
    let created = 0;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT *, now() AS db_now FROM queue_schedulers
         WHERE next_run_at <= now() AND ($1::text[] IS NULL OR queue = ANY($1::text[]))
         FOR UPDATE SKIP LOCKED`,
        [queues ?? null],
      );
      for (const s of rows) {
        const runAt: Date = s.next_run_at;
        const ins = await client.query(
          `INSERT INTO queue_jobs (queue, job_id, name, data, opts, state, run_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'waiting', $6)
           ON CONFLICT (queue, job_id) DO NOTHING`,
          [s.queue, `repeat:${s.key}:${runAt.getTime()}`, s.name, JSON.stringify(s.data), JSON.stringify(s.opts), runAt],
        );
        created += ins.rowCount ?? 0;
        const after = new Date(Math.max(new Date(s.db_now).getTime(), runAt.getTime()));
        await client.query(
          `UPDATE queue_schedulers SET next_run_at = $3, updated_at = now() WHERE queue = $1 AND key = $2`,
          [s.queue, s.key, nextCronRun(s.pattern, after)],
        );
        dirtyQueues.add(s.queue);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return created;
  }

  /** Filas (entre as pedidas) com job a processar agora ou dentro de `lookaheadMs`. */
  async queuesWithWork(queues: string[], lookaheadMs: number): Promise<Set<string>> {
    if (queues.length === 0) return new Set();
    const { rows } = await this.pool.query(
      `SELECT DISTINCT queue FROM queue_jobs
       WHERE queue = ANY($1::text[]) AND (
         (state IN ('waiting', 'delayed') AND run_at <= now() + $2::bigint * interval '1 millisecond')
         OR (state = 'active' AND locked_until < now())
       )
       UNION
       SELECT DISTINCT queue FROM queue_schedulers WHERE queue = ANY($1::text[]) AND next_run_at <= now()`,
      [queues, lookaheadMs],
    );
    return new Set(rows.map((r) => r.queue));
  }

  /** Jobs com lock vencido: 1ª vez voltam para a fila; 2ª vez falham. */
  async recoverStalled(queue: string): Promise<number> {
    const { rows } = await this.pool.query(
      `UPDATE queue_jobs SET
         state = CASE WHEN stalled_count >= 1 THEN 'failed' ELSE 'waiting' END,
         failed_reason = CASE WHEN stalled_count >= 1 THEN 'job stalled more than allowable limit' ELSE failed_reason END,
         finished_at = CASE WHEN stalled_count >= 1 THEN now() ELSE NULL END,
         stalled_count = stalled_count + 1, lock_token = NULL, locked_until = NULL, run_at = now()
       WHERE queue = $1 AND state = 'active' AND locked_until < now()
       RETURNING *`,
      [queue],
    );
    for (const r of rows as JobRow[]) {
      if (r.state === 'failed') await this.applyRetention(r, 'failed');
    }
    return rows.length;
  }

  /** Pega até `limit` jobs vencidos (FIFO) com lock exclusivo. */
  async claim(queue: string, limit: number, token: string): Promise<JobRow[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query(
      `UPDATE queue_jobs SET state = 'active', lock_token = $3, processed_at = now(),
         locked_until = now() + $4::bigint * interval '1 millisecond'
       WHERE id IN (
         SELECT id FROM queue_jobs
         WHERE queue = $1 AND state IN ('waiting', 'delayed') AND run_at <= now()
         ORDER BY run_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [queue, limit, token, LOCK_MS],
    );
    return (rows as JobRow[]).sort((a, b) => Number(a.id) - Number(b.id));
  }

  async extendLock(row: JobRow, token: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE queue_jobs SET locked_until = now() + $3::bigint * interval '1 millisecond'
       WHERE id = $1 AND lock_token = $2 AND state = 'active'`,
      [row.id, token, LOCK_MS],
    );
    return res.rowCount === 1;
  }

  async complete(row: JobRow, token: string, returnValue: unknown): Promise<boolean> {
    let json: string | null = null;
    try {
      json = returnValue === undefined ? null : JSON.stringify(returnValue);
    } catch {
      json = null;
    }
    const { rows } = await this.pool.query(
      `UPDATE queue_jobs SET state = 'completed', finished_at = now(), return_value = $3::jsonb,
         lock_token = NULL, locked_until = NULL, attempts_made = attempts_made + 1
       WHERE id = $1 AND lock_token = $2 RETURNING *`,
      [row.id, token, json],
    );
    if (!rows[0]) return false; // lock perdido (job retomado por outra instância)
    await this.applyRetention(rows[0], 'completed');
    return true;
  }

  async fail(row: JobRow, token: string, err: unknown): Promise<'retry' | 'failed' | 'lost'> {
    const reason = err instanceof Error ? err.message : String(err);
    const attemptsMade = row.attempts_made + 1;
    const attempts = Math.max(1, Number(row.opts?.attempts ?? 1));
    if (attemptsMade < attempts) {
      const delay = backoffDelay(row.opts?.backoff, attemptsMade);
      const res = await this.pool.query(
        `UPDATE queue_jobs SET state = 'delayed', attempts_made = $3, failed_reason = $4,
           run_at = now() + $5::bigint * interval '1 millisecond', lock_token = NULL, locked_until = NULL
         WHERE id = $1 AND lock_token = $2`,
        [row.id, token, attemptsMade, reason.slice(0, 2000), delay],
      );
      if (res.rowCount === 1) dirtyQueues.add(row.queue);
      return res.rowCount === 1 ? 'retry' : 'lost';
    }
    const { rows } = await this.pool.query(
      `UPDATE queue_jobs SET state = 'failed', attempts_made = $3, failed_reason = $4, finished_at = now(),
         lock_token = NULL, locked_until = NULL
       WHERE id = $1 AND lock_token = $2 RETURNING *`,
      [row.id, token, attemptsMade, reason.slice(0, 2000)],
    );
    if (!rows[0]) return 'lost';
    await this.applyRetention(rows[0], 'failed');
    return 'failed';
  }

  /** removeOnComplete / removeOnFail do job que acabou de terminar. */
  private async applyRetention(row: JobRow, state: 'completed' | 'failed'): Promise<void> {
    const keep = (state === 'completed' ? row.opts?.removeOnComplete : row.opts?.removeOnFail) as KeepJobs | undefined;
    if (keep === undefined || keep === false) return;
    if (keep === true) {
      await this.pool.query(`DELETE FROM queue_jobs WHERE id = $1`, [row.id]);
      return;
    }
    const count = typeof keep === 'number' ? keep : keep.count;
    const age = typeof keep === 'number' ? undefined : keep.age;
    if (age !== undefined) {
      await this.pool.query(
        `DELETE FROM queue_jobs WHERE queue = $1 AND state = $2 AND finished_at < now() - $3::bigint * interval '1 second'`,
        [row.queue, state, age],
      );
    }
    if (count !== undefined) {
      await this.pool.query(
        `DELETE FROM queue_jobs WHERE queue = $1 AND state = $2 AND id NOT IN (
           SELECT id FROM queue_jobs WHERE queue = $1 AND state = $2
           ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT $3
         )`,
        [row.queue, state, Math.max(0, count)],
      );
    }
  }

  async getJob(queue: string, jobId: string): Promise<PgJob | undefined> {
    const { rows } = await this.pool.query(`SELECT * FROM queue_jobs WHERE queue = $1 AND job_id = $2`, [queue, jobId]);
    return rows[0] ? new PgJob(this, rows[0]) : undefined;
  }

  async getState(queue: string, jobId: string): Promise<JobState | undefined> {
    const { rows } = await this.pool.query(`SELECT state FROM queue_jobs WHERE queue = $1 AND job_id = $2`, [queue, jobId]);
    return rows[0]?.state;
  }

  async removeJob(queue: string, jobId: string): Promise<void> {
    const res = await this.pool.query(
      `DELETE FROM queue_jobs WHERE queue = $1 AND job_id = $2 AND state <> 'active'`,
      [queue, jobId],
    );
    if (res.rowCount === 0 && (await this.getState(queue, jobId)) === 'active') {
      throw new Error(`Job ${jobId} could not be removed because it is locked by another worker`);
    }
  }

  async getJobCounts(queue: string, types: string[]): Promise<Record<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT state, count(*)::int AS n FROM queue_jobs WHERE queue = $1 GROUP BY state`,
      [queue],
    );
    const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
    const wanted = types.length ? types : ['waiting', 'delayed', 'active', 'completed', 'failed'];
    return Object.fromEntries(wanted.map((t) => [t, by[t === 'wait' ? 'waiting' : t] ?? 0]));
  }
}

// ─── Queue (o que o @nestjs/bullmq instancia e o app injeta) ────────

const sharedStore = (): PgQueueStore => {
  const gs = globalThis as unknown as { __pgQueueStore?: PgQueueStore };
  return (gs.__pgQueueStore ??= new PgQueueStore());
};

export class PgQueue {
  readonly name: string;
  readonly opts: Record<string, unknown>;

  constructor(name: string, opts: Record<string, unknown> = {}) {
    this.name = name;
    this.opts = opts;
  }

  add(name: string, data: unknown, opts?: AddOptions): Promise<PgJob> {
    return sharedStore().add(this.name, name, data, opts);
  }

  async addBulk(jobs: { name: string; data: unknown; opts?: AddOptions }[]): Promise<PgJob[]> {
    const out: PgJob[] = [];
    for (const j of jobs) out.push(await this.add(j.name, j.data, j.opts));
    return out;
  }

  getJob(jobId: string): Promise<PgJob | undefined> {
    return sharedStore().getJob(this.name, String(jobId));
  }

  getJobCounts(...types: string[]): Promise<Record<string, number>> {
    return sharedStore().getJobCounts(this.name, types);
  }

  on(): this {
    return this;
  }

  async close(): Promise<void> {}
}

export { sharedStore as pgQueueStore };
