import type { NextApiRequest, NextApiResponse } from 'next';
import { waitUntil } from '@vercel/functions';

/**
 * Tick de 1 minuto: jobs atrasados/agendados do BullMQ, outbox e janitor.
 * Chamado por um cron (Supabase pg_cron + pg_net, ou Vercel Cron) com
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * Responde 202 na hora e segue trabalhando em `waitUntil` — o pg_net
 * encerra a chamada HTTP em poucos segundos. `?wait=1` espera e devolve o
 * relatório (diagnóstico).
 */
export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runTick } = await require('../../../../.server-build/http');
  if (req.query.wait === '1') {
    res.status(200).json(await runTick());
    return;
  }
  res.status(202).json({ accepted: true });
  waitUntil(
    runTick().catch((err: Error) => console.error('[tick] failed:', err)),
  );
}
