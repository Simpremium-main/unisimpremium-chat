import { Injectable, Logger } from '@nestjs/common';
import { SimpremiumMcpClient } from './simpremium-mcp.client';
import { PrismaService } from '../../../../database/prisma.service';
import { KvStore } from '../../../../runtime/kv-store';
import {
  CustomerSummary,
  OrderSummary,
  embeddedOrders,
  parseCustomers,
  parseOrders,
  phoneVariants,
  samePhone,
} from './customer-orders.parse';

export interface CustomerOrdersResult {
  /**
   * found: cliente achado (pedidos podem ser 0) · not-found: nenhum cadastro
   * com este telefone · no-phone: contato sem número · not-configured:
   * Pedido Central não cadastrado em Jarvis → Tools · error: falha na consulta.
   */
  status: 'found' | 'not-found' | 'no-phone' | 'not-configured' | 'error';
  phone: string | null;
  /** Formatos de telefone tentados (o que achou é o último). */
  tried: string[];
  customer: CustomerSummary | null;
  orders: OrderSummary[];
  message?: string;
  fetchedAt: string;
}

const CACHE_TTL_MS = 5 * 60_000;
const CALL_TIMEOUT_MS = 12_000;

/**
 * "Este número tem pedido?" — procura o cliente pelo telefone no Pedido
 * Central (tentando os formatos comuns) e busca os pedidos pelo e-mail/CPF
 * dele. Usado no painel "Pedidos" do inbox e na ferramenta da IA.
 */
@Injectable()
export class CustomerOrdersService {
  private readonly logger = new Logger(CustomerOrdersService.name);
  private readonly kv = new KvStore();

  constructor(
    private readonly mcp: SimpremiumMcpClient,
    private readonly prisma: PrismaService,
  ) {}

  /** Pedidos do contato desta conversa (telefone do contato ou do WhatsApp). */
  async lookupForConversation(organizationId: string, conversationId: string, opts: { refresh?: boolean } = {}) {
    return this.lookupByPhone(organizationId, await this.conversationPhone(conversationId), opts);
  }

  /** Telefone do contato da conversa (ou o número do WhatsApp). */
  async conversationPhone(conversationId: string): Promise<string | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        isGroup: true,
        channelId: true,
        channel: { select: { type: true } },
        contact: { select: { phone: true, channels: { select: { channelId: true, externalId: true } } } },
      },
    });
    if (!conv || conv.isGroup) return null;
    if (conv.contact.phone) return conv.contact.phone;
    // WhatsApp: o id do contato no canal é o próprio número ("5511…@s.whatsapp.net").
    if (!conv.channel.type.startsWith('WHATSAPP')) return null;
    const ext = conv.contact.channels.find((c) => c.channelId === conv.channelId)?.externalId ?? '';
    return ext.split('@')[0] || null;
  }

  async lookupByPhone(
    organizationId: string,
    phone: string | null,
    opts: { refresh?: boolean } = {},
  ): Promise<CustomerOrdersResult> {
    const base = { phone, tried: [] as string[], customer: null, orders: [], fetchedAt: new Date().toISOString() };
    const variants = phone ? phoneVariants(phone) : [];
    if (!variants.length) return { ...base, status: 'no-phone' };

    const cacheKey = `orders:${organizationId}:${variants[0]}`;
    if (!opts.refresh) {
      const cached = await this.kv.get(cacheKey).catch(() => null);
      if (cached) return JSON.parse(cached) as CustomerOrdersResult;
    }
    if (!(await this.mcp.isConfigured(organizationId))) {
      return {
        ...base,
        status: 'not-configured',
        message: 'Cadastre o provedor "Pedido Central (Simpremium)" em Jarvis → Tools',
      };
    }

    let result: CustomerOrdersResult;
    try {
      result = await this.lookup(organizationId, phone!, variants);
    } catch (err: any) {
      this.logger.warn(`orders lookup failed for ${variants[0]}: ${err?.message ?? err}`);
      return { ...base, tried: variants, status: 'error', message: err?.message ?? 'Erro ao consultar o Pedido Central' };
    }
    await this.kv.set(cacheKey, JSON.stringify(result), { ttlMs: CACHE_TTL_MS }).catch(() => undefined);
    return result;
  }

  private async lookup(organizationId: string, phone: string, variants: string[]): Promise<CustomerOrdersResult> {
    const tried: string[] = [];
    const fetchedAt = new Date().toISOString();
    for (const variant of variants) {
      tried.push(variant);
      const raw = await this.mcp.call(organizationId, 'consultar_cliente', { phone: variant }, CALL_TIMEOUT_MS);
      const all = parseCustomers(raw);
      // Só aceita quem tem o mesmo número; sem telefone na resposta, só se
      // veio um cliente (lista com vários = a busca não filtrou de verdade).
      const matching = all.filter((c) => c.phone && samePhone(c.phone, phone));
      const customer = matching[0] ?? (all.length === 1 && !all[0].phone ? all[0] : null);
      if (!customer) continue;

      const embedded = embeddedOrders(raw);
      const orders = embedded.length ? parseOrders(embedded) : await this.ordersOf(organizationId, customer);
      return { status: 'found', phone, tried, customer, orders, fetchedAt };
    }
    return { status: 'not-found', phone, tried, customer: null, orders: [], fetchedAt };
  }

  private async ordersOf(organizationId: string, customer: CustomerSummary): Promise<OrderSummary[]> {
    const params = customer.email ? { email: customer.email } : customer.cpf ? { cpf: customer.cpf } : null;
    if (!params) return [];
    const raw = await this.mcp.call(organizationId, 'consultar_pedido', params, CALL_TIMEOUT_MS);
    return parseOrders(raw);
  }
}
