-- CreateEnum
CREATE TYPE "AiPlaybookStepType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "ai_playbooks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "group_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_playbook_steps" (
    "id" TEXT NOT NULL,
    "playbook_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "type" "AiPlaybookStepType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_playbook_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_playbook_org_active" ON "ai_playbooks"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ai_playbooks_organization_id_slug_key" ON "ai_playbooks"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "idx_playbook_step_order" ON "ai_playbook_steps"("playbook_id", "position");

-- AddForeignKey
ALTER TABLE "ai_playbooks" ADD CONSTRAINT "ai_playbooks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_playbooks" ADD CONSTRAINT "ai_playbooks_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_playbook_steps" ADD CONSTRAINT "ai_playbook_steps_playbook_id_fkey" FOREIGN KEY ("playbook_id") REFERENCES "ai_playbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mesmo padrão do supabase/security.sql: o app acessa como dono (Prisma),
-- a API pública do Supabase não enxerga as tabelas novas.
ALTER TABLE "ai_playbooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_playbook_steps" ENABLE ROW LEVEL SECURITY;
