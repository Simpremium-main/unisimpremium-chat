import { AddInternalNoteTool } from './add-internal-note.tool';

describe('AddInternalNoteTool', () => {
  const ctx = { conversationId: 'c1', agentId: 'a1', triggerMessageId: 'm1' } as any;

  it('grava a nota assinada pelo agente', async () => {
    const writer = { write: jest.fn().mockResolvedValue({ id: 'n1' }) };
    const res = await new AddInternalNoteTool(writer as any).execute({ content: 'Cliente viaja dia 25/10' }, ctx);
    expect(writer.write).toHaveBeenCalledWith({
      conversationId: 'c1',
      agentId: 'a1',
      content: 'Cliente viaja dia 25/10',
      messageId: null,
    });
    expect(res.output).toMatchObject({ ok: true, noteId: 'n1' });
  });

  it('prende à mensagem do cliente quando pedido', async () => {
    const writer = { write: jest.fn().mockResolvedValue({ id: 'n1' }) };
    await new AddInternalNoteTool(writer as any).execute({ content: 'abc', aboutLastCustomerMessage: true }, ctx);
    expect(writer.write.mock.calls[0][0].messageId).toBe('m1');
  });

  it('recusa nota vazia', async () => {
    const writer = { write: jest.fn() };
    const res = await new AddInternalNoteTool(writer as any).execute({ content: ' ' }, ctx);
    expect(res.output).toMatchObject({ ok: false });
    expect(writer.write).not.toHaveBeenCalled();
  });
});
