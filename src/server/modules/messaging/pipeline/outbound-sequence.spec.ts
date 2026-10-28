import { OutboundMessageProcessor, OUTBOUND_JOB_OPTS } from './outbound-message.processor';

/** Sequências (fluxo, cotação em 2 partes): uma mensagem por vez, na ordem, sem "digitando...". */
function setup(sendImpl?: () => Promise<unknown>) {
  const sent: string[] = [];
  const adapter = {
    sendMessage: jest.fn(async (_c: unknown, _to: string, msg: any) => {
      if (sendImpl) await sendImpl();
      sent.push(msg.content.text);
      return { externalId: `ext-${sent.length}` };
    }),
    sendTypingIndicator: jest.fn(async () => undefined),
  };
  const prisma = {
    channel: { findUniqueOrThrow: jest.fn(async () => ({ id: 'ch', type: 'WHATSAPP_ZAPPFY' })) },
    message: {
      findUnique: jest.fn(async () => ({ metadata: { aiAgentId: 'ag' }, conversationId: 'conv' })),
      update: jest.fn(async ({ where }: any) => ({ id: where.id, conversationId: 'conv' })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  const queue = { add: jest.fn(async () => undefined) };
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() };
  const processor = new OutboundMessageProcessor(
    prisma as any,
    { getOutbound: () => adapter } as any,
    realtime as any,
    { markProcessed: jest.fn(async () => undefined) } as any,
    queue as any,
  );
  return { processor, adapter, prisma, queue, sent };
}

const text = (t: string) => ({ type: 'TEXT', content: { text: t } }) as any;

describe('OutboundMessageProcessor — sequências', () => {
  it('envia a atual sem digitar e só então enfileira a próxima com o resto', async () => {
    const { processor, adapter, queue, sent } = setup();
    const job: any = {
      attemptsMade: 0,
      opts: OUTBOUND_JOB_OPTS,
      data: {
        messageId: 'm1',
        channelId: 'ch',
        contactExternalId: '55119',
        message: text('cotação'),
        skipTyping: true,
        then: [
          { messageId: 'm2', message: text('quer finalizar?') },
          { messageId: 'm3', message: text('terceira') },
        ],
      },
    };
    await processor.process(job);
    expect(sent).toEqual(['cotação']);
    expect(adapter.sendTypingIndicator).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'send-outbound',
      expect.objectContaining({
        messageId: 'm2',
        message: text('quer finalizar?'),
        skipTyping: true,
        then: [{ messageId: 'm3', message: text('terceira') }],
        contactExternalId: '55119',
      }),
      OUTBOUND_JOB_OPTS,
    );
  });

  it('última da sequência não enfileira nada', async () => {
    const { processor, queue } = setup();
    await processor.process({
      attemptsMade: 0,
      opts: OUTBOUND_JOB_OPTS,
      data: { messageId: 'm3', channelId: 'ch', contactExternalId: '1', message: text('fim'), skipTyping: true, then: [] },
    } as any);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('falha definitiva: as seguintes viram FAILED em vez de ficarem na fila', async () => {
    const { processor, prisma, queue } = setup(async () => {
      throw new Error('provider down');
    });
    const job: any = {
      attemptsMade: OUTBOUND_JOB_OPTS.attempts - 1,
      opts: OUTBOUND_JOB_OPTS,
      data: {
        messageId: 'm1',
        channelId: 'ch',
        contactExternalId: '1',
        message: text('a'),
        skipTyping: true,
        then: [{ messageId: 'm2', message: text('b') }],
      },
    };
    await expect(processor.process(job)).rejects.toThrow('provider down');
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['m2'] } } }),
    );
  });

  it('falha com tentativas sobrando: não mexe nas seguintes (o retry continua a cadeia)', async () => {
    const { processor, prisma } = setup(async () => {
      throw new Error('timeout');
    });
    await expect(
      processor.process({
        attemptsMade: 0,
        opts: OUTBOUND_JOB_OPTS,
        data: { messageId: 'm1', channelId: 'ch', contactExternalId: '1', message: text('a'), skipTyping: true, then: [{ messageId: 'm2', message: text('b') }] },
      } as any),
    ).rejects.toThrow('timeout');
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
  });
});
