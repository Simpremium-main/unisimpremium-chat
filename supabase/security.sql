-- UniSimpremium — bloqueio da Data API (PostgREST) do Supabase.
--
-- O navegador recebe a chave pública (anon) para assinar o Supabase
-- Realtime. Sem este bloqueio, essa mesma chave leria QUALQUER tabela do
-- schema public em https://<projeto>.supabase.co/rest/v1/<tabela>.
--
-- A aplicação acessa o banco só pelo Prisma, conectado como `postgres`
-- (dono das tabelas), que não é afetado por estes REVOKEs nem pelo RLS.
-- Não altera estrutura: `prisma migrate diff` continua sem diferenças.
--
-- Rodar uma vez no SQL Editor do Supabase DEPOIS do `prisma migrate deploy`
-- (e de novo após migrations que criem tabelas, por garantia — os default
-- privileges abaixo já cobrem tabelas novas criadas pelo postgres).

-- 1. Sem privilégios para os papéis da Data API.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 2. Idem para objetos criados no futuro (migrations rodam como postgres).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 3. Defesa em profundidade: RLS ligado sem nenhuma policy (nega tudo para
--    quem não é dono da tabela).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
