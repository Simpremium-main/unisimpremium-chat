const kvExisting = jest.fn(async (_keys: string[]) => new Set<string>());
const kvPrefix = jest.fn(async (_prefix: string) => [] as string[]);
jest.mock('../../../runtime/kv-store', () => ({
  KvStore: jest.fn().mockImplementation(() => ({
    existingKeys: (keys: string[]) => kvExisting(keys),
    keysWithPrefix: (prefix: string) => kvPrefix(prefix),
    exists: jest.fn().mockResolvedValue(false),
  })),
}));

import { AgentRouterService } from './agent-router.service';

describe('AgentRouterService.aiActiveMap', () => {
  const conv = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, organizationId: 'o1', channelId: 'ch1', aiEnabled: null, activeAgentId: null, ...over }) as any;

  function setup(opts: { orgAi?: boolean; channelAi?: boolean | null; agentOnChannel?: boolean; cap?: number; used?: number } = {}) {
    const prisma: any = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1',
          aiEnabled: opts.orgAi ?? true,
          aiBusinessHours: null,
          aiTimezone: 'America/Sao_Paulo',
          aiMonthlyTokenCap: opts.cap ?? null,
        }),
      },
      channel: { findMany: jest.fn().mockResolvedValue([{ id: 'ch1', aiEnabled: opts.channelAi ?? null }]) },
      aiAgentChannel: {
        findMany: jest.fn().mockResolvedValue(opts.agentOnChannel === false ? [] : [{ channelId: 'ch1' }]),
      },
      aiAgentRun: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { inputTokens: opts.used ?? 0, outputTokens: 0 } }),
      },
    };
    return new AgentRouterService(prisma, {} as any, {} as any);
  }

  it('ativa por padrão quando o canal tem agente', async () => {
    const m = await setup().aiActiveMap([conv('a'), conv('b', { aiEnabled: false })]);
    expect(m.get('a')).toBe(true);
    expect(m.get('b')).toBe(false); // pausada na conversa
  });

  it('IA geral desligada: só a conversa forçada ON fica ativa', async () => {
    const m = await setup({ orgAi: false }).aiActiveMap([conv('a'), conv('b', { aiEnabled: true })]);
    expect(m.get('a')).toBe(false);
    expect(m.get('b')).toBe(true);
  });

  it('canal desligado, sem agente ou limite mensal → inativa', async () => {
    expect((await setup({ channelAi: false }).aiActiveMap([conv('a')])).get('a')).toBe(false);
    expect((await setup({ agentOnChannel: false }).aiActiveMap([conv('a')])).get('a')).toBe(false);
    expect((await setup({ agentOnChannel: false }).aiActiveMap([conv('a', { activeAgentId: 'x' })])).get('a')).toBe(true);
    expect((await setup({ cap: 100, used: 100 }).aiActiveMap([conv('a', { aiEnabled: true })])).get('a')).toBe(false);
  });
});

describe('AgentRouterService.aiActiveWhere ≡ aiActiveMap', () => {
  // Avaliador mínimo do formato de where gerado (OR / igualdade / in / not null).
  const matches = (where: any, row: any): boolean =>
    Object.entries(where).every(([key, cond]: [string, any]) => {
      if (key === 'OR') return (cond as any[]).some((w) => matches(w, row));
      if (cond === null || typeof cond !== 'object') return row[key] === cond;
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('not' in cond) return row[key] !== cond.not;
      throw new Error(`condição não suportada: ${key}`);
    });

  it('mesmo resultado em todas as combinações', async () => {
    for (const orgAi of [true, false]) {
      for (const channelAi of [true, false, null]) {
        for (const agentOnChannel of [true, false]) {
          const prisma: any = {
            organization: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'o1', aiEnabled: orgAi, aiBusinessHours: null, aiTimezone: 'America/Sao_Paulo', aiMonthlyTokenCap: null,
              }),
            },
            channel: { findMany: jest.fn().mockResolvedValue([{ id: 'ch1', aiEnabled: channelAi }]) },
            aiAgentChannel: { findMany: jest.fn().mockResolvedValue(agentOnChannel ? [{ channelId: 'ch1' }] : []) },
            aiAgentRun: { aggregate: jest.fn() },
          };
          const router = new AgentRouterService(prisma, {} as any, {} as any);
          const where = await router.aiActiveWhere('o1');
          for (const aiEnabled of [true, false, null]) {
            for (const activeAgentId of [null, 'agent-x']) {
              const row = { id: 'c', organizationId: 'o1', channelId: 'ch1', aiEnabled, activeAgentId };
              const expected = (await router.aiActiveMap([row as any])).get('c');
              expect({ orgAi, channelAi, agentOnChannel, aiEnabled, activeAgentId, got: matches(where, row) })
                .toEqual({ orgAi, channelAi, agentOnChannel, aiEnabled, activeAgentId, got: expected });
            }
          }
        }
      }
    }
  });

  it('limite mensal atingido → nenhuma conversa', async () => {
    const prisma: any = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', aiEnabled: true, aiBusinessHours: null, aiMonthlyTokenCap: 10 }) },
      aiAgentRun: { aggregate: jest.fn().mockResolvedValue({ _sum: { inputTokens: 10, outputTokens: 0 } }) },
    };
    expect(await new AgentRouterService(prisma, {} as any, {} as any).aiActiveWhere('o1')).toBeNull();
  });
});

describe('robô (chatbot) conduzindo a conversa', () => {
  const prisma: any = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ id: 'o1', aiEnabled: true, aiBusinessHours: null, aiMonthlyTokenCap: null }),
    },
    channel: { findMany: jest.fn().mockResolvedValue([{ id: 'ch1', aiEnabled: null }]) },
    aiAgentChannel: { findMany: jest.fn().mockResolvedValue([{ channelId: 'ch1' }]) },
  };
  const row = (id: string) => ({ id, organizationId: 'o1', channelId: 'ch1', aiEnabled: null, activeAgentId: null }) as any;

  it('IA não fica ativa onde o robô está rodando', async () => {
    kvExisting.mockResolvedValueOnce(new Set(['bot:session:a']));
    const m = await new AgentRouterService(prisma, {} as any, {} as any).aiActiveMap([row('a'), row('b')]);
    expect(m.get('a')).toBe(false);
    expect(m.get('b')).toBe(true);
  });

  it('inbox "IA Ativo" exclui conversas com robô', async () => {
    kvPrefix.mockResolvedValueOnce(['bot:session:a']);
    const where: any = await new AgentRouterService(prisma, {} as any, {} as any).aiActiveWhere('o1');
    expect(where.id).toEqual({ notIn: ['a'] });
  });
});
