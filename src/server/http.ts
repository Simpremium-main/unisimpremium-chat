import 'reflect-metadata';
// Precisa vir antes do AppModule (ver runtime/install.ts).
import './runtime/install';
import type { IncomingMessage, ServerResponse } from 'http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { waitUntil } from '@vercel/functions';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { OutboxPollerService } from './modules/automations/outbox/outbox-poller.service';
import { AgentRunJanitorService } from './modules/ai-agents/runner/agent-run-janitor.service';
import {
  hasDirtyQueues,
  registeredQueueNames,
  runWorkers,
  RunWorkersReport,
} from './runtime/workers';
import { KvStore } from './runtime/kv-store';
import { drainBackground } from './runtime/background';
import { consumeOutboxDirty } from './runtime/signals';
import { defaultUploadsDir } from './runtime/paths';

/**
 * Ponto de entrada da API dentro do Next.js.
 *
 * Substitui o antigo `main.ts` (NestFactory + app.listen): a aplicação Nest
 * é montada sobre uma instância Express que as rotas de API do Next
 * (`src/pages/api/[[...slug]].ts`) chamam diretamente com (req, res).
 * A configuração (prefixo, helmet, CORS, pipes, filtros, interceptors,
 * Swagger) é a mesma do main.ts original.
 */

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

interface ServerInstance {
  app: INestApplication;
  handler: NodeHandler;
}

/** Funções da cópia "ativa" deste módulo (ver `activeRuntime`). */
interface RuntimeEntry {
  version: number;
  handleHttp: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  runTick: () => Promise<RunWorkersReport & { outbox: number }>;
  dispose: () => Promise<void>;
}

const g = globalThis as unknown as {
  __simpremiumChatRuntime?: RuntimeEntry;
  __simpremiumChatSeq?: number;
  __drainPromise?: Promise<void> | null;
  __localTickTimer?: NodeJS.Timeout;
};

/**
 * Este módulo pode ser avaliado mais de uma vez no mesmo processo: cada rota
 * de API do Next tem seu próprio bundle, e o `next dev` o reavalia quando o
 * código do servidor muda. Só UMA cópia fica ativa (dona do app Nest); as
 * outras delegam para ela — nunca há dois apps disputando o processo.
 *  - produção: a primeira cópia avaliada fica ativa;
 *  - desenvolvimento: a cópia mais nova (código recém-editado) assume e
 *    fecha a anterior uma única vez.
 */
const MODULE_VERSION = (g.__simpremiumChatSeq = (g.__simpremiumChatSeq ?? 0) + 1);
let serverPromise: Promise<ServerInstance> | undefined;

/** Folga para fechar workers antes do maxDuration (300s) da função. */
const AFTER_REQUEST_BUDGET_MS = 240_000;
const TICK_BUDGET_MS = 50_000;
/** Depois de um request, também espera jobs atrasados que vencem logo
 *  (debounce do agente = 10s, backoffs de retry = 1–5s). */
const AFTER_REQUEST_LOOKAHEAD_MS = 15_000;

async function bootstrap(): Promise<ServerInstance> {
  const logger = new Logger('Bootstrap');

  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // helmet blocks cross-origin media by default; relax that for <audio>/<img>
  // tags served by this API (same origin, but browsers enforce CORP).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.setGlobalPrefix('api/v1');

  // Serve locally-stored user uploads (driver de disco — desenvolvimento
  // sem Supabase Storage). Com Supabase as URLs apontam para o Storage.
  const uploadsDir = path.resolve(
    config.get<string>('UPLOADS_DIR') || defaultUploadsDir(),
  );
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use(
    '/api/v1/uploads',
    express.static(uploadsDir, {
      maxAge: '30d',
      fallthrough: false,
      index: false,
    }),
  );
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());

  const swagger = new DocumentBuilder()
    .setTitle('UniSimpremium API')
    .setDescription('Omnichannel customer service API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  // Mesmo caminho do main.ts original. O Next reescreve /docs → rota de API,
  // mas o req.url que chega aqui continua sendo /docs.
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  await app.init();
  logger.log('API ready (Next.js route handler, prefix /api/v1)');

  return { app, handler: server as unknown as NodeHandler };
}

function getServer(): Promise<ServerInstance> {
  serverPromise ??= bootstrap().catch((err) => {
    serverPromise = undefined;
    throw err;
  });
  return serverPromise;
}

async function dispose(): Promise<void> {
  const current = serverPromise;
  serverPromise = undefined;
  if (current) await current.then((s) => s.app.close()).catch(() => undefined);
}

function activeRuntime(): RuntimeEntry {
  const self: RuntimeEntry = {
    version: MODULE_VERSION,
    handleHttp: handleHttpImpl,
    runTick: runTickImpl,
    dispose,
  };
  const current = g.__simpremiumChatRuntime;
  if (!current) {
    g.__simpremiumChatRuntime = self;
  } else if (
    process.env.NODE_ENV === 'development' &&
    current.version < MODULE_VERSION
  ) {
    g.__simpremiumChatRuntime = self;
    void current.dispose();
  }
  startLocalTicker();
  return g.__simpremiumChatRuntime!;
}

/**
 * Trata uma request HTTP (chamado pelas rotas de API do Next). Depois que a
 * resposta termina, drena outbox/filas/broadcasts via `waitUntil`.
 */
export function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return activeRuntime().handleHttp(req, res);
}

/**
 * Tick de 1 minuto: crons/repeatables, jobs atrasados (SLA, watchdog,
 * recuperação de vendas), retries, jobs travados, outbox e janitor.
 * Disparado por /api/internal/tick (cron) — e localmente por um setInterval.
 */
export function runTick(): Promise<RunWorkersReport & { outbox: number }> {
  return activeRuntime().runTick();
}

async function handleHttpImpl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = await getServer();
  const responded = new Promise<void>((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
  });
  // O waitUntil precisa ser registrado ANTES da resposta terminar: chamado
  // depois do 'finish', a Vercel já encerrou a invocação, ignora o pedido e
  // congela a função no meio do trabalho em segundo plano (webhook, fila...).
  waitUntil(responded.then(() => kickDrain(server)));
  server.handler(req, res);
  await responded;
}

/**
 * Uma drenagem por instância por vez: requests concorrentes reaproveitam a
 * mesma promise (o loop de runWorkers já pega filas que ficarem sujas no
 * meio do caminho).
 */
function kickDrain(server: ServerInstance): Promise<void> {
  if (g.__drainPromise) return g.__drainPromise;
  g.__drainPromise = (async () => {
    try {
      for (let round = 0; round < 50; round++) {
        await drainBackground();
        const outbox = consumeOutboxDirty();
        if (outbox) await server.app.get(OutboxPollerService).runOnce();
        if (!hasDirtyQueues()) {
          await drainBackground();
          if (!hasDirtyQueues()) break;
        }
        await runWorkers({
          queues: [],
          budgetMs: AFTER_REQUEST_BUDGET_MS,
          lookaheadMs: AFTER_REQUEST_LOOKAHEAD_MS,
          reason: 'after-request',
          onIteration: async () => {
            if (consumeOutboxDirty()) await server.app.get(OutboxPollerService).runOnce();
          },
        });
      }
    } catch (err) {
      new Logger('ServerlessWorkers').error(`post-response drain failed: ${(err as Error).message}`);
    } finally {
      g.__drainPromise = null;
    }
  })();
  return g.__drainPromise;
}

async function runTickImpl(): Promise<RunWorkersReport & { outbox: number }> {
  const server = await getServer();
  await server.app.get(AgentRunJanitorService).sweepIfDue();
  // Chaves expiradas do KvStore (substituto do Redis) não somem sozinhas.
  await new KvStore().purgeExpired().catch(() => undefined);
  consumeOutboxDirty();
  const outbox = await server.app.get(OutboxPollerService).runOnce();
  const report = await runWorkers({
    queues: registeredQueueNames(),
    budgetMs: TICK_BUDGET_MS,
    // Mesma janela das drenagens pós-request: se o tick pegar uma mensagem
    // recebida, ele espera o debounce do agente (10s) que ela agenda — senão
    // a resposta só sairia no tick seguinte (até 60s depois).
    lookaheadMs: AFTER_REQUEST_LOOKAHEAD_MS,
    reason: 'tick',
    onIteration: async () => {
      if (consumeOutboxDirty()) await server.app.get(OutboxPollerService).runOnce();
    },
  });
  await drainBackground();
  return { ...report, outbox };
}

/** Fora da Vercel (next dev / next start local) não há cron: tick em processo. */
function startLocalTicker(): void {
  if (process.env.VERCEL || process.env.DISABLE_LOCAL_TICK === 'true') return;
  if (g.__localTickTimer) return;
  // Sempre chama a cópia ativa do módulo (nunca a que criou o timer).
  g.__localTickTimer = setInterval(() => {
    runTick().catch((err) =>
      new Logger('LocalTick').error(`tick failed: ${(err as Error).message}`),
    );
  }, 60_000);
  g.__localTickTimer.unref?.();
}
