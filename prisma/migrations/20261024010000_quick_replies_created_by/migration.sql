-- Respostas rápidas: quem cadastrou.
ALTER TABLE "quick_replies" ADD COLUMN IF NOT EXISTS "created_by_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "quick_replies"
    ADD CONSTRAINT "quick_replies_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
