-- Sincroniza as migrations com o schema.prisma.
--
-- As 34 migrations anteriores não criavam estes objetos, embora o
-- schema.prisma (e o código) dependam deles — o banco de produção os
-- recebeu fora das migrations (db push / SQL manual). Gerado a partir de
-- `prisma migrate diff --from-migrations … --to-schema-datamodel …` e
-- escrito de forma idempotente: num banco novo cria tudo; num banco que já
-- tem estes objetos (cópia da produção) não altera nada.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AI_TOOL_FAILURE';

-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "department" TEXT,
ADD COLUMN IF NOT EXISTS "operational_context" TEXT,
ADD COLUMN IF NOT EXISTS "operational_context_updated_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "parent_agent_id" TEXT,
ADD COLUMN IF NOT EXISTS "squad" TEXT;

-- AlterTable
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "ai_enabled" BOOLEAN;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ai_agent_parent" ON "ai_agents"("parent_agent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ai_agent_org_dept" ON "ai_agents"("organization_id", "department");

-- Recria a FK de messages.revoked_by com as regras do schema
-- (ON DELETE SET NULL ON UPDATE CASCADE).
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_revoked_by_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agents_parent_agent_id_fkey') THEN
    ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_parent_agent_id_fkey" FOREIGN KEY ("parent_agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- RenameIndex
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uq_pipeline_org_key' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'pipelines_organization_id_key_key' AND relkind = 'i') THEN
    ALTER INDEX "uq_pipeline_org_key" RENAME TO "pipelines_organization_id_key_key";
  END IF;
END $$;
