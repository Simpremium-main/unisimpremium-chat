-- Aprendizado da IA: casos de "pedir ajuda" e base de conhecimento.
-- Idempotente (as migrations aqui são aplicadas à mão).

DO $$ BEGIN
  CREATE TYPE "AiHelpRequestStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ai_help_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "question" TEXT NOT NULL,
    "status" "AiHelpRequestStatus" NOT NULL DEFAULT 'PENDING',
    "guidance" TEXT,
    "draft" JSONB,
    "resolution" JSONB,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_help_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_help_request_org_status" ON "ai_help_requests"("organization_id", "status", "created_at");

DO $$ BEGIN
  ALTER TABLE "ai_help_requests" ADD CONSTRAINT "ai_help_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ai_help_requests" ADD CONSTRAINT "ai_help_requests_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ai_knowledge" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "search_text" TEXT NOT NULL DEFAULT '',
    "search" tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', "search_text")) STORED,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "source_help_request_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_knowledge_org_active" ON "ai_knowledge"("organization_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_knowledge_search" ON "ai_knowledge" USING GIN ("search");

DO $$ BEGIN
  ALTER TABLE "ai_knowledge" ADD CONSTRAINT "ai_knowledge_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Mesmo padrão do supabase/security.sql (acesso só pelo servidor).
ALTER TABLE "ai_help_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_knowledge" ENABLE ROW LEVEL SECURITY;
