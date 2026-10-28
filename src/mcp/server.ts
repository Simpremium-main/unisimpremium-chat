import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SimpremiumChatClient } from './api-client';
import { registerMeTools } from './tools/me';
import { registerDashboardTools } from './tools/dashboard';

export function createServer(apiKey: string, baseUrl: string): McpServer {
  const server = new McpServer({ name: 'unisimpremium', version: '0.0.1' });
  const api = new SimpremiumChatClient(apiKey, baseUrl);
  registerMeTools(server, api);
  registerDashboardTools(server, api);
  return server;
}

export function extractApiKey(authorization: string | undefined): string | null {
  const header = authorization?.trim();
  if (!header) return null;
  const token = (header.startsWith('Bearer ') ? header.slice(7) : header).trim();
  if (!token || !token.startsWith('pk_')) return null;
  return token;
}

export async function validateApiKey(apiKey: string, baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/public/me`, {
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}
