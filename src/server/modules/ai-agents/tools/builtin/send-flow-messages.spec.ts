import { SendFlowMessagesTool } from './send-flow-messages.tool';

describe('enviarMensagensDoFluxo não reenvia o mesmo fluxo', () => {
  const setup = (alreadySent: boolean) => {
    const prisma: any = {
      conversation: { findUnique: jest.fn(async () => ({ metadata: null })) },
      aiToolCall: { findFirst: jest.fn(async () => (alreadySent ? { id: 'x' } : null)) },
      aiAgent: { findUnique: jest.fn(async () => ({ name: 'IA' })) },
      message: { findFirst: jest.fn(async () => null) },
    };
    const playbooks: any = {
      findBySlug: jest.fn(async () => ({ slug: 'verificar-esim', steps: [{ type: 'TEXT', content: 'Para verificar…' }] })),
    };
    const sender: any = { contactExternalId: jest.fn(async () => '55@s'), sendSequence: jest.fn(async () => []) };
    const translator: any = { languageOf: jest.fn(async () => 'pt'), translate: jest.fn(async (t: string[]) => t) };
    return { tool: new SendFlowMessagesTool(prisma, playbooks, sender, translator), sender, prisma };
  };
  const ctx = { organizationId: 'o', conversationId: 'c', contactId: 'ct', channelId: 'ch', agentId: 'a', runId: 'r' };

  it('já enviado nesta conversa: não manda de novo', async () => {
    const { tool, sender, prisma } = setup(true);
    const res = await tool.execute({ fluxo: 'verificar-esim' }, ctx);
    expect(sender.sendSequence).not.toHaveBeenCalled();
    expect(res.output).toMatchObject({ ok: false, jaEnviado: true });
    expect(prisma.aiToolCall.findFirst.mock.calls[0][0].where.input).toEqual({ path: ['fluxo'], equals: 'verificar-esim' });
  });

  it('primeira vez: manda', async () => {
    const { tool, sender } = setup(false);
    const res = await tool.execute({ fluxo: 'verificar-esim' }, ctx);
    expect(sender.sendSequence).toHaveBeenCalled();
    expect(res.output).toMatchObject({ ok: true });
  });
});

describe('verificar-esim sempre depois de "Segue abaixo como verificar:"', () => {
  const flow = {
    slug: 'verificar-esim',
    steps: [{ type: 'TEXT', content: 'Para verificar se o seu aparelho é compatível com chip virtual, entre em:…', caption: null }],
  };
  const setup = (lastText: string | null) => {
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ metadata: null })) },
      aiToolCall: { findFirst: jest.fn(async () => null) },
      message: { findFirst: jest.fn(async () => (lastText === null ? null : { content: { text: lastText } })) },
    };
    const playbooks = { findBySlug: jest.fn(async () => flow) };
    const tool = new SendFlowMessagesTool(prisma as any, playbooks as any, {} as any, {} as any);
    const sent = jest.spyOn(tool, 'sendSteps').mockResolvedValue({ output: { ok: true } } as any);
    return { tool, sent };
  };
  const ctx = { organizationId: 'o', conversationId: 'c', agentId: 'a' } as any;

  it('a IA não escreveu a frase: ela vai antes do fluxo', async () => {
    const { tool, sent } = setup('Olá Gi! 👋');
    await tool.execute({ fluxo: 'verificar-esim' }, ctx);
    expect((sent.mock.calls[0][0] as any).steps.map((s: any) => s.content)).toEqual([
      'Segue abaixo como verificar:',
      flow.steps[0].content,
    ]);
  });

  it('a frase acabou de sair: só o fluxo', async () => {
    const { tool, sent } = setup('Apenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar:');
    await tool.execute({ fluxo: 'verificar-esim' }, ctx);
    expect((sent.mock.calls[0][0] as any).steps).toHaveLength(1);
  });
});

describe('cobrir a concorrência: pagamento só depois da equipe conferir', () => {
  const setup = (history: Array<{ direction: string; text: string }>) => {
    const prisma: any = {
      conversation: { findUnique: jest.fn(async () => ({ metadata: null })) },
      aiToolCall: { findFirst: jest.fn(async () => null) },
      message: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => history.map((m) => ({ direction: m.direction, content: { text: m.text } }))),
      },
    };
    const playbooks: any = { findBySlug: jest.fn(async () => ({ slug: 'fechamento-whatsapp', steps: [{ type: 'TEXT', content: 'A nossa chave PIX é…' }] })) };
    const tool = new SendFlowMessagesTool(prisma, playbooks, {} as any, {} as any);
    const sent = jest.spyOn(tool, 'sendSteps').mockResolvedValue({ output: { ok: true } } as any);
    return { tool, sent };
  };
  const ctx = { organizationId: 'o', conversationId: 'c', agentId: 'a' } as any;
  const quote = { direction: 'OUTBOUND', text: '*Preço por chip:* USD 51.00 / R$ 283.56' };

  it('"Achei por 200" depois da cotação (caso da Gi): não manda o PIX, manda escalar', async () => {
    // Mais nova primeiro.
    const { tool, sent } = setup([{ direction: 'INBOUND', text: 'iguale sim, por favor' }, { direction: 'INBOUND', text: 'Achei por 200' }, quote]);
    const res = await tool.execute({ fluxo: 'fechamento-whatsapp' }, ctx);
    expect(sent).not.toHaveBeenCalled();
    expect(res.output).toMatchObject({ ok: false, cobrir_concorrencia: true });
  });

  it('sem pedido de cobrir preço depois da cotação: manda', async () => {
    const { tool, sent } = setup([{ direction: 'INBOUND', text: 'quero fechar pelo whatsapp' }, quote, { direction: 'INBOUND', text: 'Achei por 200' }]);
    await tool.execute({ fluxo: 'fechamento-whatsapp' }, ctx);
    expect(sent).toHaveBeenCalled();
  });
});
