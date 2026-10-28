import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config';
import { createServer } from './server';

// Modo local (Claude Code via stdio): `npm run mcp:stdio`
// com UNISIMPREMIUM_API_KEY e UNISIMPREMIUM_BASE_URL no ambiente (os nomes antigos CHAT_BULLQ_* ainda valem).
async function runStdio(): Promise<void> {
  const apiKey = config.apiKey;
  if (!apiKey) {
    console.error('UNISIMPREMIUM_API_KEY env var required for stdio mode');
    process.exit(1);
  }
  const server = createServer(apiKey, config.baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('UniSimpremium MCP Server running on stdio');
}

runStdio().catch(console.error);
