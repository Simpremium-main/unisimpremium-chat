jest.mock('../../../runtime/kv-store', () => ({
  KvStore: jest.fn().mockImplementation(() => ({ exists: jest.fn(async () => false) })),
}));

import { AgentRouterService } from './agent-router.service';

describe('AgentRouter: IA sempre ativa nos grupos', () => {
  const prisma: any = {
    channel: { findUnique: jest.fn(async () => ({ aiEnabled: null })) },
    organization: { findUnique: jest.fn(async () => ({ id: 'o1', aiEnabled: true, aiMonthlyTokenCap: null, businessHours: null })) },
    aiAgentChannel: { findFirst: jest.fn(async () => ({ id: 'link' })) },
  };
  const router = new AgentRouterService(prisma, {} as any, {} as any);
  (router as any).isWithinBusinessHours = () => true;
  const conv = (over: Record<string, unknown>) => ({ id: 'c1', organizationId: 'o1', channelId: 'ch1', activeAgentId: null, ...over }) as any;

  it('grupo com IA desligada na conversa continua respondendo', async () => {
    expect(await router.shouldHandle(conv({ isGroup: true, aiEnabled: false }))).toEqual({ handle: true });
  });

  it('conversa individual desligada continua desligada', async () => {
    expect((await router.shouldHandle(conv({ isGroup: false, aiEnabled: false }))).handle).toBe(false);
  });

  it('canal desligado desliga o grupo', async () => {
    prisma.channel.findUnique.mockResolvedValueOnce({ aiEnabled: false });
    expect((await router.shouldHandle(conv({ isGroup: true, aiEnabled: null }))).reason).toBe('channel.aiEnabled=force-off');
  });
});
