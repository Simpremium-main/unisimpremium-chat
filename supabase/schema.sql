-- UniSimpremium — schema próprio dentro do Supabase do Simpremium Chat.
--
-- Os dois apps dividem o mesmo banco, cada um no seu schema:
--   public         → Simpremium Chat (não muda nada)
--   unisimpremium  → este app
--
-- O app conecta com o papel `unisimpremium`, dono só do seu schema e com o
-- search_path fixo nele. Assim as consultas SQL sem schema do código (fila,
-- chave-valor, relatórios) caem nas tabelas certas, e esse papel não tem
-- permissão nas tabelas do public.
--
-- Rodar uma vez como `postgres` (SQL Editor), trocando <SENHA>, ANTES do
-- `prisma migrate deploy`. As URLs ficam:
--   DATABASE_URL=postgresql://unisimpremium.<ref>:<SENHA>@<pooler>:6543/postgres?pgbouncer=true&connection_limit=5&schema=unisimpremium
--   DIRECT_URL=postgresql://unisimpremium.<ref>:<SENHA>@<pooler>:5432/postgres?schema=unisimpremium

CREATE ROLE unisimpremium WITH LOGIN PASSWORD '<SENHA>' NOINHERIT;
-- O postgres precisa ser membro para passar a posse do schema (Postgres 16).
GRANT unisimpremium TO postgres;
CREATE SCHEMA unisimpremium AUTHORIZATION unisimpremium;
ALTER ROLE unisimpremium SET search_path = unisimpremium, extensions;

-- Sem acesso às tabelas do Simpremium Chat.
REVOKE ALL ON SCHEMA public FROM unisimpremium;
