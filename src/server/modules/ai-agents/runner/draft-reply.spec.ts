import { AiAgentRunnerService } from './agent-runner.service';

describe('Sugerir resposta (modo sugestão)', () => {
  const setup = (llmResponses: any[]) => {
    const svc: any = Object.create(AiAgentRunnerService.prototype);
    const executed: string[] = [];
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.prisma = {
      conversation: { findUniqueOrThrow: jest.fn(async () => ({ id: 'c', organizationId: 'o', channelId: 'ch', contactId: 'ct', metadata: null })) },
      organization: { findUniqueOrThrow: jest.fn(async () => ({ id: 'o' })) },
      channel: { findUniqueOrThrow: jest.fn(async () => ({ id: 'ch', type: 'WHATSAPP_ZAPPFY' })) },
      contact: { findUniqueOrThrow: jest.fn(async () => ({ id: 'ct' })) },
      message: { findMany: jest.fn(async () => [{ id: 'm1', direction: 'INBOUND', content: { text: 'qual o status do pedido 142727?' } }]) },
      aiAgentMemory: { findUnique: jest.fn(async () => null) },
    };
    svc.catalogSync = { getCompactCatalog: jest.fn(async () => null) };
    svc.playbooks = { forAgent: jest.fn(async () => []) };
    svc.mediaUrlResolver = { resolveMany: jest.fn(async () => new Map()) };
    svc.promptBuilder = { buildMessages: jest.fn(() => [{ role: 'system', content: 'prompt' }]) };
    svc.resolveAgent = jest.fn(async () => ({ id: 'a', name: 'Assistente', modelId: 'm', temperature: 0, maxTokens: 500, modelParams: {}, kind: 'WORKER' }));
    svc.resolveToolsAndSkills = jest.fn(async () => ({
      llmTools: [{ name: 'consultar_pedido' }, { name: 'replyToConversation' }, { name: 'escalar_para_humano' }],
    }));
    svc.registry = { get: (name: string) => ({ execute: async () => { executed.push(name); return { output: { ok: true } }; } }) };
    const llm: jest.Mock<any, any[]> = jest.fn(async (_req: any) => llmResponses.shift());
    svc.llm = { complete: llm };
    return { svc, executed, llm };
  };

  it('consulta pedido e devolve o texto, sem enviar nem transferir', async () => {
    const { svc, executed, llm } = setup([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: '1', name: 'consultar_pedido', arguments: { orderId: '142727' } },
            { id: '2', name: 'escalar_para_humano', arguments: { reason: 'x' } },
          ],
        },
      },
      { message: { role: 'assistant', content: 'O seu pedido 142727 está ativo — de 27/10 a 12/11.' } },
    ]);
    const res = await svc.draftReply('c', { extraInfo: 'cliente já pagou' });
    expect(executed).toEqual(['consultar_pedido']);
    expect(res.text).toBe('O seu pedido 142727 está ativo, de 27/10 a 12/11.');
    // Só ferramentas de consulta vão para a IA.
    expect((llm.mock.calls[0] as any[])[0].tools.map((t: any) => t.name)).toEqual(['consultar_pedido']);
    // A orientação do atendente entra no pedido à IA.
    expect(JSON.stringify((llm.mock.calls[0] as any[])[0].messages)).toContain('cliente já pagou');
  });

  it('sem histórico exige a orientação do atendente', async () => {
    const { svc } = setup([]);
    await expect(svc.draftReply('c', { useHistory: false })).rejects.toThrow('Escreva o que a mensagem deve dizer');
  });
});
