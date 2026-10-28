import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QuickRepliesService, normalizeShortcut } from './quick-replies.service';
import { ChatbotFlowsService } from '../chatbot/chatbot-flows/chatbot-flows.service';

describe('respostas rápidas', () => {
  it('atalho sem barra, minúsculo e sem espaços', () => {
    expect(normalizeShortcut(' /Pix Loja ')).toBe('pix-loja');
    expect(() => normalizeShortcut(' / ')).toThrow(BadRequestException);
  });

  function service(existing: any = null) {
    const repo: any = {
      findByShortcut: jest.fn(async () => existing),
      purgeDeletedShortcut: jest.fn(async () => undefined),
      create: jest.fn(async (data: any) => data),
    };
    return { svc: new QuickRepliesService(repo), repo };
  }

  it('grava quem cadastrou e libera atalho de resposta apagada', async () => {
    const { svc, repo } = service();
    const created: any = await svc.create('org1', 'user1', { shortcut: '/PIX', title: ' Pix ', content: 'Chave: x' });
    expect(created).toMatchObject({ shortcut: 'pix', title: 'Pix', isPrivate: false, createdBy: { connect: { id: 'user1' } } });
    expect(repo.purgeDeletedShortcut).toHaveBeenCalledWith('org1', 'pix');
  });

  it('atalho repetido é recusado com mensagem clara', async () => {
    const { svc } = service({ id: 'other' });
    await expect(svc.create('org1', 'u', { shortcut: 'pix', title: 't', content: 'c' })).rejects.toThrow(
      new ConflictException('O atalho /pix já existe'),
    );
  });
});

describe('respostas rápidas pessoais ("só para mim")', () => {
  function service(row: any) {
    const repo: any = {
      findById: jest.fn(async () => row),
      findByShortcut: jest.fn(async () => null),
      purgeDeletedShortcut: jest.fn(async () => undefined),
      create: jest.fn(async (data: any) => data),
      update: jest.fn(async (_id: string, data: any) => data),
      softDelete: jest.fn(async () => ({})),
    };
    return { svc: new QuickRepliesService(repo), repo };
  }
  const mine = { id: 'q1', organizationId: 'org1', isPrivate: true, createdById: 'u1' };
  const team = { id: 'q2', organizationId: 'org1', isPrivate: false, createdById: 'u1' };

  it('cria como pessoal quando pedido', async () => {
    const { svc } = service(null);
    const created: any = await svc.create('org1', 'u1', { shortcut: 'oi', title: 'Oi', content: 'Oi!', isPrivate: true });
    expect(created.isPrivate).toBe(true);
  });

  it('pessoal de outro usuário não aparece, não edita e não apaga', async () => {
    const { svc, repo } = service(mine);
    await expect(svc.findOne('q1', 'org1', 'u2')).rejects.toThrow(NotFoundException);
    await expect(svc.update('q1', 'org1', 'u2', { title: 'x' })).rejects.toThrow(NotFoundException);
    await expect(svc.remove('q1', 'org1', 'u2')).rejects.toThrow(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
    await expect(svc.findOne('q1', 'org1', 'u1')).resolves.toBe(mine);
  });

  it('só quem cadastrou muda para quem aparece', async () => {
    await expect(service(team).svc.update('q2', 'org1', 'u2', { isPrivate: true })).rejects.toThrow(ForbiddenException);
    // Mandar o mesmo valor (o formulário sempre manda) não é mudança.
    await expect(service(team).svc.update('q2', 'org1', 'u2', { title: 'x', isPrivate: false })).resolves.toBeTruthy();
    await expect(service(team).svc.update('q2', 'org1', 'u1', { isPrivate: true })).resolves.toMatchObject({ isPrivate: true });
  });

  it('resposta antiga sem autor que vira pessoal fica com quem a tornou pessoal', async () => {
    const { svc } = service({ ...team, createdById: null });
    await expect(svc.update('q2', 'org1', 'u2', { isPrivate: true })).resolves.toMatchObject({
      isPrivate: true,
      createdBy: { connect: { id: 'u2' } },
    });
  });

  it('atalho já usado na pessoal de outro: mensagem diz isso', async () => {
    const { svc, repo } = service(null);
    repo.findByShortcut.mockResolvedValue({ id: 'q1', isPrivate: true, createdById: 'u1' });
    await expect(svc.create('org1', 'u2', { shortcut: 'pix', title: 't', content: 'c' })).rejects.toThrow(
      new ConflictException('O atalho /pix já é usado na resposta pessoal de outro atendente'),
    );
  });
});

describe('acionar robô pelo inbox', () => {
  function setup(conv: any) {
    const repo: any = { findById: jest.fn(async () => ({ id: 'f1', organizationId: 'org1', name: 'Menu', nodes: [{ id: 'n' }] })) };
    const prisma: any = {
      conversation: { findFirst: jest.fn(async () => conv), update: jest.fn(async () => ({})) },
      conversationAuditLog: { create: jest.fn(async () => ({})) },
    };
    const queue: any = { add: jest.fn(async () => ({})) };
    return { svc: new ChatbotFlowsService(repo, prisma, queue), prisma, queue };
  }
  const conv = {
    id: 'c1',
    channelId: 'ch1',
    status: 'OPEN',
    metadata: { chatbot: { completedAt: 'x', handoff: 'HUMAN' }, keep: 1 },
    contact: { channels: [{ channelId: 'ch1', externalId: '5511@s.whatsapp.net' }] },
  };

  it('enfileira o fluxo do início e apaga a marca do fluxo anterior', async () => {
    const { svc, prisma, queue } = setup(conv);
    await svc.runOnConversation('f1', 'org1', 'c1', 'u1', 'ALL');
    expect(prisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { metadata: { keep: 1 } } });
    expect(queue.add).toHaveBeenCalledWith('process-bot', expect.objectContaining({
      conversationId: 'c1',
      contactExternalId: '5511@s.whatsapp.net',
      startFlowId: 'f1',
    }));
  });

  it('respeita acesso ao canal e conversa encerrada', async () => {
    await expect(setup(conv).svc.runOnConversation('f1', 'org1', 'c1', 'u1', new Set(['outro']))).rejects.toThrow('Conversa não encontrada');
    await expect(setup({ ...conv, status: 'CLOSED' }).svc.runOnConversation('f1', 'org1', 'c1', 'u1', 'ALL')).rejects.toThrow('Reabra');
  });
});
