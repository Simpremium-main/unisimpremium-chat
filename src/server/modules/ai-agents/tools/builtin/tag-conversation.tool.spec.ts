import { TagConversationTool } from './tag-conversation.tool';

describe('TagConversationTool', () => {
  const ctx = {
    organizationId: 'org-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    channelId: 'ch-1',
    agentId: 'agent-1',
  } as any;

  function setup(tags: { id: string; name: string }[]) {
    const tx = { conversationTag: { create: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      tag: { findMany: jest.fn().mockResolvedValue(tags), create: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const tool = new TagConversationTool(prisma as any, outbox as any);
    return { tool, prisma, tx };
  }

  it('aplica tag existente ignorando caixa, acento e hífen', async () => {
    const { tool, prisma, tx } = setup([{ id: 't1', name: 'Lead Quente' }]);
    const res = await tool.execute({ tags: ['lead-quênte'] }, ctx);
    expect(res.output).toMatchObject({ ok: true, applied: ['Lead Quente'] });
    expect(tx.conversationTag.create).toHaveBeenCalledWith({
      data: { conversationId: 'conv-1', tagId: 't1' },
    });
    expect(prisma.tag.create).not.toHaveBeenCalled();
  });

  it('nunca cria tag nova; devolve as disponíveis', async () => {
    const { tool, prisma, tx } = setup([{ id: 't1', name: 'Suporte' }]);
    const res = await tool.execute({ tags: ['inventada'] }, ctx);
    expect(res.output).toMatchObject({
      ok: false,
      notFound: ['inventada'],
      availableTags: ['Suporte'],
    });
    expect(prisma.tag.create).not.toHaveBeenCalled();
    expect(tx.conversationTag.create).not.toHaveBeenCalled();
  });

  it('aplica as existentes e informa as ignoradas', async () => {
    const { tool } = setup([{ id: 't1', name: 'Suporte' }]);
    const res = await tool.execute({ tags: ['suporte', 'nova'] }, ctx);
    expect(res.output).toMatchObject({ ok: true, applied: ['Suporte'], notFound: ['nova'] });
  });
});
