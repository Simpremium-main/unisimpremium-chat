-- Notas internas: autor atendente OU agente de IA, opcionalmente presas a
-- uma mensagem. Idempotente (as migrations aqui são aplicadas à mão).

DO $$ BEGIN
  CREATE TYPE "InternalNoteAuthorType" AS ENUM ('USER', 'AI');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "internal_notes" ALTER COLUMN "author_id" DROP NOT NULL;
ALTER TABLE "internal_notes" ADD COLUMN IF NOT EXISTS "author_type" "InternalNoteAuthorType" NOT NULL DEFAULT 'USER';
ALTER TABLE "internal_notes" ADD COLUMN IF NOT EXISTS "agent_id" TEXT;
ALTER TABLE "internal_notes" ADD COLUMN IF NOT EXISTS "message_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_internal_note_conv_time" ON "internal_notes"("conversation_id", "created_at");

-- Tabela não era usada; por garantia, autor órfão vira NULL antes da FK.
UPDATE "internal_notes" SET "author_id" = NULL
 WHERE "author_id" IS NOT NULL AND "author_id" NOT IN (SELECT "id" FROM "users");

DO $$ BEGIN
  ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
