import { BullModule } from '@nestjs/bullmq';
import { BullExplorer } from '@nestjs/bullmq/dist/bull.explorer';
import { PgQueue } from './pg-queue';
import { DeferredWorker } from './workers';

/**
 * Troca as implementações do @nestjs/bullmq ANTES de qualquer módulo da API
 * ser carregado: `BullModule.registerQueue()` captura a classe da fila no
 * momento em que cada módulo é avaliado. Por isso este arquivo precisa ser
 * o primeiro import de quem carrega o AppModule (http.ts).
 *
 *  - fila   → PgQueue (Postgres) no lugar da Queue do BullMQ (Redis)
 *  - worker → DeferredWorker (só registra; runWorkers() processa sob demanda)
 */
BullModule.queueClass = PgQueue as any;
BullExplorer.workerClass = DeferredWorker as any;

// Na Vercel, APP_URL (webhook da Zappfy, links de upload) e CORS_ORIGIN
// assumem o domínio de produção do projeto quando não forem definidos.
if (!process.env.APP_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  process.env.APP_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
}
if (!process.env.CORS_ORIGIN && process.env.APP_URL) {
  process.env.CORS_ORIGIN = process.env.APP_URL;
}
