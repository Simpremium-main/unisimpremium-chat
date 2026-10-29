import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KvStore } from '../../../../runtime/kv-store';

/**
 * API de linhas da Uni Mobile (eSIM/CHIP). Documentação:
 * https://webservice.intranettelecom.com/dev/docs/api_doc.html
 *
 * Respostas no formato `{ Result: 'Ok' | 'Error', Message, Data }`. Cada
 * distribuidor tem o seu token e só enxerga os próprios pedidos.
 *
 * Variáveis de ambiente:
 *  - UNIMOBILE_API_URL      (padrão https://ia.unimobilebr.com/v1)
 *  - UNIMOBILE_API_TOKEN    token do distribuidor Uni Mobile
 *  - UNIMOBILE_RESELLER_ID  reseller_id desse token (ações que o exigem)
 *  - UNIMOBILE_TOKEN_<PARCEIRO> / UNIMOBILE_RESELLER_ID_<PARCEIRO>: token
 *    próprio de um parceiro (nome do parceiro do grupo em maiúsculas, sem
 *    acento, com "_" no lugar de espaços). Sem eles, vale o token padrão.
 */
export const UNIMOBILE_DEFAULT_URL = 'https://ia.unimobilebr.com/v1';

export interface UnimobileResponse<T = unknown> {
  Result: 'Ok' | 'Error' | string;
  Message?: string;
  Data?: T;
  [key: string]: unknown;
}

/** Endpoint que o endereço configurado não oferece (404 / "Action not found"). */
export class UnimobileUnavailableError extends Error {}

export interface UnimobileCredentials {
  token: string;
  resellerId: number | null;
  /** Parceiro cujo token foi usado (null = token padrão). */
  partner: string | null;
}

const TIMEOUT_MS = 20_000;

export const partnerEnvKey = (partner: string) =>
  partner
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

@Injectable()
export class UnimobileClient {
  private readonly logger = new Logger(UnimobileClient.name);
  private readonly kv = new KvStore();

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('UNIMOBILE_API_TOKEN')?.trim();
  }

  /** Token do parceiro do grupo, se houver um próprio; senão o padrão. */
  credentials(partner?: string | null): UnimobileCredentials {
    const key = partner ? partnerEnvKey(partner) : '';
    const own = key ? this.config.get<string>(`UNIMOBILE_TOKEN_${key}`)?.trim() : '';
    const token = own || this.config.get<string>('UNIMOBILE_API_TOKEN')?.trim() || '';
    if (!token) throw new Error('API da Uni Mobile não configurada (UNIMOBILE_API_TOKEN).');
    const reseller = own
      ? this.config.get<string>(`UNIMOBILE_RESELLER_ID_${key}`)
      : this.config.get<string>('UNIMOBILE_RESELLER_ID');
    const resellerId = Number(reseller);
    return {
      token,
      resellerId: Number.isInteger(resellerId) && resellerId > 0 ? resellerId : null,
      partner: own ? partner! : null,
    };
  }

  async request<T = unknown>(
    creds: UnimobileCredentials,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<UnimobileResponse<T>> {
    const base = (this.config.get<string>('UNIMOBILE_API_URL')?.trim() || UNIMOBILE_DEFAULT_URL).replace(/\/$/, '');
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${creds.token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error(`API Uni Mobile sem resposta em ${TIMEOUT_MS / 1000}s (${path.split('?')[0]})`);
      }
      throw err;
    }
    const text = await res.text();
    let json: UnimobileResponse<T>;
    try {
      json = JSON.parse(text);
    } catch {
      if (res.status === 404) throw new UnimobileUnavailableError(`Endpoint ${path.split('?')[0]} não disponível na API`);
      throw new Error(`API Uni Mobile respondeu ${res.status} sem JSON`);
    }
    const message = String(json?.Message ?? '');
    if (/token is invalid or has expired/i.test(message)) {
      throw new Error('Token da API Uni Mobile inválido ou expirado.');
    }
    if (/action not found|method not permitted$/i.test(message)) {
      throw new UnimobileUnavailableError(`Endpoint ${path.split('?')[0]} não disponível na API`);
    }
    return json;
  }

  /** GET com cache curto (catálogo, listas). */
  async cachedGet<T = unknown>(creds: UnimobileCredentials, path: string, ttlMs: number): Promise<UnimobileResponse<T>> {
    const key = `unimobile:${creds.partner ?? '_'}:${path}`;
    const hit = await this.kv.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as UnimobileResponse<T>;
    const res = await this.request<T>(creds, 'GET', path);
    if (res.Result === 'Ok') {
      await this.kv.set(key, JSON.stringify(res), { ttlMs }).catch(() => undefined);
    }
    return res;
  }

  /** Apaga o cache de listas depois de uma ação que muda pedidos. */
  async invalidateOrders(creds: UnimobileCredentials): Promise<void> {
    await this.kv.del(`unimobile:${creds.partner ?? '_'}:/orders/ordersList`).catch(() => undefined);
  }
}
