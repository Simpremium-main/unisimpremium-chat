import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../database/prisma.service';

/**
 * Nome do provedor (Jarvis → Tools) com o endereço do servidor de pedidos e
 * cotação da Simpremium (Pedido Central). Base URL = endpoint completo, ex.:
 * https://pedido-central.vercel.app/api/mcp. Headers do provedor vão junto.
 */
export const SIMPREMIUM_PROVIDER_NAME = 'Pedido Central (Uni)';
/** Nome antigo do provedor — cadastros feitos antes da troca continuam valendo. */
const LEGACY_PROVIDER_NAME = 'Pedido Central (Simpremium)';

const TIMEOUT_MS = 30_000;

/** Chama `POST {tool, parameters}` no Pedido Central, como o Simp-Atendimento. */
@Injectable()
export class SimpremiumMcpClient {
  private readonly logger = new Logger(SimpremiumMcpClient.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async call<T = unknown>(
    organizationId: string,
    tool: string,
    parameters: Record<string, unknown>,
    timeoutMs = TIMEOUT_MS,
  ): Promise<T> {
    const { url, headers } = await this.endpoint(organizationId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ tool, parameters }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.error(`Pedido Central ${tool} → ${res.status}: ${text.slice(0, 300)}`);
        throw new Error(`Pedido Central ${tool} falhou (${res.status})`);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        return { result: text } as T;
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new Error(`Pedido Central ${tool}: timeout de ${timeoutMs / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** O provedor do Pedido Central está cadastrado (ou há SIMPREMIUM_MCP_URL)? */
  async isConfigured(organizationId: string): Promise<boolean> {
    return this.endpoint(organizationId).then(
      () => true,
      () => false,
    );
  }

  private async endpoint(organizationId: string): Promise<{ url: string; headers: Record<string, string> }> {
    const provider = await this.prisma.aiTool.findFirst({
      where: {
        organizationId,
        name: { in: [SIMPREMIUM_PROVIDER_NAME, LEGACY_PROVIDER_NAME] },
        isActive: true,
        deletedAt: null,
      },
      select: { httpBaseUrl: true, httpHeaders: true },
    });
    const url = provider?.httpBaseUrl?.trim() || this.config.get<string>('SIMPREMIUM_MCP_URL')?.trim();
    if (!url) {
      throw new Error(
        `Servidor de pedidos não configurado: cadastre o provedor "${SIMPREMIUM_PROVIDER_NAME}" em Jarvis → Tools`,
      );
    }
    const headers: Record<string, string> = {};
    if (provider?.httpHeaders && typeof provider.httpHeaders === 'object') {
      for (const [k, v] of Object.entries(provider.httpHeaders as Record<string, unknown>)) {
        // Mesmo `{{env.X}}` dos provedores HTTP: o segredo fica na env, não no banco.
        if (typeof v === 'string') {
          headers[k] = v.replace(/\{\{\s*env\.(\w+)\s*\}\}/g, (_m, name) => this.config.get<string>(name) ?? '');
        }
      }
    }
    return { url, headers };
  }
}
