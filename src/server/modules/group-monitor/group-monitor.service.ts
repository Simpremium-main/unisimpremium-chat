import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { parseOrders } from '../ai-agents/tools/simpremium/customer-orders.parse';

/** Ferramentas da IA que consultam ou mexem em pedido/linha (Pedido Central e Uni Mobile). */
export const ORDER_TOOLS = [
  'uni_consultar_linha',
  'uni_consumo_linha',
  'uni_historico_linha',
  'uni_pacotes_recarga',
  'uni_reenviar_email',
  'uni_ativar_linha',
  'uni_recarregar',
  'uni_estender_plano',
  'uni_alterar_pedido',
  'uni_cancelar_pedido',
  'uni_reiniciar_linha',
  'uni_criar_pedido',
  'consultar_pedido',
  'pedidos_do_cliente',
  'status_entrega',
  'consultar_ativacoes',
  'consultar_seguro',
];

export type RequestStatus = 'answered-ai' | 'answered-human' | 'pending';

export interface RequestFilters {
  conversationId?: string;
  /** Texto da solicitação ou nome de quem pediu. */
  q?: string;
  partner?: string;
  status?: RequestStatus;
  page?: number;
  limit?: number;
}

/**
 * Acompanhamento dos grupos de WhatsApp: em quais grupos o número está e
 * todas as solicitações feitas à IA neles — mensagens marcadas com
 * `metadata.groupRequest` pelo InboundMessageProcessor (ver group-trigger.ts),
 * com a resposta que veio depois e os pedidos consultados nessa resposta.
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
        metadata: true,
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
      ? await this.prisma.$queryRaw<Array<{ conversation_id: string; requests: number; last_request_at: Date }>>`
          SELECT m.conversation_id, COUNT(*)::int AS requests, MAX(m.created_at) AS last_request_at
          FROM messages m
          WHERE m.conversation_id IN (${Prisma.join(ids)})
            AND m.direction = 'INBOUND'
            AND m.metadata->>'groupRequest' = 'true'
          GROUP BY m.conversation_id`
      : [];
    const byConv = new Map(counts.map((c) => [c.conversation_id, c]));

    const groups = convs.map((c) => {
      const last = c.messages[0];
      const meta = (c.metadata ?? {}) as Record<string, unknown>;
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
        requests: byConv.get(c.id)?.requests ?? 0,
        lastRequestAt: byConv.get(c.id)?.last_request_at ?? null,
        partner: typeof meta.groupPartner === 'string' ? meta.groupPartner : null,
        participants: typeof meta.groupParticipants === 'number' ? meta.groupParticipants : null,
        left: meta.groupLeft === true,
        syncedAt: typeof meta.groupSyncedAt === 'string' ? meta.groupSyncedAt : null,
      };
    });
    // Grupos de onde o número saiu vão para o fim.
    return groups.sort((a, b) => Number(a.left) - Number(b.left));
  }

  /** Parceiro (operação) do grupo — define de quem são os pedidos consultados nele. */
  async setPartner(organizationId: string, access: ChannelAccess, conversationId: string, partner: string | null) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId, isGroup: true, deletedAt: null, ...this.channelFilter(access) },
      select: { id: true, metadata: true },
    });
    if (!conv) throw new NotFoundException('Grupo não encontrado');
    const value = partner?.trim().slice(0, 80) || null;
    const meta = { ...((conv.metadata ?? {}) as Record<string, unknown>), groupPartner: value };
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { metadata: meta as Prisma.InputJsonValue },
    });
    return { id: conv.id, partner: value };
  }

  async requests(organizationId: string, access: ChannelAccess, filters: RequestFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);
    const q = filters.q?.trim();

    const conds: Prisma.Sql[] = [
      Prisma.sql`c.organization_id = ${organizationId}`,
      Prisma.sql`c.is_group = true`,
      Prisma.sql`c.deleted_at IS NULL`,
      Prisma.sql`m.direction = 'INBOUND'`,
      Prisma.sql`m.metadata->>'groupRequest' = 'true'`,
    ];
    if (access !== 'ALL') {
      conds.push(access.size ? Prisma.sql`c.channel_id IN (${Prisma.join([...access])})` : Prisma.sql`false`);
    }
    if (filters.conversationId) conds.push(Prisma.sql`c.id = ${filters.conversationId}`);
    if (filters.partner) conds.push(Prisma.sql`c.metadata->>'groupPartner' = ${filters.partner}`);
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      conds.push(Prisma.sql`(m.content->>'text' ILIKE ${like} OR m.content->>'caption' ILIKE ${like} OR m.sender_name ILIKE ${like})`);
    }
    if (filters.status === 'pending') conds.push(Prisma.sql`r.id IS NULL`);
    if (filters.status === 'answered-ai') conds.push(Prisma.sql`r.id IS NOT NULL AND r.metadata->>'runId' IS NOT NULL`);
    if (filters.status === 'answered-human') conds.push(Prisma.sql`r.id IS NOT NULL AND r.metadata->>'runId' IS NULL`);
    const where = Prisma.join(conds, ' AND ');

    // Resposta = primeira mensagem nossa no grupo depois da solicitação.
    const from = Prisma.sql`
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN LATERAL (
        SELECT o.id, o.content, o.created_at, o.metadata, o.sender_name
        FROM messages o
        WHERE o.conversation_id = m.conversation_id
          AND o.direction = 'OUTBOUND'
          AND o.created_at > m.created_at
        ORDER BY o.created_at ASC
        LIMIT 1
      ) r ON true`;

    const [countRows, rows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: number }>>`SELECT COUNT(*)::int AS total ${from} WHERE ${where}`,
      this.prisma.$queryRaw<
        Array<{
          id: string;
          conversation_id: string;
          group_name: string | null;
          partner: string | null;
          content: unknown;
          metadata: unknown;
          sender_name: string | null;
          created_at: Date;
          reply_content: unknown;
          reply_at: Date | null;
          reply_sender: string | null;
          run_id: string | null;
        }>
      >`
        SELECT m.id, m.conversation_id, ct.name AS group_name, c.metadata->>'groupPartner' AS partner,
               m.content, m.metadata, m.sender_name, m.created_at,
               r.content AS reply_content, r.created_at AS reply_at, r.sender_name AS reply_sender,
               r.metadata->>'runId' AS run_id
        ${from}
        WHERE ${where}
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    ]);

    // Pedidos consultados pela IA na execução que respondeu.
    const runIds = [...new Set(rows.map((r) => r.run_id).filter((v): v is string => !!v))];
    const calls = runIds.length
      ? await this.prisma.aiToolCall.findMany({
          where: { runId: { in: runIds }, toolName: { in: ORDER_TOOLS } },
          orderBy: { createdAt: 'asc' },
          select: { runId: true, toolName: true, input: true, output: true, error: true },
        })
      : [];
    const lookupsByRun = new Map<string, Array<ReturnType<typeof toLookup>>>();
    for (const c of calls) {
      const list = lookupsByRun.get(c.runId) ?? [];
      list.push(toLookup(c));
      lookupsByRun.set(c.runId, list);
    }

    const items = rows.map((r) => {
      const meta = (r.metadata ?? {}) as { transcription?: { text?: unknown } };
      const transcript = typeof meta.transcription?.text === 'string' ? meta.transcription.text : null;
      const status: RequestStatus = !r.reply_at ? 'pending' : r.run_id ? 'answered-ai' : 'answered-human';
      return {
        id: r.id,
        createdAt: r.created_at,
        askedBy: r.sender_name,
        text: messageText(r.content) ?? (transcript ? `🎙 ${transcript.slice(0, 500)}` : null),
        group: { id: r.conversation_id, name: r.group_name, partner: r.partner },
        status,
        reply: r.reply_at
          ? { text: messageText(r.reply_content), at: r.reply_at, by: r.run_id ? 'IA' : r.reply_sender }
          : null,
        lookups: r.run_id ? lookupsByRun.get(r.run_id) ?? [] : [],
      };
    });

    return { items, total: countRows[0]?.total ?? 0, page, limit };
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
  if (obj.pedido_nao_encontrado || obj.nao_encontrado || obj.encontrado === false) return { outcome: 'not-found', orders: [] };
  // Uni Mobile: { encontrado, linhas: [{ iccid, status }] }.
  if (Array.isArray(obj.linhas)) {
    const orders = (obj.linhas as Array<Record<string, unknown>>)
      .filter((l) => typeof l.iccid === 'string')
      .map((l) => ({ id: String(l.iccid), status: typeof l.status === 'string' ? l.status : null }));
    return { outcome: orders.length ? 'found' : 'unknown', orders };
  }
  if (obj.identidade_nao_confirmada) return { outcome: 'unverified', orders: [] };
  const list = Array.isArray(obj.pedidos) ? obj.pedidos : value;
  const orders = parseOrders(list).map((o) => ({ id: o.id, status: o.status }));
  return { outcome: orders.length ? 'found' : 'unknown', orders };
}

/** Uma consulta de pedido feita pela IA (ferramenta + resultado). */
function toLookup(c: { toolName: string; input: unknown; output: unknown; error: string | null }) {
  const result = summarizeOutput(c.output, c.error);
  const input = (c.input ?? {}) as Record<string, unknown>;
  const ref = input.orderId ?? input.iccid;
  const asked = typeof ref === 'string' || typeof ref === 'number' ? String(ref).replace(/^#/, '').replace(/\s/g, '') : null;
  return {
    tool: c.toolName,
    orderId: asked ?? result.orders[0]?.id ?? null,
    outcome: result.outcome,
    status: result.orders.find((o) => o.id === asked)?.status ?? result.orders[0]?.status ?? null,
  };
}

function messageText(content: unknown): string | null {
  const c = (content ?? {}) as { text?: unknown; caption?: unknown; fallbackText?: unknown };
  const t = [c.text, c.caption, c.fallbackText].find((v) => typeof v === 'string') as string | undefined;
  return t ? t.slice(0, 500) : null;
}
