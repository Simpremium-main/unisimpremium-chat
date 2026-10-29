# Uni — Next.js fullstack na Vercel + Supabase

Um único projeto Next.js com o front, a API (NestJS) e o servidor MCP.

| Caminho | O que é |
|---|---|
| `src/app`, `src/features`, … | Front (App Router), igual ao projeto web original |
| `src/server` | API NestJS original (mesmos 194 endpoints), compilada com `tsc` para `.server-build/` |
| `src/pages/api/[[...slug]].ts` | Entrada da API: `/api/v1/*` e Swagger em `/docs` |
| `src/pages/api/internal/tick.ts` | Tick de 1 minuto (jobs atrasados, crons, outbox) |
| `src/pages/api/mcp` | MCP em `/mcp` (Streamable HTTP, stateless) |
| `src/mcp` | Tools do MCP; `npm run mcp:stdio` para uso local |
| `prisma/` | Schema e migrations (35: as 33 originais + sincronia do schema + fila/chave-valor) |
| `src/server/runtime` | Fila (`pg-queue.ts`), chave-valor (`kv-store.ts`) e execução dos workers, tudo em Postgres |
| `supabase/` | SQL de segurança e do cron |

## O que mudou em relação aos 3 projetos originais

- **Realtime**: Socket.io → Supabase Realtime (Broadcast). O servidor publica nos mesmos "rooms" (usuário, org, canal, conversa) como tópicos assinados por HMAC; o browser recebe os tópicos por `GET /api/v1/realtime/session` depois das mesmas checagens do antigo handshake. `src/lib/socket.ts` mantém a interface `on/off/emit`.
- **Sem Redis**: tudo roda no Postgres do Supabase.
  - **Filas**: `PgQueue` (tabelas `queue_jobs` / `queue_schedulers`) com a semântica do BullMQ que o app usa — delay, retentativas com backoff, `jobId`, retenção, deduplicação/debounce, crons e recuperação de jobs travados. Entra no `@nestjs/bullmq` via `BullModule.queueClass`, então `@InjectQueue`, `queue.add(...)` e os 17 `@Processor` não mudaram.
  - **Workers** rodam sob demanda: logo após cada request que enfileira job (`waitUntil`) e no tick de 1 minuto.
  - **Locks, idempotência, sessões do chatbot, memória curta da IA, presença e rate limit**: `KvStore` (tabela `kv_store`), com as mesmas chaves e TTLs.
- **Debounce do agente de IA**: saiu da memória do processo para a fila (job atrasado deduplicado + lock), porque em serverless cada mensagem pode cair numa instância diferente.
- **Uploads**: Supabase Storage (bucket público). Arquivos acima de 4 MB sobem direto do browser para o Storage (limite de 4,5 MB do corpo de request na Vercel).
- **Banco**: migration `20261021000000_sync_schema_drift` cria o que o `schema.prisma` exige e as migrations antigas não criavam (`channels.ai_enabled`, colunas de `ai_agents`, enum `AI_TOOL_FAILURE`, FK/índice). É idempotente.
- **MCP**: sem sessão em memória e sem o transporte SSE legado (não funcionam em serverless).
- **Cadastro só por convite**: `/register` sem convite é recusado (403). Novos usuários entram pelo link gerado em Configurações → Membros. `ALLOW_PUBLIC_SIGNUP=true` (+ `NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP=true`) reabre o cadastro livre.

## Deploy

### 1. GitHub
Crie um repositório **privado** e envie este projeto:
```bash
git remote add origin git@github.com:Simpremium-main/unisimpremium-chat.git
git push -u origin main
```

### 2. Vercel (plano **Pro** — o Hobby não permite uso comercial)
1. **Add New → Project** → importe o repositório. Framework: Next.js; build/install: padrão.
2. **Settings → Environment Variables → Import .env**: cole o conteúdo de `.prod/vercel.env`
   (ambiente Production). Se usar canal de e-mail, preencha antes
   `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`. As chaves de IA (ChatGPT /
   Claude) não vão aqui: são cadastradas no app, em **Configurações → IA**.
3. **Settings → Functions**: confirme *Fluid compute* ligado (padrão em projetos novos)
   e a região `iad1` (vem do `vercel.json`, igual à do Supabase).
4. **Deploy**.

### 3. Tick de 1 minuto
No SQL Editor do Supabase, rode `.prod/cron.sql` trocando `<APP_URL>` pela URL de
produção (ex.: `https://unisimpremium.vercel.app`). O `CRON_SECRET` já está preenchido.

### 4. Conferência
```bash
SMOKE_EMAIL=<e-mail do admin> SMOKE_PASSWORD='<senha de .prod/credenciais.txt>' \
CRON_SECRET='<de .prod/vercel.env>' node scripts/smoke.mjs https://<sua-url>
```
E no Supabase: `SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;`
deve mostrar `202` a cada minuto.

### 5. Notificações no celular (opcional)
Push quando uma conversa entra ou recebe mensagem em **Não respondidas**, **IA para
Humano** ou **IA Aguardando**, com o total no ícone do app.
1. Gere as chaves: `npx web-push generate-vapid-keys`.
2. Na Vercel, cadastre `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e
   `VAPID_SUBJECT=mailto:atendimento@simpremium.com.br` e faça um novo deploy. Sem as
   chaves o recurso fica desligado.
3. No iPhone (iOS 16.4+): abra o site no **Safari** → Compartilhar → **Adicionar à Tela
   de Início**; abra pelo ícone, entre e use o menu do usuário → **Ativar notificações**.
   No Android/computador, o mesmo item funciona direto no navegador.

### 6. Webhooks dos canais
Nos provedores (Meta/WhatsApp Cloud, Instagram, Zappfy, Kirvano) use
`https://<sua-url>/api/v1/webhooks/<TIPO>` — o diálogo "Novo canal" mostra a URL certa.

### Referência — como preparar um Supabase do zero
1. Projeto na mesma região das funções (`vercel.json`).
2. **Connect → ORM → Prisma**: `DATABASE_URL` (porta 6543, `?pgbouncer=true&connection_limit=5`)
   e `DIRECT_URL` (porta 5432); **Project Settings → API**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`.
3. `npx prisma migrate deploy` (se aparecer `P1001`, é rede: rode de novo) e `npm run prisma:seed`.
4. SQL Editor: `supabase/security.sql` (obrigatório; rode de novo após migrations que criem tabelas).
5. Storage: o bucket `chat-uploads` é criado sozinho. No plano Free o limite por arquivo é 50 MB.

## Desenvolvimento local

```bash
cp .env.example .env     # preencha banco e JWT (Supabase é opcional localmente)
npm install
npx prisma migrate deploy
npm run dev              # tsc --watch da API + next dev
```

Sem `SUPABASE_*`, uploads vão para `./uploads` e eventos realtime são descartados (o front cai nos refetches de segurança). O tick roda em processo a cada minuto.

| Comando | |
|---|---|
| `npm run typecheck` | Front + API |
| `npm test` | Testes da API (Jest) |
| `npm run build` | `prisma generate` + `tsc` da API + `next build --webpack` |
| `npm run mcp:stdio` | MCP local via stdio |

> O build de produção usa webpack com `serverMinification: false`: o Nest depende de nomes de classe (logs, Swagger, nomes de exceção nas respostas de erro).
