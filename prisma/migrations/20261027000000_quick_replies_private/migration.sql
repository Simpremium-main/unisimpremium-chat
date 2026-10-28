-- Respostas rápidas pessoais: só quem cadastrou vê (false = toda a equipe).
-- Idempotente (as migrations aqui são aplicadas à mão).
ALTER TABLE "quick_replies" ADD COLUMN IF NOT EXISTS "is_private" BOOLEAN NOT NULL DEFAULT false;
