import { OutboundMessageProcessor, OUTBOUND_JOB_OPTS } from './outbound-message.processor';

describe('envio com espera (bloco do robô com "Aguardar")', () => {
  function setup() {
    const adapter: any = {
      sendTypingIndicator: jest.fn(async () => undefined),
      sendMessage: jest.fn(async () => ({ externalId: 'ext1', providerResponse: {} })),
    };
    const prisma: any = {
      channel: { findUniqueOrThrow: jest.fn(async () => ({ id: 'ch1', type: 'WHATSAPP_ZAPPFY' })) },
      message: {
        findUnique: jest.fn(async () => ({ metadata: {} })),
        update: jest.fn(async () => ({ id: 'm1', conversationId: 'c1' })),
      },
    };
    const registry: any = { getOutbound: () => adapter };
    const realtime: any = { emitToConversation: jest.fn(), emitToChannel: jest.fn() };
    const idempotency: any = { markProcessed: jest.fn(async () => undefined) };
    const queue: any = { add: jest.fn(async () => ({})) };
    const proc = new OutboundMessageProcessor(prisma, registry, realtime, idempotency, queue);
    return { proc, adapter, queue };
  }
  const base = {
    messageId: 'm1',
    channelId: 'ch1',
    contactExternalId: '5511@s.whatsapp.net',
    message: { type: 'IMAGE', content: { mediaUrl: 'https://x' } } as any,
    skipTyping: true,
  };

  it('mostra "digitando..." e volta pra fila atrasada, sem enviar ainda', async () => {
    const { proc, adapter, queue } = setup();
    await proc.process({ data: { ...base, delayMs: 3000 } } as any);
    expect(adapter.sendTypingIndicator).toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'send-outbound',
      expect.objectContaining({ messageId: 'm1', delayMs: undefined }),
      { ...OUTBOUND_JOB_OPTS, delay: 3000 },
    );
  });

  it('na sequência, a próxima leva a própria espera (e não herda a anterior)', async () => {
    const { proc, adapter, queue } = setup();
    await proc.process({
      data: { ...base, then: [{ messageId: 'm2', message: base.message, delayMs: 2000 }, { messageId: 'm3', message: base.message }] },
    } as any);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
    const [, next] = queue.add.mock.calls[0];
    expect(next).toMatchObject({ messageId: 'm2', delayMs: 2000, then: [{ messageId: 'm3' }] });
  });
});
