import { ChatbotEngineService, endHandoff } from './chatbot-engine.service';
import { MenuNodeExecutor } from './node-executors/menu-node.executor';
import { MessageNodeExecutor, buildMessageNodeMessages, MAX_IMAGE_CAPTION, messageDelayMs } from './node-executors/message-node.executor';
import { TransferNodeExecutor } from './node-executors/transfer-node.executor';
import { buildMenuContent, toChannelMessage, toChannelMessages } from './chatbot-message';
import { PromptBuilderService, renderChatbotHandoff } from '../../ai-agents/runner/prompt-builder.service';
import { ZappfyMessageMapper } from '../../channel-hub/adapters/zappfy/zappfy.message-mapper';
import { WhatsAppOfficialMessageMapper } from '../../channel-hub/adapters/whatsapp-official/whatsapp-official.message-mapper';

const node = (id: string, type: string, data: Record<string, any>, edges: any[] = []) => ({ id, type, data, edges });

/** Fluxo: Início → Menu (Cotação / Pedido) → Cotação: Fim→IA · Pedido: Transferir. */
function flow(endData: Record<string, any> = { handoff: 'AI' }) {
  return {
    id: 'f1',
    name: 'Atendimento inicial',
    nodes: [
      node('start', 'START', {}, [{ targetNodeId: 'menu' }]),
      node(
        'menu',
        'MENU',
        { title: 'Como posso ajudar?', options: [{ label: 'Cotação', value: 'cot' }, { label: 'Meu pedido', value: 'ped' }] },
        [{ targetNodeId: 'end', condition: 'cot' }, { targetNodeId: 'transfer', condition: 'ped' }],
      ),
      node('end', 'END_FLOW', endData),
      node('transfer', 'TRANSFER', { message: 'Vou te passar para um atendente.' }),
    ],
  };
}

function engine(f = flow()) {
  let session: any = null;
  const sessions: any = {
    get: jest.fn(async () => session),
    create: jest.fn(async (conversationId: string, flowId: string, nodeId: string) => {
      session = { conversationId, flowId, currentNodeId: nodeId, variables: {}, waitingForInput: false };
      return session;
    }),
    update: jest.fn(async (_c: string, patch: any) => (session = { ...session, ...patch })),
    destroy: jest.fn(async () => (session = null)),
  };
  const flows: any = { findActiveFlowForChannel: jest.fn(async () => f), findById: jest.fn(async () => f) };
  const msg = new MessageNodeExecutor();
  const e = new ChatbotEngineService(sessions, flows, msg, new MenuNodeExecutor(), {} as any, {} as any, new TransferNodeExecutor());
  return { e, sessions };
}

describe('robô: fim do fluxo diz pra onde vai', () => {
  it('primeira mensagem manda o menu e espera', async () => {
    const { e } = engine();
    const r = await e.processMessage('c1', 'ch1', '55119', 'oi');
    expect(r.sessionEnded).toBe(false);
    expect(r.handoff).toBeNull();
    expect(r.messages[0].type).toBe('INTERACTIVE');
    expect(r.messages[0].content.interactive.options.map((o: any) => o.title)).toEqual(['Cotação', 'Meu pedido']);
  });

  it('opção que leva ao Fim → IA', async () => {
    const { e } = engine();
    await e.processMessage('c1', 'ch1', '55119', 'oi');
    const r = await e.processMessage('c1', 'ch1', '55119', 'cot'); // id do botão
    expect(r).toMatchObject({ sessionEnded: true, handoff: 'AI', flowId: 'f1' });
  });

  it('Transferir → humano; resposta pelo número também vale', async () => {
    const { e } = engine();
    await e.processMessage('c1', 'ch1', '55119', 'oi');
    const r = await e.processMessage('c1', 'ch1', '55119', '2');
    expect(r).toMatchObject({ sessionEnded: true, handoff: 'HUMAN', transferToHuman: true });
  });

  it('Fim sem destino (fluxo antigo) vai pro humano; mensagem final é enviada', async () => {
    const { e } = engine(flow({ message: 'Obrigado!' }));
    await e.processMessage('c1', 'ch1', '55119', 'oi');
    const r = await e.processMessage('c1', 'ch1', '55119', 'Cotação');
    expect(r.handoff).toBe('HUMAN');
    expect(r.messages).toEqual([{ type: 'TEXT', content: { text: 'Obrigado!' } }]);
    expect(endHandoff({ handoff: 'AI' })).toBe('AI');
  });

  it('canal sem fluxo: robô não se aplica', async () => {
    const { e } = engine();
    (e as any).flowsRepo.findActiveFlowForChannel.mockResolvedValueOnce(null);
    const r = await e.processMessage('c9', 'ch1', '55119', 'oi');
    expect(r.notApplicable).toBe(true);
  });
});

describe('menu por canal', () => {
  const opts = [{ label: 'Cotação', value: 'cot' }, { label: 'Meu pedido', value: 'ped' }];

  it('até 3 opções curtas = botões; mais = lista', () => {
    expect(buildMenuContent('Oi', opts).interactive.kind).toBe('buttons');
    const many = Array.from({ length: 5 }, (_, i) => ({ label: `Opção ${i + 1}`, value: `o${i}` }));
    expect(buildMenuContent('Oi', many).interactive.kind).toBe('list');
    expect(buildMenuContent('Oi', [{ label: 'Uma opção com nome comprido demais', value: 'x' }]).interactive.kind).toBe('list');
  });

  it('Instagram/Gmail e mais de 10 opções recebem texto numerado', () => {
    const msg = { type: 'INTERACTIVE', content: buildMenuContent('Como posso ajudar?', opts) as any };
    expect(toChannelMessage(msg, 'INSTAGRAM' as any)).toEqual({
      type: 'TEXT',
      content: { text: 'Como posso ajudar?\n\n1. Cotação\n2. Meu pedido' },
    });
    expect(toChannelMessage(msg, 'WHATSAPP_ZAPPFY' as any).type).toBe('INTERACTIVE');
    const eleven = Array.from({ length: 11 }, (_, i) => ({ label: `O${i}`, value: `o${i}` }));
    expect(toChannelMessage({ type: 'INTERACTIVE', content: buildMenuContent('x', eleven) as any }, 'WHATSAPP_OFFICIAL' as any).type).toBe('TEXT');
  });
});

describe('provedores', () => {
  const menu = (o: any[], kind: 'buttons' | 'list') => ({
    type: 'INTERACTIVE' as any,
    content: { text: 'Como posso ajudar?', fallbackText: '1. a', interactive: { kind, options: o, listButton: 'Ver opções' } },
  });

  it('Zappfy: POST /send/menu com "texto|id"', () => {
    const r = new ZappfyMessageMapper().denormalize(menu([{ id: 'cot', title: 'Cotação' }, { id: 'ped', title: 'Meu|pedido' }], 'buttons'), '5511999@s.whatsapp.net');
    expect(r).toEqual({
      endpoint: '/send/menu',
      payload: { number: '5511999', type: 'button', text: 'Como posso ajudar?', choices: ['Cotação|cot', 'Meu pedido|ped'] },
    });
  });

  it('Zappfy: resposta de botão vira texto + id da opção', () => {
    const m = new ZappfyMessageMapper().normalizeInbound({
      message: {
        chatid: '5511999@s.whatsapp.net',
        messageid: 'm1',
        fromMe: false,
        messageType: 'ButtonsResponseMessage',
        text: 'Cotação',
        buttonOrListid: 'cot',
        content: {},
        messageTimestamp: Date.now(),
      },
    } as any);
    expect(m?.content).toMatchObject({ text: 'Cotação', interactive: { type: 'button', buttonId: 'cot' } });
  });

  it('Oficial: botões de resposta e lista com limites da Meta', () => {
    const mapper = new WhatsAppOfficialMessageMapper();
    const b: any = mapper.denormalize(menu([{ id: 'cot', title: 'Cotação de chip internacional' }], 'buttons'), '5511999');
    expect(b.interactive.type).toBe('button');
    expect(b.interactive.action.buttons[0].reply).toEqual({ id: 'cot', title: 'Cotação de chip inte' });
    const l: any = mapper.denormalize(
      menu(Array.from({ length: 4 }, (_, i) => ({ id: `o${i}`, title: `Opção número ${i} com texto longo` })), 'list'),
      '5511999',
    );
    expect(l.interactive.type).toBe('list');
    expect(l.interactive.action.button).toBe('Ver opções');
    expect(l.interactive.action.sections[0].rows[0].title.length).toBeLessThanOrEqual(24);
  });
});

describe('IA depois do robô', () => {
  it('fim do fluxo devolve o nome do fluxo e as escolhas do cliente', async () => {
    const { e } = engine();
    await e.processMessage('c1', 'ch1', '55119', 'oi');
    const r = await e.processMessage('c1', 'ch1', '55119', 'cot');
    expect(r.flowName).toBe('Atendimento inicial');
    expect(r.choices).toEqual([{ question: 'Como posso ajudar?', answer: 'Cotação' }]);
  });

  it('prompt da IA conta qual fluxo rodou e o que o cliente escolheu', () => {
    const text = renderChatbotHandoff({
      chatbot: {
        flowId: 'f1',
        completedAt: new Date().toISOString(),
        handoff: 'AI',
        reason: 'flow',
        flowName: 'Atendimento inicial',
        choices: [{ question: 'Como posso\najudar?', answer: 'Cotação' }],
      },
    });
    expect(text).toContain('fluxo "Atendimento inicial"');
    expect(text).toContain('Como posso ajudar? → Cotação');
    // Fluxo que foi pro humano, ou conversa sem robô: nada no prompt.
    expect(renderChatbotHandoff({ chatbot: { completedAt: 'x', handoff: 'HUMAN', reason: 'flow' } })).toBe('');
    expect(renderChatbotHandoff(null)).toBe('');
  });

  it('mensagens do robô chegam marcadas pra IA', () => {
    const pb = new PromptBuilderService() as any;
    const robo = { direction: 'OUTBOUND', type: 'INTERACTIVE', metadata: { chatbotFlowId: 'f1' }, content: { text: 'Menu', fallbackText: 'Menu\n\n1. Cotação' } };
    const ia = { direction: 'OUTBOUND', type: 'TEXT', metadata: {}, content: { text: 'Oi!' } };
    expect(pb.extractText(robo)).toBe('[robô de atendimento] Menu\n\n1. Cotação');
    expect(pb.extractText(ia)).toBe('Oi!');
  });
});

describe('robô acionado à mão', () => {
  it('roda o fluxo escolhido mesmo sem fluxo ativo no canal', async () => {
    const { e } = engine();
    (e as any).flowsRepo.findActiveFlowForChannel = jest.fn(async () => null);
    const r = await e.processMessage('c1', 'ch1', '55119', '', 'f1');
    expect(r.notApplicable).toBeUndefined();
    expect(r.messages[0].type).toBe('INTERACTIVE');
    expect((e as any).flowsRepo.findById).toHaveBeenCalledWith('f1');
  });
});

describe('nó Mensagem com imagem', () => {
  const image = { url: 'https://cdn/x.png', mimeType: 'image/png', fileName: 'x.png', size: 10 };

  it('sem imagem: só texto (como antes)', () => {
    expect(buildMessageNodeMessages('Oi', undefined)).toEqual([{ type: 'TEXT', content: { text: 'Oi' } }]);
    expect(buildMessageNodeMessages('Oi', { url: '  ' })).toEqual([{ type: 'TEXT', content: { text: 'Oi' } }]);
  });

  it('texto vai como legenda; sem texto, só a imagem', () => {
    expect(buildMessageNodeMessages('Tabela de preços', image)).toEqual([
      {
        type: 'IMAGE',
        content: { mediaUrl: 'https://cdn/x.png', mimeType: 'image/png', fileName: 'x.png', fileSize: 10, caption: 'Tabela de preços' },
      },
    ]);
    const [only, ...rest] = buildMessageNodeMessages('', { url: 'https://cdn/y.jpg' });
    expect(rest).toEqual([]);
    expect(only).toEqual({ type: 'IMAGE', content: { mediaUrl: 'https://cdn/y.jpg', mimeType: 'image/jpeg' } });
  });

  it('texto maior que a legenda permite sai depois da imagem', () => {
    const long = 'a'.repeat(MAX_IMAGE_CAPTION + 1);
    const out = buildMessageNodeMessages(long, image);
    expect(out.map((m) => m.type)).toEqual(['IMAGE', 'TEXT']);
    expect(out[0].content.caption).toBeUndefined();
    expect(out[1].content.text).toBe(long);
  });

  it('executor interpola variáveis na legenda', async () => {
    const r = await new MessageNodeExecutor().execute({
      session: { variables: { nome: 'Ana' } } as any,
      nodeData: { message: 'Oi {{nome}}', image },
      nodeEdges: [{ targetNodeId: 'n2' }],
      conversationId: 'c',
      channelId: 'ch',
      contactExternalId: 'x',
    });
    expect(r.nextNodeId).toBe('n2');
    expect(r.sendMessages[0].content.caption).toBe('Oi Ana');
  });

  it('Instagram (sem legenda): imagem e depois o texto; WhatsApp mantém a legenda', () => {
    const [msg] = buildMessageNodeMessages('Tabela', image);
    expect(toChannelMessages(msg, 'INSTAGRAM' as any)).toEqual([
      { type: 'IMAGE', content: { mediaUrl: 'https://cdn/x.png', mimeType: 'image/png', fileName: 'x.png', fileSize: 10 } },
      { type: 'TEXT', content: { text: 'Tabela' } },
    ]);
    expect(toChannelMessages(msg, 'WHATSAPP_OFFICIAL' as any)).toEqual([msg]);
  });

  it('Zappfy: legenda da imagem vai em `text` (campo que a uazapi lê)', () => {
    const [msg] = buildMessageNodeMessages('Tabela de preços', image);
    const r = new ZappfyMessageMapper().denormalize(msg as any, '5511999@s.whatsapp.net');
    expect(r.endpoint).toBe('/send/media');
    expect(r.payload).toMatchObject({ number: '5511999', type: 'image', file: 'https://cdn/x.png', text: 'Tabela de preços' });
  });
});

describe('bloco Mensagem: aguardar antes de enviar', () => {
  const ctx = (nodeData: Record<string, any>) => ({
    session: { variables: {} } as any,
    nodeData,
    nodeEdges: [],
    conversationId: 'c',
    channelId: 'ch',
    contactExternalId: 'x',
  });

  it('segundos viram delayMs na primeira mensagem do bloco (máx. 15s)', async () => {
    const r = await new MessageNodeExecutor().execute(ctx({ message: 'Oi', delaySeconds: 3 }));
    expect(r.sendMessages).toEqual([{ type: 'TEXT', content: { text: 'Oi' }, delayMs: 3000 }]);
    expect(messageDelayMs(99)).toBe(15_000);
    expect(messageDelayMs(undefined)).toBe(0);
    expect(messageDelayMs('-2')).toBe(0);
    const none = await new MessageNodeExecutor().execute(ctx({ message: 'Oi' }));
    expect(none.sendMessages[0]).not.toHaveProperty('delayMs');
  });

  it('a espera fica na primeira mensagem quando o canal desdobra (Instagram)', () => {
    const [img] = buildMessageNodeMessages('Tabela', { url: 'https://cdn/x.png' });
    const out = toChannelMessages({ ...img, delayMs: 2000 }, 'INSTAGRAM' as any);
    expect(out.map((m) => m.delayMs)).toEqual([2000, undefined]);
    expect(toChannelMessages({ ...img, delayMs: 2000 }, 'WHATSAPP_ZAPPFY' as any)[0].delayMs).toBe(2000);
  });
});
