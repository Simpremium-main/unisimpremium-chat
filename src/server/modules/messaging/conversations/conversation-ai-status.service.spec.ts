const kvExists = jest.fn();
const kvGet = jest.fn();
const pgQuery = jest.fn();
jest.mock('../../../runtime/kv-store', () => ({
  KvStore: jest.fn().mockImplementation(() => ({ exists: kvExists, get: kvGet })),
}));
jest.mock('../../../runtime/pg', () => ({ runtimePool: () => ({ query: pgQuery }) }));

import { ConversationAiStatusService } from './conversation-ai-status.service';

describe('ConversationAiStatusService', () => {
  const conv: any = {
    id: 'c1',
    organizationId: 'o1',
    channelId: 'ch1',
    status: 'OPEN',
    activeAgentId: null,
    aiEnabled: null,
    aiDisabledBy: null,
    aiDisabledAt: null,
    isStuck: false,
  };

  function setup(opts: {
    handle?: { handle: boolean; reason?: string };
    lastRun?: any;
    lastMessage?: any;
    userName?: string;
  } = {}) {
    const prisma: any = {
      aiAgentRun: { findFirst: jest.fn().mockResolvedValue(opts.lastRun ?? null) },
      aiAgent: { findUnique: jest.fn() },
      aiAgentChannel: {
        findFirst: jest.fn().mockResolvedValue({ agent: { id: 'a1', name: 'Sofia' } }),
      },
      message: { findFirst: jest.fn().mockResolvedValue(opts.lastMessage ?? null) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: opts.userName ?? 'Maria' }) },
    };
    const router: any = {
      shouldHandle: jest.fn().mockResolvedValue(opts.handle ?? { handle: true }),
    };
    return new ConversationAiStatusService(prisma, router);
  }

  beforeEach(() => {
    kvExists.mockResolvedValue(false);
    kvGet.mockResolvedValue(null);
    pgQuery.mockResolvedValue({ rows: [] });
  });

  it('RUNNING quando o lock do run existe', async () => {
    kvExists.mockResolvedValue(true);
    const s = await setup().getStatus(conv);
    expect(s).toMatchObject({ state: 'RUNNING', message: 'Sofia está respondendo…' });
  });

  it('QUEUED quando há debounce pendente', async () => {
    pgQuery.mockResolvedValue({ rows: [{ run_at: new Date('2026-01-01T10:00:00Z') }] });
    const s = await setup().getStatus(conv);
    expect(s.state).toBe('QUEUED');
    expect(s.runAt).toBe('2026-01-01T10:00:00.000Z');
  });

  it('BLOCKED com o nome de quem assumiu quando atendente pausou', async () => {
    const s = await setup({
      handle: { handle: false, reason: 'conversation.aiEnabled=force-off' },
      userName: 'João',
    }).getStatus({ ...conv, aiEnabled: false, aiDisabledBy: 'u1' });
    expect(s.state).toBe('BLOCKED');
    expect(s.reason).toBe('paused-by-human');
    expect(s.message).toContain('João assumiu');
  });

  it('BLOCKED fora do horário', async () => {
    const s = await setup({ handle: { handle: false, reason: 'outside-business-hours' } }).getStatus(conv);
    expect(s).toMatchObject({ state: 'BLOCKED', message: 'Fora do horário de atendimento da IA' });
  });

  it('ACTIVE aguardando cliente quando a última msg foi nossa', async () => {
    const s = await setup({
      lastRun: { status: 'COMPLETED', finalAction: 'REPLIED', startedAt: new Date(1000), agent: null },
      lastMessage: { direction: 'OUTBOUND', createdAt: new Date(2000) },
    }).getStatus(conv);
    expect(s).toMatchObject({ state: 'ACTIVE', reason: 'waiting-customer' });
  });

  it('ERROR quando o último run falhou', async () => {
    const s = await setup({
      lastRun: { status: 'FAILED', finalAction: null, errorMessage: 'timeout', startedAt: new Date(3000), agent: null },
      lastMessage: { direction: 'INBOUND', createdAt: new Date(2000) },
    }).getStatus(conv);
    expect(s).toMatchObject({ state: 'ERROR', reason: 'last-run-failed' });
    expect(s.message).toContain('timeout');
  });

  it('avisa mensagem do cliente sem resposta', async () => {
    const s = await setup({
      lastRun: { status: 'COMPLETED', finalAction: 'REPLIED', startedAt: new Date(1000), agent: null },
      lastMessage: { direction: 'INBOUND', createdAt: new Date(2000) },
    }).getStatus(conv);
    expect(s.reason).toBe('inbound-unanswered');
  });

  it('avisa quando a IA ignorou a última mensagem como spam', async () => {
    kvGet.mockResolvedValue('m-last');
    const s = await setup({
      lastRun: null,
      lastMessage: { id: 'm-last', direction: 'INBOUND', createdAt: new Date(2000) },
    }).getStatus(conv);
    expect(s.reason).toBe('spam-skipped');
    expect(s.message).toContain('Engajar IA agora');
  });
});
