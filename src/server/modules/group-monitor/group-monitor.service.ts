import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { parseOrders } from '../ai-agents/tools/simpremium/customer-orders.parse';

/** Ferramentas da IA que consultam pedido (ver SimpremiumToolsService). */
export const ORDER_TOOLS = [
  'consultar_pedido',
  'pedidos_do_cliente',
  'status_entrega',
  'consultar_ativacoes',
  'consultar_seguro',
];

export interface OrderQueryFilters {
  conversationId?: string;
  orderId?: string;
  /** Só grupos (padrão) ou todas as conversas. */
  groupsOnly?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Acompanhamento dos grupos de WhatsApp: em quais grupos o número está e
 * quais pedidos foram consultados pela IA (a partir das chamadas de
 * ferramenta gravadas em ai_tool_calls — não precisa de tabela nova).
 */
@Injectable()
export class GroupMonitorService {
  constructor(private readonly prisma: PrismaService) {}

  async groups(organizationId: string, access: ChannelAccess) {
    const convs = await this.prisma.conversation.findMany({
      where: {
        organizationId,
        isGroup: true,
        deletedAt: null,
        ...this.channelFilter(access),
      },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      select: {
        id: true,
        status: true,
        aiEnabled: true,
        lastMessageAt: true,
        createdAt: true,
        contact: { select: { name: true, avatarUrl: true } },
        channel: { select: { id: true, name: true, aiEnabled: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, senderName: true, direction: true, createdAt: true },
        },
      },
    });

    const ids = convs.map((c) => c.id);
    const counts = ids.length
      ? await this.prisma.$queryRaw<Array<{ conversation_id: string; queries: number; last_query_at: Date }>>`
          SELECT r.conversation_id, COUNT(*)::int AS queries, MAX(tc.created_at) AS last_query_at
          FROM ai_tool_calls tc
          JOIN ai_agent_runs r ON r.id = tc.run_id
          WHERE r.organization_id = ${organizationId}
            AND r.conversation_id IN (${Prisma.join(ids)})
            AND tc.tool_name IN (${Prisma.join(ORDER_TOOLS)})
          GROUP BY r.conversation_id`
      : [];
    const byConv = new Map(counts.map((c) => [c.conversation_id, c]));

    return convs.map((c) => {
      const last = c.messages[0];
      return {
        id: c.id,
        name: c.contact?.name ?? 'Grupo sem nome',
        avatarUrl: c.contact?.avatarUrl ?? null,
        status: c.status,
        channel: { id: c.channel.id, name: c.channel.name },
        // Mesma cascata do AgentRouter: conversa > canal (o global fica na org).
        aiEnabled: c.aiEnabled ?? c.channel.aiEnabled ?? null,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
        lastMessage: last
          ? {
              text: messageText(last.content),
              senderName: last.senderName,
              direction: last.direction,
              createdAt: last.createdAt,
            }
          : null,
        orderQueries: byConv.get(c.id)?.queries ?? 0,
        lastOrderQueryAt: byConv.get(c.id)?.last_query_at ?? null,
      };
    });
  }

  async orderQueries(organizationId: string, access: ChannelAccess, filters: OrderQueryFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);
    const orderId = filters.orderId?.replace(/\D/g, '');

    const where: Prisma.AiToolCallWhereInput = {
      toolName: { in: ORDER_TOOLS },
      run: {
        organizationId,
        conversation: {
          ...(filters.groupsOnly !== false ? { isGroup: true } : {}),
          ...this.channelFilter(access),
        },
        ...(filters.conversationId ? { conversationId: filters.conversationId } : {}),
      },
      ...(orderId ? { input: { path: ['orderId'], string_contains: orderId } } : {}),
    };

    const [total, calls] = await Promise.all([
      this.prisma.aiToolCall.count({ where }),
      this.prisma.aiToolCall.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          toolName: true,
          input: true,
          output: true,
          error: true,
          createdAt: true,
          run: {
            select: {
              id: true,
              triggerMessageId: true,
              conversation: {
                select: { id: true, isGroup: true, contact: { select: { name: true } }, channel: { select: { name: true } } },
              },
            },
          },
        },
      }),
    ]);

    const runIds = [...new Set(calls.map((c) => c.run.id))];
    const triggerIds = [...new Set(calls.map((c) => c.run.triggerMessageId).filter((v): v is string => !!v))];
    const [triggers, replies] = await Promise.all([
      triggerIds.length
        ? this.prisma.message.findMany({
            where: { id: { in: triggerIds } },
            select: { id: true, content: true, senderName: true, createdAt: true },
          })
        : [],
      runIds.length
        ? this.prisma.$queryRaw<Array<{ run_id: string; content: unknown; created_at: Date }>>`
            SELECT DISTINCT ON (m.metadata->>'runId') m.metadata->>'runId' AS run_id, m.content, m.created_at
            FROM messages m
            WHERE m.conversation_id IN (${Prisma.join([...new Set(calls.map((c) => c.run.conversation.id))])})
              AND m.direction = 'OUTBOUND'
              AND m.metadata->>'runId' IN (${Prisma.join(runIds)})
            ORDER BY m.metadata->>'runId', m.created_at ASC`
        : [],
    ]);
    const triggerById = new Map(triggers.map((t) => [t.id, t]));
    const replyByRun = new Map(replies.map((r) => [r.run_id, r]));

    const items = calls.map((c) => {
      const trigger = c.run.triggerMessageId ? triggerById.get(c.run.triggerMessageId) : undefined;
      const reply = replyByRun.get(c.run.id);
      const result = summarizeOutput(c.output, c.error);
      const input = (c.input ?? {}) as Record<string, unknown>;
      return {
        id: c.id,
        tool: c.toolName,
        orderId: typeof input.orderId === 'string' || typeof input.orderId === 'number'
          ? String(input.orderId).replace(/^#/, '')
          : result.orders[0]?.id ?? null,
        createdAt: c.createdAt,
        outcome: result.outcome,
        orders: result.orders,
        conversation: {
          id: c.run.conversation.id,
          isGroup: c.run.conversation.isGroup,
          name: c.run.conversation.contact?.name ?? null,
          channel: c.run.conversation.channel?.name ?? null,
        },
        askedBy: trigger?.senderName ?? null,
        question: trigger ? messageText(trigger.content) : null,
        reply: reply ? messageText(reply.content) : null,
        repliedAt: reply?.created_at ?? null,
      };
    });

    return { items, total, page, limit };
  }

  private channelFilter(access: ChannelAccess): Prisma.ConversationWhereInput {
    return access === 'ALL' ? {} : { channelId: { in: [...access] } };
  }
}

export type QueryOutcome = 'found' | 'not-found' | 'unverified' | 'error' | 'unknown';

/**
 * O que a consulta devolveu, pela saída gravada da ferramenta: texto
 * formatado ("{json}\n\n[REGRAS…]"), objeto ou `{resultado, _auditoria}`.
 */
export function summarizeOutput(
  output: unknown,
  error: string | null,
): { outcome: QueryOutcome; orders: Array<{ id: string; status: string | null }> } {
  if (error) return { outcome: 'error', orders: [] };
  let value: unknown = output;
  if (value && typeof value === 'object' && 'resultado' in (value as object)) {
    value = (value as { resultado: unknown }).resultado;
  }
  if (typeof value === 'string') {
    const json = value.split('\n\n[')[0].trim();
    try {
      value = JSON.parse(json);
    } catch {
      return { outcome: 'unknown', orders: [] };
    }
  }
  if (!value || typeof value !== 'object') return { outcome: 'unknown', orders: [] };
  const obj = value as Record<string, unknown>;
  if (obj.pedido_nao_encontrado || obj.nao_encontrado) return { outcome: 'not-found', orders: [] };
  if (obj.identidade_nao_confirmada) return { outcome: 'unverified', orders: [] };
  const list = Array.isArray(obj.pedidos) ? obj.pedidos : value;
  const orders = parseOrders(list).map((o) => ({ id: o.id, status: o.status }));
  return { outcome: orders.length ? 'found' : 'unknown', orders };
}

function messageText(content: unknown): string | null {
  const c = (content ?? {}) as { text?: unknown; caption?: unknown; fallbackText?: unknown };
  const t = [c.text, c.caption, c.fallbackText].find((v) => typeof v === 'string') as string | undefined;
  return t ? t.slice(0, 500) : null;
}
