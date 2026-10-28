-- UniSimpremium — tick de 1 minuto via Supabase (pg_cron + pg_net).
--
-- O tick (/api/internal/tick) processa jobs atrasados e agendados do BullMQ
-- (SLA, watchdog, recuperação de vendas, polling do Gmail, retries), o
-- outbox de automações e o janitor de runs de IA. Na Vercel não há processo
-- vivo, então algo precisa chamá-lo a cada minuto. O pg_cron funciona em
-- qualquer plano da Vercel (o Vercel Cron só roda de minuto em minuto no Pro).
--
-- Antes de rodar no SQL Editor, troque:
--   <APP_URL>      → URL pública do app, ex.: https://unisimpremium.vercel.app
--   <CRON_SECRET>  → o mesmo valor da variável CRON_SECRET na Vercel

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Reagendar é idempotente: remove o job anterior com o mesmo nome.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'unisimpremium-tick';

SELECT cron.schedule(
  'unisimpremium-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := '<APP_URL>/api/internal/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Conferir as últimas execuções (a rota responde 202 e continua o trabalho
-- em segundo plano):
--   SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;
--   SELECT status, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
