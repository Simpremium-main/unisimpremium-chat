import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { consumeDirtyQueues, hasDirtyQueues, JobRow, PgJob, pgQueueStore } from './pg-queue';
import { pendingBackgroundCount } from './background';

/**
 * Execução dos workers em ambiente serverless, sobre a fila em Postgres.
 *
 * Na Vercel não existe processo vivo para manter workers escutando a
 * fila. Em vez disso:
 *
 *  1. Os `@Processor()` continuam declarados igual — o `BullExplorer` do
 *     @nestjs/bullmq só não cria `Worker` de verdade: recebe um
 *     `DeferredWorker` que apenas registra (fila, processor, opções).
 *  2. `runWorkers()` processa as filas com trabalho e termina quando elas
 *     esvaziam. É chamado:
 *       - depois de cada request que enfileirou job (waitUntil), e
 *       - no tick de 1 minuto (jobs atrasados, crons, retries, travados).
 *
 * O código dos processors não muda.
 */

type Processor = (job: PgJob, token?: string) => Promise<unknown>;

interface Registration {
  queueName: string;
  processor: Processor;
  concurrency: number;
}

const g = globalThis as unknown as { __workerRegistrations?: Map<string, Registration> };
const registrations: Map<string, Registration> = (g.__workerRegistrations ??= new Map());

const logger = new Logger('ServerlessWorkers');

/** Substituto do `Worker` entregue ao BullExplorer: só registra. */
export class DeferredWorker {
  constructor(
    public readonly name: string,
    processor: Processor,
    options: { concurrency?: number } = {},
  ) {
    registrations.set(name, {
      queueName: name,
      processor,
      concurrency: Math.max(1, Number(options.concurrency ?? 1)),
    });
  }
  on() {
    return this;
  }
  off() {
    return this;
  }
  once() {
    return this;
  }
  isRunning() {
    return false;
  }
  async close() {}
}

export { hasDirtyQueues };

export function registeredQueueNames(): string[] {
  return [...registrations.keys()];
}

export interface RunWorkersOptions {
  /** Filas candidatas. Omitido = todas as filas registradas. */
  queues?: Iterable<string>;
  /** Tempo máximo antes de parar de pegar jobs novos. */
  budgetMs: number;
  /** Jobs atrasados que vencem dentro desta janela também são esperados. */
  lookaheadMs: number;
  reason: string;
  /** Executado a cada volta do loop (ex.: drenar o outbox, que gera jobs). */
  onIteration?: () => Promise<void>;
}

export interface RunWorkersReport {
  reason: string;
  started: string[];
  processed: number;
  failed: number;
  durationMs: number;
  timedOut: boolean;
}

const POLL_MS = 300;
const IDLE_CHECKS_TO_STOP = 2;
const LOCK_RENEW_MS = 10_000;
const SCHEDULER_EVERY_MS = 5_000;
const STALLED_CHECK_EVERY_MS = 5_000;

export async function runWorkers(opts: RunWorkersOptions): Promise<RunWorkersReport> {
  const store = pgQueueStore();
  const startedAt = Date.now();
  const deadline = startedAt + opts.budgetMs;
  const candidates = new Set<string>(opts.queues ?? registrations.keys());
  for (const q of consumeDirtyQueues()) candidates.add(q);

  const running = new Map<string, Set<Promise<void>>>();
  const started = new Set<string>();
  const token = randomUUID();
  let processed = 0;
  let failed = 0;
  let idleChecks = 0;
  let timedOut = false;
  let lastSchedulerAt = 0;
  const lastStalledCheck = new Map<string, number>();
  let wake: (() => void) | null = null;

  const runningCount = () => [...running.values()].reduce((n, s) => n + s.size, 0);

  const processJob = (reg: Registration, row: JobRow): Promise<void> => {
    const job = new PgJob(store, row);
    const renew = setInterval(() => {
      store.extendLock(row, token).catch((err) => logger.warn(`renew lock ${row.queue}/${row.job_id}: ${err.message}`));
    }, LOCK_RENEW_MS);
    return (async () => {
      try {
        const result = await reg.processor(job, token);
        if (await store.complete(row, token, result)) processed++;
      } catch (err: any) {
        failed++;
        logger.warn(`job failed queue=${row.queue} id=${row.job_id}: ${err?.message ?? err}`);
        await store.fail(row, token, err).catch((e) => logger.error(`mark failed ${row.job_id}: ${e.message}`));
      } finally {
        clearInterval(renew);
      }
    })();
  };

  try {
    while (true) {
      if (opts.onIteration) {
        try {
          await opts.onIteration();
        } catch (err: any) {
          logger.error(`onIteration failed: ${err?.message ?? err}`);
        }
      }
      for (const q of consumeDirtyQueues()) candidates.add(q);

      if (Date.now() >= deadline) {
        timedOut = runningCount() > 0 || candidates.size > 0;
        break;
      }

      const names = [...candidates].filter((n) => registrations.has(n));
      try {
        if (Date.now() - lastSchedulerAt >= SCHEDULER_EVERY_MS) {
          lastSchedulerAt = Date.now();
          await store.promoteSchedulers(names);
        }
        const withWork = await store.queuesWithWork(names, opts.lookaheadMs);
        for (const name of withWork) {
          const reg = registrations.get(name)!;
          // Lock vencido (instância que morreu no meio do job) pode surgir a
          // qualquer momento: rechecagem periódica, não só na primeira volta.
          if (Date.now() - (lastStalledCheck.get(name) ?? 0) >= STALLED_CHECK_EVERY_MS) {
            lastStalledCheck.set(name, Date.now());
            await store.recoverStalled(name);
          }
          const set = running.get(name) ?? new Set<Promise<void>>();
          running.set(name, set);
          const rows = await store.claim(name, reg.concurrency - set.size, token);
          for (const row of rows) {
            started.add(name);
            const p = processJob(reg, row).finally(() => {
              set.delete(p);
              wake?.();
            });
            set.add(p);
          }
        }
        // Tarefas em segundo plano disparadas pelos jobs (ex.: o processor de
        // mensagens dispara o agente sem await) ainda podem enfileirar jobs —
        // como o debounce do agente — então também contam como trabalho.
        if (
          withWork.size === 0 &&
          runningCount() === 0 &&
          !hasDirtyQueues() &&
          pendingBackgroundCount() === 0
        ) {
          if (++idleChecks >= IDLE_CHECKS_TO_STOP) break;
        } else {
          idleChecks = 0;
        }
      } catch (err: any) {
        logger.error(`worker loop: ${err?.message ?? err}`);
      }

      // Espera um intervalo — ou menos, se algum job terminar.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_MS);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
      wake = null;
    }
  } finally {
    // Jobs já pegos sempre terminam (o lock é renovado enquanto rodam).
    await Promise.all([...running.values()].flatMap((s) => [...s]));
  }

  const report: RunWorkersReport = {
    reason: opts.reason,
    started: [...started],
    processed,
    failed,
    durationMs: Date.now() - startedAt,
    timedOut,
  };
  if (started.size > 0) {
    logger.log(
      `drain(${opts.reason}) queues=[${report.started.join(',')}] processed=${processed} failed=${failed} ${report.durationMs}ms${timedOut ? ' (budget hit)' : ''}`,
    );
  }
  return report;
}
