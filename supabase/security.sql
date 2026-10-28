-- UniSimpremium — bloqueio da Data API (PostgREST) do Supabase.
--
-- O navegador recebe a chave pública (anon) para assinar o Supabase
-- Realtime. O schema unisimpremium não é exposto pela Data API (só o public
-- é, por padrão); este script garante que, mesmo se for, a chave pública
-- não lê nada.
--
-- A aplicação conecta como `unisimpremium` (dono das tabelas), que não é
-- afetado por estes REVOKEs nem pelo RLS.
--
-- Rodar como `postgres` DEPOIS do `prisma migrate deploy` (e de novo após
-- migrations que criem tabelas, por garantia).

-- 1. Sem privilégios para os papéis da Data API.
REVOKE ALL ON SCHEMA unisimpremium FROM anon, authenticated;
REVOKE ALL ON ALL TABLES    IN SCHEMA unisimpremium FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA unisimpremium FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA unisimpremium FROM anon, authenticated;

-- 2. Defesa em profundidade: RLS ligado sem nenhuma policy (nega tudo para
--    quem não é dono da tabela).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'unisimpremium' LOOP
    EXECUTE format('ALTER TABLE unisimpremium.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
