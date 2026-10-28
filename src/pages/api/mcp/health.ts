import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.json({ status: 'ok', server: 'unisimpremium-mcp', version: '0.0.1' });
}
