import type { NextApiRequest, NextApiResponse } from 'next';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, extractApiKey, validateApiKey } from '../../../mcp/server';

/**
 * MCP (Streamable HTTP) — servido em /mcp (rewrite) e /api/mcp.
 *
 * Stateless: cada POST cria servidor + transporte e responde em JSON. Em
 * serverless não dá para manter sessões em memória entre requests (cada
 * uma pode cair numa instância diferente), por isso não há
 * `mcp-session-id` nem o transporte SSE legado. Auth igual ao servidor
 * MCP original: `Authorization: Bearer pk_...` validado na API pública.
 */
export const config = { maxDuration: 60 };

function requestBaseUrl(req: NextApiRequest): string {
  const configured = process.env.UNISIMPREMIUM_BASE_URL || process.env.CHAT_BULLQ_BASE_URL;
  if (configured) return configured;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  return `${proto}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed (stateless server: use POST)' },
      id: null,
    });
    return;
  }

  const apiKey = extractApiKey(req.headers.authorization);
  if (!apiKey) {
    res.status(401).json({
      error: 'Missing or invalid token. Use: Authorization: Bearer pk_YOUR_UNISIMPREMIUM_API_KEY',
    });
    return;
  }
  const baseUrl = requestBaseUrl(req);
  if (!(await validateApiKey(apiKey, baseUrl))) {
    res.status(403).json({ error: 'Invalid or revoked API key.' });
    return;
  }

  const server = createServer(apiKey, baseUrl);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
