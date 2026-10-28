import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InternalNotesService } from './internal-notes.service';

describe('InternalNotesService', () => {
  function setup(note?: { authorType: 'USER' | 'AI'; authorId: string | null }) {
    const prisma: any = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1', channelId: 'ch-1' }),
      },
      message: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
      internalNote: {
        create: jest.fn(async ({ data }) => ({ id: 'n1', ...data })),
        update: jest.fn(async ({ data }) => ({ id: 'n1', ...data })),
        delete: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(note ? { id: 'n1', ...note } : null),
      },
    };
    const realtime: any = { emitToConversation: jest.fn() };
    const access: any = { assertChannelAccess: jest.fn() };
    return { svc: new InternalNotesService(prisma, realtime, access), prisma, realtime };
  }

  it('cria nota do atendente, aparada, e avisa em tempo real', async () => {
    const { svc, prisma, realtime } = setup();
    await svc.create('c1', 'org-1', 'ALL', 'u1', { content: '  oi  ', messageId: 'm1' });
    expect(prisma.internalNote.create.mock.calls[0][0].data).toMatchObject({
      authorType: 'USER',
      authorId: 'u1',
      messageId: 'm1',
      content: 'oi',
    });
    expect(realtime.emitToConversation).toHaveBeenCalledWith('c1', 'note:new', expect.anything());
  });

  it('recusa nota vazia e conversa de outra org', async () => {
    const { svc, prisma } = setup();
    await expect(svc.create('c1', 'org-1', 'ALL', 'u1', { content: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    prisma.conversation.findUnique.mockResolvedValue({ organizationId: 'outra', channelId: 'ch-1' });
    await expect(svc.create('c1', 'org-1', 'ALL', 'u1', { content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('mensagem anotada precisa ser da conversa', async () => {
    const { svc, prisma } = setup();
    prisma.message.findFirst.mockResolvedValue(null);
    await expect(svc.create('c1', 'org-1', 'ALL', 'u1', { content: 'x', messageId: 'm9' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('só o autor edita', async () => {
    const { svc } = setup({ authorType: 'USER', authorId: 'u1' });
    await expect(svc.update('c1', 'n1', 'org-1', 'ALL', 'u2', 'novo')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.update('c1', 'n1', 'org-1', 'ALL', 'u1', 'novo')).resolves.toMatchObject({ content: 'novo' });
  });

  it('nota da IA não é editável; admin apaga, agente não', async () => {
    const { svc, prisma } = setup({ authorType: 'AI', authorId: null });
    await expect(svc.update('c1', 'n1', 'org-1', 'ALL', 'u1', 'x')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.remove('c1', 'n1', 'org-1', 'ALL', 'u1', 'AGENT' as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.remove('c1', 'n1', 'org-1', 'ALL', 'u1', 'ADMIN' as any)).resolves.toEqual({ id: 'n1' });
    expect(prisma.internalNote.delete).toHaveBeenCalled();
  });
});
