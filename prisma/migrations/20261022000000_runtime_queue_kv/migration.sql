-- Fila (BullMQ-compatível) e armazenamento chave-valor em Postgres:
-- substituem o Redis. Usadas por src/server/runtime (pg-queue.ts, kv-store.ts).

-- CreateTable
CREATE TABLE "queue_jobs" (
    "id" BIGSERIAL NOT NULL,
    "queue" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "opts" JSONB NOT NULL,
    "state" TEXT NOT NULL,
    "run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts_made" INTEGER NOT NULL DEFAULT 0,
    "stalled_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "lock_token" TEXT,
    "dedup_id" TEXT,
    "failed_reason" TEXT,
    "return_value" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "queue_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_schedulers" (
    "queue" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "opts" JSONB NOT NULL,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "queue_schedulers_pkey" PRIMARY KEY ("queue","key")
);

-- CreateTable
CREATE TABLE "kv_store" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "kv_store_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "idx_queue_jobs_due" ON "queue_jobs"("queue", "state", "run_at");

-- CreateIndex
CREATE INDEX "idx_queue_jobs_dedup" ON "queue_jobs"("queue", "dedup_id");

-- CreateIndex
CREATE INDEX "idx_queue_jobs_finished" ON "queue_jobs"("queue", "state", "finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "queue_jobs_queue_job_id_key" ON "queue_jobs"("queue", "job_id");

-- CreateIndex
CREATE INDEX "idx_queue_schedulers_next" ON "queue_schedulers"("next_run_at");

-- CreateIndex
CREATE INDEX "idx_kv_store_expires" ON "kv_store"("expires_at");

