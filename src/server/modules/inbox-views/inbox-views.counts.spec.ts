jest.mock('../../runtime/kv-store', () => ({
  KvStore: jest.fn().mockImplementation(() => ({})),
}));

import { InboxViewsService } from './inbox-views.service';
import { ConversationsService } from '../messaging/conversations/conversations.service';

describe('bolinhas do menu (contagem das inboxes)', () => {
  const views = [
    { id: 'v1', name: 'Não respondidas', filters: { unansweredOnly: true }, metadata: { builtin: true } },
    { id: 'v2', name: 'IA Ativo', filters: { aiActive: true, statuses: ['OPEN'] }, metadata: { builtin: true } },
    { id: 'v3', name: 'IA para Humano', filters: { aiToHuman: true, statuses: ['OPEN'] }, metadata: { builtin: true } },
  ];

  it('só conta, sem abrir cada inbox, e compartilha os conjuntos da IA', async () => {
    const prisma: any = {
      inboxView: { findMany: jest.fn().mockResolvedValue(views), findUnique: jest.fn() },
    };
    const conversations: any = {
      countInbox: jest.fn(async (_org: string, q: any) => (q.unansweredOnly ? 3 : q.aiActive ? 2 : 1)),
      findInbox: jest.fn(),
    };
    const svc = new InboxViewsService(prisma, conversations);

    expect(await svc.counts('org1', 'u1', 'ALL')).toEqual({ v1: 3, v2: 2, v3: 1 });
    expect(conversations.findInbox).not.toHaveBeenCalled();
    expect(prisma.inboxView.findUnique).not.toHaveBeenCalled();
    const memos = conversations.countInbox.mock.calls.map((c: any[]) => c[4]);
    expect(new Set(memos).size).toBe(1);
    // Mesmas regras de exclusão da listagem.
    const unanswered = conversations.countInbox.mock.calls.find((c: any[]) => c[1].unansweredOnly)[1];
    // Sem as que a IA atende; transferidas e as que esperam o admin entram.
    expect(unanswered).toMatchObject({ excludeAiActive: true });
    expect(unanswered.excludeAiToHuman).toBeUndefined();
    expect(unanswered.excludeAiWaiting).toBeUndefined();
    expect(unanswered.unreadOnly).toBe(false);
  });

  it('uma inbox com erro não derruba as outras', async () => {
    const prisma: any = { inboxView: { findMany: jest.fn().mockResolvedValue(views) } };
    const conversations: any = {
      countInbox: jest.fn(async (_org: string, q: any) => {
        if (q.aiToHuman) throw new Error('boom');
        return 5;
      }),
    };
    const out = await new InboxViewsService(prisma, conversations).counts('org1', 'u1', 'ALL');
    expect(out).toEqual({ v1: 5, v2: 5 });
  });
});

describe('ConversationsService.countInbox', () => {
  function setup() {
    const repository: any = { countInbox: jest.fn(async () => 7) };
    const agentRouter: any = { aiActiveWhere: jest.fn(async () => ({ aiEnabled: true })) };
    const prisma: any = {
      $queryRaw: jest.fn(async () => [{ id: 'c1' }]),
      aiHelpRequest: { findMany: jest.fn(async () => [{ conversationId: 'c2' }]) },
      conversation: { findMany: jest.fn(async () => [{ id: 'c3' }]) },
    };
    const svc = new ConversationsService(
      repository, {} as any, {} as any, prisma, {} as any, {} as any, {} as any, agentRouter, {} as any, {} as any, {} as any,
    );
    return { svc, repository, prisma, agentRouter };
  }

  it('com o mesmo memo, "IA para humano" e "IA aguardando" saem do banco uma vez só', async () => {
    const { svc, prisma, repository } = setup();
    const memo = new Map();
    await Promise.all([
      svc.countInbox('o', { unreadOnly: true, excludeAiToHuman: true, excludeAiWaiting: true }, 'ALL', 'u', memo),
      svc.countInbox('o', { aiActive: true, excludeAiToHuman: true, excludeAiWaiting: true }, 'ALL', 'u', memo),
      svc.countInbox('o', { aiToHuman: true, excludeAiWaiting: true }, 'ALL', 'u', memo),
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.aiHelpRequest.findMany).toHaveBeenCalledTimes(1);
    expect(repository.countInbox).toHaveBeenCalledTimes(3);
    // "IA para Humano": as transferidas, sem as que esperam o admin.
    expect(repository.countInbox.mock.calls.map((c: any[]) => c[0].extraWhere)).toContainEqual({
      AND: [{ id: { in: ['c1'] } }, { id: { notIn: ['c2'] } }],
    });
  });

  it('filtro que com certeza é vazio devolve 0 sem contar', async () => {
    const { svc, repository, agentRouter } = setup();
    agentRouter.aiActiveWhere.mockResolvedValue(null);
    expect(await svc.countInbox('o', { aiActive: true })).toBe(0);
    expect(repository.countInbox).not.toHaveBeenCalled();
  });
});

describe('inbox "Não respondidas" (antes "Não lidas")', () => {
  it('a builtin antiga é renomeada e ganha o filtro novo, sem criar outra', async () => {
    const old = {
      id: 'v1',
      name: 'Não lidas',
      metadata: { builtin: true },
      filters: { unreadOnly: true, excludeAiActive: true, channelIds: ['x'] },
    };
    const prisma: any = {
      inboxView: {
        findMany: jest.fn().mockResolvedValue([old]),
        update: jest.fn(async (a: any) => a),
        create: jest.fn(async (a: any) => a),
        findFirst: jest.fn(async () => ({ order: 0 })),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(async (ops: any[]) => ops),
    };
    const svc = new InboxViewsService(prisma, {} as any);
    await (svc as any).ensureBuiltinViews('org1', 'u1');

    const rename = prisma.inboxView.update.mock.calls.find((c: any[]) => c[0].where.id === 'v1' && c[0].data.name)[0];
    expect(rename.data.name).toBe('Não respondidas');
    expect(rename.data.filters).toEqual({
      channelIds: ['x'],
      unansweredOnly: true,
      excludeAiActive: true,
      statuses: ['PENDING', 'BOT', 'OPEN', 'WAITING'],
    });
    const createdNames = prisma.inboxView.create.mock.calls.map((c: any[]) => c[0].data.name);
    expect(createdNames).not.toContain('Não respondidas');
  });

  it('pelo nome: só não respondidas, sem as que a IA atende, e não depende de leitura', () => {
    const svc = new InboxViewsService({} as any, {} as any);
    const q = (svc as any).viewQuery(
      { name: 'Não respondidas', filters: { statuses: ['OPEN'] }, metadata: { builtin: true } },
      'u1',
    );
    expect(q).toMatchObject({
      unansweredOnly: true,
      unreadOnly: false,
      excludeAiActive: true,
      status: 'OPEN',
    });
    expect(q.excludeAiToHuman).toBeUndefined();
    expect(q.excludeAiWaiting).toBeUndefined();
  });
});

describe('repositório: filtro unansweredOnly', () => {
  it('limita às conversas cuja última mensagem é do cliente', async () => {
    const { ConversationsRepository } = require('../messaging/conversations/conversations.repository');
    const prisma: any = {
      $queryRaw: jest.fn(async () => [{ id: 'c1' }, { id: 'c2' }]),
      conversation: { count: jest.fn(async () => 2) },
    };
    const repo = new ConversationsRepository(prisma);
    expect(await repo.countInbox({ organizationId: 'o', unansweredOnly: true })).toBe(2);
    const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
    expect(sql).toMatch(/ORDER BY m\.created_at DESC\s+LIMIT 1\s+\) lm ON true/);
    expect(sql).toMatch(/lm\.direction = 'INBOUND'/);
    // "Tirar do Não respondidas": some até o cliente mandar mensagem nova.
    expect(sql).toMatch(/lm\.created_at > \(\(c\.metadata->>'unansweredDismissedAt'\)/);
    expect(prisma.conversation.count.mock.calls[0][0].where.id).toEqual({ in: ['c1', 'c2'] });

    prisma.$queryRaw.mockResolvedValueOnce([]);
    expect(await repo.countInbox({ organizationId: 'o', unansweredOnly: true })).toBe(0);
    // Com outro filtro de ids, fica a interseção.
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'c1' }]);
    await repo.countInbox({ organizationId: 'o', unansweredOnly: true, conversationIds: ['c1', 'c9'] });
    expect(prisma.conversation.count.mock.calls.at(-1)[0].where.id).toEqual({ in: ['c1'] });
  });
});

describe('conversa em "IA para Humano" fica só nessa inbox', () => {
  it('"Aberto" (sem busca) e inboxes com "esconder IA" excluem as transferidas sem resposta', async () => {
    const { ConversationsController } = require('../messaging/conversations/conversations.controller');
    const service: any = { findInbox: jest.fn(async () => ({})) };
    const ctrl = Object.create(ConversationsController.prototype);
    ctrl.service = service;
    const call = (hideAi?: string) =>
      (ctrl as any).findInbox('org1', 'u1', 'ALL', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, hideAi);
    await call('true');
    expect(service.findInbox.mock.calls[0][1]).toMatchObject({
      excludeAiActive: true,
      excludeAiWaiting: true,
      excludeAiToHuman: true,
    });
    // Busca (front não manda hideAi): acha a conversa onde ela estiver.
    await call(undefined);
    expect(service.findInbox.mock.calls[1][1].excludeAiToHuman).toBeUndefined();

    const svc = new InboxViewsService({} as any, {} as any);
    const custom = (svc as any).viewQuery({ name: 'Minha', filters: { hideAi: true }, metadata: {} }, 'u1');
    expect(custom).toMatchObject({ excludeAiActive: true, excludeAiWaiting: true, excludeAiToHuman: true });
  });
});
