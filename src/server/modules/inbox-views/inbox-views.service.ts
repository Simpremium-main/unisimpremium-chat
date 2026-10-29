import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  ConversationsService,
  InboxMemo,
  InboxQueryFilters,
} from '../messaging/conversations/conversations.service';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import {
  CreateInboxViewDto,
  InboxViewFiltersDto,
  UpdateInboxViewDto,
} from './dto/inbox-view.dto';

/** Inbox fixa das conversas que esperam resposta (antes "Não lidas"). */
const UNANSWERED = 'Não respondidas';
const UNANSWERED_FILTERS = {
  unansweredOnly: true,
  excludeAiActive: true,
  statuses: ['PENDING', 'BOT', 'OPEN', 'WAITING'],
};

@Injectable()
export class InboxViewsService {
  private readonly logger = new Logger(InboxViewsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /**
   * Built-in inbox views every user gets. Created lazily on first list()
   * so existing users pick them up without a backfill migration. Marked
   * with `metadata.builtin = true` so the UI can render an immutable
   * pin (no rename/delete).
   */
  private static readonly BUILTIN_VIEWS: Array<{
    name: string;
    icon: string;
    color: string;
    filters: Record<string, any>;
    /** Inbox criada à mão com este nome vira a builtin (sem duplicar). */
    adopt?: RegExp;
  }> = [
    {
      // Cliente mandou mensagem e ninguém (equipe, IA ou robô) respondeu
      // ainda, fora as conversas que a IA está atendendo. Antes "Não lidas".
      name: UNANSWERED,
      icon: 'MailOpen',
      color: '#ef4444',
      filters: UNANSWERED_FILTERS,
      adopt: /^n[aã]o\s+respondid[ao]s?$/i,
    },
    {
      name: 'Encerrada',
      icon: 'CheckCircle',
      color: '#6b7280',
      filters: { statuses: ['CLOSED'] },
      adopt: /^encerrad[ao]s?$/i,
    },
  ];

  /** Builtins renomeadas: a linha antiga ganha o nome e o filtro novos. */
  private static readonly RENAMED_BUILTINS: Array<{ from: string; to: string; filters: Record<string, any> }> = [
    { from: 'Não lidas', to: UNANSWERED, filters: UNANSWERED_FILTERS },
  ];

  /**
   * Builtins que saíram do produto — apagados na próxima listagem. As
   * inboxes da IA saíram na Uni (atendimento em grupos).
   */
  private static readonly RETIRED_BUILTINS = ['Archived', 'IA Ativo', 'IA para Humano', 'IA Aguardando'];

  async list(organizationId: string, userId: string) {
    await this.ensureBuiltinViews(organizationId, userId);
    return this.prisma.inboxView.findMany({
      where: { organizationId, userId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Idempotently inserts the built-in views the first time a user lists
   * their inbox-views. Cheap because we only insert what's missing — and
   * the metadata flag identifies them across runs.
   */
  private async ensureBuiltinViews(organizationId: string, userId: string) {
    let existing = await this.prisma.inboxView.findMany({
      where: { organizationId, userId },
      select: { id: true, name: true, metadata: true, filters: true },
    });
    const isBuiltin = (v: { metadata: unknown }) =>
      !!v.metadata && typeof v.metadata === 'object' && (v.metadata as any).builtin === true;

    // Inbox "Arquivada" saiu (arquivamento foi removido).
    const retired = existing.filter(
      (v) => isBuiltin(v) && InboxViewsService.RETIRED_BUILTINS.includes(v.name),
    );
    if (retired.length > 0) {
      await this.prisma.inboxView.deleteMany({ where: { id: { in: retired.map((v) => v.id) } } });
      existing = existing.filter((v) => !retired.includes(v));
    }

    // Antes de adotar/criar: a builtin com nome antigo vira a nova (sem
    // duplicar), mantendo posição, ícone e cor.
    for (const r of InboxViewsService.RENAMED_BUILTINS) {
      if (existing.some((v) => isBuiltin(v) && v.name === r.to)) continue;
      const old = existing.find((v) => isBuiltin(v) && v.name === r.from);
      if (!old) continue;
      const { unreadOnly: _unread, ...kept } = (old.filters ?? {}) as Record<string, unknown>;
      const filters = { ...kept, ...r.filters };
      await this.prisma.inboxView.update({
        where: { id: old.id },
        data: { name: r.to, filters: filters as object },
      });
      existing = existing.map((v) => (v.id === old.id ? { ...v, name: r.to, filters } : v));
    }

    // Quem já criou à mão uma inbox com o nome de uma builtin ("Encerrada")
    // não ganha uma duplicada: a dele vira a builtin, com o
    // filtro e o ícone dela (mantém os demais filtros que tinha).
    for (const b of InboxViewsService.BUILTIN_VIEWS) {
      if (!b.adopt) continue;
      if (existing.some((v) => isBuiltin(v) && v.name === b.name)) continue;
      const manual = existing.find((v) => !isBuiltin(v) && b.adopt!.test(v.name.trim()));
      if (!manual) continue;
      const { archived: _archived, ...filters } = (manual.filters ?? {}) as Record<string, unknown>;
      await this.prisma.inboxView.update({
        where: { id: manual.id },
        data: {
          name: b.name,
          icon: b.icon,
          filters: { ...filters, ...b.filters } as object,
          metadata: { ...((manual.metadata as object) ?? {}), builtin: true } as object,
        },
      });
      existing = existing.map((v) =>
        v.id === manual.id ? { ...v, name: b.name, metadata: { builtin: true } } : v,
      );
    }

    const haveBuiltin = new Set(existing.filter(isBuiltin).map((v) => v.name));

    const missing = InboxViewsService.BUILTIN_VIEWS.filter(
      (b) => !haveBuiltin.has(b.name),
    );
    if (missing.length > 0) {
      await this.createBuiltins(organizationId, userId, missing);
    }
  }

  /** Inboxes com bolinha de contagem no menu. */
  private static readonly COUNTED_BUILTINS = [UNANSWERED];

  /**
   * Quantas conversas há em cada inbox com bolinha (id da inbox → total).
   * Só conta (sem carregar conversas) e calcula uma vez só, para todas as
   * inboxes, os conjuntos caros da IA.
   */
  async counts(organizationId: string, userId: string, access: ChannelAccess): Promise<Record<string, number>> {
    const views = await this.prisma.inboxView.findMany({
      where: { organizationId, userId, name: { in: InboxViewsService.COUNTED_BUILTINS } },
      select: { id: true, name: true, filters: true, metadata: true },
    });
    const memo: InboxMemo = new Map();
    const out: Record<string, number> = {};
    await Promise.all(
      views
        .filter((v) => (v.metadata as any)?.builtin === true)
        .map(async (v) => {
          // Uma inbox com erro (ex.: tabela de casos ainda não criada) não
          // derruba as bolinhas das outras.
          try {
            out[v.id] = await this.conversationsService.countInbox(
              organizationId,
              this.viewQuery(v, userId),
              access,
              userId,
              memo,
            );
          } catch (err) {
            this.logger.error(`count failed for inbox ${v.id}: ${(err as Error)?.message ?? err}`);
          }
        }),
    );
    return out;
  }

  /**
   * Seção Tags do menu, por tag: `total` = conversas abertas com ela, sem as
   * que a IA está atendendo (o que a lista da tag mostra); `unanswered` =
   * quantas delas estão em "Não respondidas" (mesma regra da inbox).
   */
  async tagCounts(
    organizationId: string,
    userId: string,
    access: ChannelAccess,
  ): Promise<Record<string, { total: number; unanswered: number }>> {
    const tags = await this.prisma.tag.findMany({ where: { organizationId }, select: { id: true } });
    const memo: InboxMemo = new Map();
    const out: Record<string, { total: number; unanswered: number }> = {};
    const base = { status: UNANSWERED_FILTERS.statuses.join(','), archived: 'any' as const, excludeAiActive: true };
    await Promise.all(
      tags.map(async (t) => {
        try {
          const [total, unanswered] = await Promise.all([
            this.conversationsService.countInbox(organizationId, { ...base, tagIds: [t.id] }, access, userId, memo),
            this.conversationsService.countInbox(
              organizationId,
              { ...base, tagIds: [t.id], unansweredOnly: true, excludeAiToHuman: true, excludeAiWaiting: true },
              access,
              userId,
              memo,
            ),
          ]);
          out[t.id] = { total, unanswered };
        } catch (err) {
          this.logger.error(`tag count failed for ${t.id}: ${(err as Error)?.message ?? err}`);
        }
      }),
    );
    return out;
  }

  /** Inboxes que mandam push pro celular (e somam no número do ícone). */
  static readonly PUSH_BUILTINS = [UNANSWERED];

  /**
   * Push do celular: em qual das inboxes de push a conversa está agora (a
   * primeira, na ordem do menu) e o total delas — o número do ícone do app.
   * `memo` compartilha os conjuntos da IA entre usuários do mesmo job.
   */
  async pushSummary(
    organizationId: string,
    userId: string,
    access: ChannelAccess,
    conversationId: string,
    memo: InboxMemo = new Map(),
  ): Promise<{ total: number; view: { id: string; name: string } | null }> {
    const views = await this.prisma.inboxView.findMany({
      where: { organizationId, userId, name: { in: InboxViewsService.PUSH_BUILTINS } },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, filters: true, metadata: true },
    });
    let total = 0;
    let view: { id: string; name: string } | null = null;
    for (const v of views.filter((x) => (x.metadata as any)?.builtin === true)) {
      const q = this.viewQuery(v, userId);
      try {
        const [count, here] = await Promise.all([
          this.conversationsService.countInbox(organizationId, q, access, userId, memo),
          this.conversationsService.countInbox(
            organizationId,
            { ...q, conversationIds: [conversationId] },
            access,
            userId,
            memo,
          ),
        ]);
        total += count;
        if (here > 0 && !view) view = { id: v.id, name: v.name };
      } catch (err) {
        // Inbox com erro (ex.: tabela de casos ainda não criada) não derruba as outras.
        this.logger.error(`push summary failed for inbox ${v.id}: ${(err as Error)?.message ?? err}`);
      }
    }
    return { total, view };
  }

  private async createBuiltins(
    organizationId: string,
    userId: string,
    missing: (typeof InboxViewsService.BUILTIN_VIEWS)[number][],
  ) {
    const max = await this.prisma.inboxView.findFirst({
      where: { userId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    let nextOrder = (max?.order ?? -1) + 1;

    for (const b of missing) {
      await this.prisma.inboxView.create({
        data: {
          organizationId,
          userId,
          name: b.name,
          icon: b.icon,
          color: b.color,
          filters: b.filters as object,
          metadata: { builtin: true } as object,
          order: nextOrder++,
        },
      });
    }
  }

  async findOne(id: string, organizationId: string, userId: string) {
    const view = await this.prisma.inboxView.findUnique({ where: { id } });
    if (!view) throw new NotFoundException('Inbox view not found');
    if (view.organizationId !== organizationId || view.userId !== userId) {
      throw new ForbiddenException();
    }
    return view;
  }

  async create(
    organizationId: string,
    userId: string,
    dto: CreateInboxViewDto,
  ) {
    const max = await this.prisma.inboxView.findFirst({
      where: { userId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = dto.order ?? (max?.order ?? -1) + 1;

    return this.prisma.inboxView.create({
      data: {
        organizationId,
        userId,
        name: dto.name,
        icon: dto.icon ?? null,
        color: dto.color ?? null,
        filters: (dto.filters ?? {}) as object,
        order: nextOrder,
      },
    });
  }

  async update(
    id: string,
    organizationId: string,
    userId: string,
    dto: UpdateInboxViewDto,
  ) {
    await this.findOne(id, organizationId, userId);
    return this.prisma.inboxView.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.filters !== undefined
          ? { filters: dto.filters as object }
          : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
  }

  async remove(id: string, organizationId: string, userId: string) {
    await this.findOne(id, organizationId, userId);
    await this.prisma.inboxView.delete({ where: { id } });
  }

  async reorder(organizationId: string, userId: string, ids: string[]) {
    const owned = await this.prisma.inboxView.findMany({
      where: { organizationId, userId, id: { in: ids } },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      throw new ForbiddenException('Some ids do not belong to this user');
    }
    await this.prisma.$transaction(
      ids.map((id, idx) =>
        this.prisma.inboxView.update({
          where: { id },
          data: { order: idx },
        }),
      ),
    );
  }

  /**
   * Apply a view's filters and return a paginated conversation list. Reuses
   * the existing ConversationsService.findInbox for parity with the default
   * inbox query.
   *
   * `overrides` = filtros locais do user passados pela toolbar (ex: ligar
   * "Não lidas" dentro de uma view de canal específico, ou filtrar por tag
   * em cima de uma view de "Pendentes"). Regra: parâmetro presente vence
   * o filtro salvo da view. View é baseline, query string é override.
   */
  async findConversations(
    id: string,
    organizationId: string,
    userId: string,
    access: ChannelAccess,
    page: number,
    limit: number,
    extraSearch?: string,
    overrides?: {
      unread?: string;
      archived?: string;
      groups?: string;
      channelId?: string;
      tagIds?: string;
      assignedToId?: string;
      stuck?: string;
    },
  ) {
    const view = await this.findOne(id, organizationId, userId);
    return this.conversationsService.findInbox(
      organizationId,
      this.viewQuery(view, userId, overrides, extraSearch),
      page,
      limit,
      access,
      userId,
    );
  }

  /** Filtros salvos da inbox (+ overrides da toolbar) → filtros da lista. */
  private viewQuery(
    view: { name: string; filters: unknown; metadata: unknown },
    userId: string,
    overrides?: Parameters<InboxViewsService['findConversations']>[7],
    extraSearch?: string,
  ): InboxQueryFilters {
    const filters = (view.filters ?? {}) as InboxViewFiltersDto;
    const builtin = (view.metadata as any)?.builtin === true ? view.name : null;

    // Resolve "me"/"none"/"any" tokens against the current user.
    let assignedToId: string | undefined;
    if (filters.assignedTo === 'me') assignedToId = userId;
    else if (filters.assignedTo === 'none') assignedToId = 'null';
    else if (filters.assignedTo && filters.assignedTo !== 'any')
      assignedToId = filters.assignedTo;

    const status = filters.statuses?.length
      ? filters.statuses.join(',')
      : undefined;

    // ─── Merge overrides ─────────────────────────────────────────
    // Cada override só sobrepõe quando o user mandou algo explícito.
    // String vazia em archived/groups conta como "não passou".
    const ov = overrides ?? {};

    const finalUnread =
      ov.unread !== undefined
        ? ov.unread === 'true' || ov.unread === '1'
        : (filters.unreadOnly ?? false);

    // Arquivamento saiu do produto: views ignoram is_archived.
    const finalArchived = 'any' as const;

    let finalKind = filters.kind;
    if (ov.groups === 'exclude') finalKind = 'INDIVIDUAL';
    else if (ov.groups === 'only') finalKind = 'GROUP';
    // groups='include' deixa undefined (mostra ambos)
    else if (ov.groups === 'include') finalKind = undefined;

    // Inboxes fixas valem para todos os canais: um canal salvo numa inbox
    // antiga adotada (feita à mão) escondia os números novos.
    const finalChannelIds = ov.channelId
      ? [ov.channelId]
      : builtin
        ? undefined
        : filters.channelIds;

    // Tags: query param SUBSTITUI tags da view (não merge — mais previsível
    // pro user clicar e ver o filtro mudar). Se quiser combinar, salva uma
    // view custom com as tags certas.
    const overrideTagIds = ov.tagIds
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const finalTagIds =
      overrideTagIds && overrideTagIds.length > 0
        ? overrideTagIds
        : filters.tagIds;

    const finalAssignedToId = ov.assignedToId ?? assignedToId;
    const finalStuck = ov.stuck === 'true' || ov.stuck === '1';

    return {
      status,
      channelIds: finalChannelIds,
      conversationIds: filters.conversationIds,
      kind: finalKind,
      tagIds: finalTagIds,
      assignedToId: finalAssignedToId,
      search: extraSearch,
      archived: finalArchived,
      unreadOnly: finalUnread,
      // Regra da builtin pelo nome (vale mesmo se o filtro salvo for antigo).
      unansweredOnly: filters.unansweredOnly === true || builtin === UNANSWERED || undefined,
      stuckOnly: finalStuck || undefined,
      aiActive: filters.aiActive === true || undefined,
      aiToHuman: filters.aiToHuman === true || undefined,
      aiWaiting: filters.aiWaiting === true || undefined,
      // Regras das builtins valem pelo nome (linhas antigas não têm o filtro salvo).
      // "Não respondidas" não mostra o que a IA está atendendo; as transferidas
      // para humano e as que esperam o admin entram (sem inbox própria da IA).
      excludeAiActive:
        filters.excludeAiActive === true || filters.hideAi === true || builtin === UNANSWERED || undefined,
      // Inbox criada à mão com "esconder IA" também não mostra as transferidas.
      excludeAiToHuman: filters.hideAi === true || undefined,
      excludeAiWaiting: filters.hideAi === true || undefined,
    };
  }
}
