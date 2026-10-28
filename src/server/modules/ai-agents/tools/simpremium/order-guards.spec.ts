const store = new Map<string, string>();
jest.mock('../../../../runtime/kv-store', () => ({
  KvStore: jest.fn().mockImplementation(() => ({
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => (store.set(k, v), true)),
  })),
}));
import { checkOrderAccess, identityClaims, markVerified, verifiedOrders } from './order-access';
import { deviceInformed } from './device-check';

const order = (extra: Record<string, unknown> = {}) => ({
  id: 142611,
  status: 'e-sim-enviado',
  billing: { phone: '(21) 98888-7777', email: 'dono@exemplo.com', cpf: '123.456.789-00' },
  ...extra,
});

describe('pedido só aparece pro dono', () => {
  it('número de pedido de outro telefone: bloqueia e pede CPF/e-mail', () => {
    const r = checkOrderAccess({ orderId: '142611' }, [order()], '5511962852639');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.output)).toContain('pode me informar o e-mail ou telefone usado na compra');
    expect(JSON.stringify(r.output)).not.toContain('e-sim-enviado');
  });

  it('telefone da conversa igual ao do pedido: libera', () => {
    const r = checkOrderAccess({ orderId: '142611' }, [order()], '5521988887777');
    expect(r).toMatchObject({ ok: true, verifiedIds: ['142611', '142611'] });
  });

  it('CPF ou e-mail informado confere: libera; não confere: bloqueia sem dados', () => {
    expect(checkOrderAccess({ orderId: '142611', cpf: '12345678900' }, [order()], '5511962852639').ok).toBe(true);
    expect(checkOrderAccess({ orderId: '142611', email: 'DONO@exemplo.com' }, { orders: [order()] }, null).ok).toBe(true);
    const wrong = checkOrderAccess({ orderId: '142611', email: 'outro@x.com' }, [order()], '5511962852639');
    expect(wrong.ok).toBe(false);
    expect(JSON.stringify(wrong.output)).toContain('NÃO confere');
  });

  it('busca por CPF que traz vários pedidos: só os do CPF', () => {
    const r = checkOrderAccess(
      { cpf: '123.456.789-00' },
      { orders: [order(), order({ id: 9, billing: { cpf: '999.999.999-99' } })] },
      null,
    );
    expect(r).toMatchObject({ ok: true, output: { pedidos: [{ id: 142611 }] } });
  });

  it('pedido não encontrado passa (a IA diz que não achou)', () => {
    expect(checkOrderAccess({ orderId: '1' }, { success: true, data: [] }, null)).toMatchObject({ ok: true });
  });

  it('pedido confirmado fica marcado na conversa', async () => {
    await markVerified('conv1', ['142611', '#555']);
    expect([...(await verifiedOrders('conv1'))]).toEqual(['142611', '555']);
    expect((await verifiedOrders('conv2')).size).toBe(0);
  });
});

describe('formato real do Pedido Central (dados de cobrança soltos no pedido)', () => {
  const real = {
    source: 'main',
    orders: [{
      id: 142611, number: '142611', status: 'e-sim-enviado', total: 0, currency: 'USD',
      customer: 'Yasmin Duca Parceria @yasmin_duca', email: 'yasminduca@gmail.com',
      phone: '+55 (71) 98338-5063', cpf: '000.000.000-00', payment_method: 'Pagamento via WhatsApp - Reais',
    }],
  };

  it('outro WhatsApp sem dados: bloqueia', () => {
    expect(checkOrderAccess({ orderId: '142611' }, real, '5511962852639').ok).toBe(false);
  });
  it('e-mail de cobrança confere: libera; e-mail digitado errado: bloqueia', () => {
    expect(checkOrderAccess({ orderId: '142611', email: 'yasminduca@gmail.com' }, real, '5511962852639').ok).toBe(true);
    expect(checkOrderAccess({ orderId: '142611', email: 'yasminducaaaa@gmail.com' }, real, '5511962852639').ok).toBe(false);
  });
  it('telefone de cobrança igual ao WhatsApp: libera sem pedir nada', () => {
    expect(checkOrderAccess({ orderId: '142611' }, real, '5571983385063').ok).toBe(true);
  });
  it('CPF zerado do pedido não confere com nada (nem com 000…)', () => {
    expect(checkOrderAccess({ orderId: '142611', cpf: '000.000.000-00' }, real, null).ok).toBe(false);
    expect(checkOrderAccess({ orderId: '142611', cpf: '123.456.789-00' }, real, null).ok).toBe(false);
  });
  it('dados do cadastro do usuário (customer.*) não servem pra confirmar', () => {
    const accountOnly = [{ id: 7, customer: { email: 'conta@x.com', phone: '11962852639' } }];
    expect(checkOrderAccess({ orderId: '7', email: 'conta@x.com' }, accountOnly, '5511962852639').ok).toBe(false);
  });
});

describe('pedido 142570: cobrança diferente do perfil proprietário', () => {
  const order = {
    id: 142570, status: 'aguardando-envio',
    email: 'anandacavalheiro@hotmail.com', // perfil proprietário (conta)
    billing_email: 'leorbarbosa@gmail.com', billing_phone: '+55 (31) 99981-2985', cpf: '000.000.000-00',
  };
  it('e-mail de cobrança confere; e-mail da conta não', () => {
    expect(checkOrderAccess({ orderId: '142570', email: 'leorbarbosa@gmail.com' }, [order], '5511962852639').ok).toBe(true);
    expect(checkOrderAccess({ orderId: '142570', email: 'anandacavalheiro@hotmail.com' }, [order], '5511962852639').ok).toBe(false);
  });
  it('telefone de cobrança digitado pelo cliente confere', () => {
    expect(checkOrderAccess({ orderId: '142570', phone: '+55 (31) 99981-2985' }, [order], '5511962852639').ok).toBe(true);
    expect(checkOrderAccess({ orderId: '142570', phone: '(11) 96285-2639' }, [order], '5511962852639').ok).toBe(false);
  });
});

describe('dados que o cliente escreveu (a IA esqueceu de passar)', () => {
  const order = { id: 142570, email: 'leorbarbosa@gmail.com', phone: '+55 (31) 99981-2985', cpf: '000.000.000-00' };

  it('acha e-mail, telefone e CPF nas mensagens do cliente', () => {
    const c = identityClaims({ orderId: '142570' }, [
      'ola, Como esta o status do meu pedido por gentileza? 142570',
      'leorbarbosa@gmail.com',
      'meu cel é +55 (31) 99981-2985 e cpf 529.982.247-25',
    ]);
    expect(c.emails).toEqual(['leorbarbosa@gmail.com']);
    expect(c.phones).toContain('+55 (31) 99981-2985');
    expect(c.cpfs).toEqual(['529.982.247-25']);
    expect(c.phones.some((p) => p.includes('142570'))).toBe(false); // número do pedido não é telefone
  });

  it('conversa do 142570: cliente mandou o e-mail, IA chamou só com o orderId → libera', () => {
    const claims = identityClaims({ orderId: '142570' }, ['leorbarbosa@gmail.com']);
    expect(checkOrderAccess({ orderId: '142570' }, [order], '5511962852639', claims).ok).toBe(true);
  });

  it('e-mail escrito que não confere: bloqueia dizendo que não confere', () => {
    const claims = identityClaims({ orderId: '142570' }, ['outro@gmail.com']);
    const r = checkOrderAccess({ orderId: '142570' }, [order], '5511962852639', claims);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.output)).toContain('NÃO confere');
  });
});

describe('modelo do aparelho antes das instruções de roaming', () => {
  const asked = { direction: 'OUTBOUND', text: 'Qual o modelo do seu aparelho? Ex.: Iphone, Samsung, Motorola, Outros Modelos.' };

  it('cliente não disse o modelo: bloqueia (caso do pedido 142611)', () => {
    const history = [
      { direction: 'INBOUND', text: 'quero ajuda no pedido 142611, nao funciona' },
      { direction: 'OUTBOUND', text: 'Encontrei seu pedido 142611.' },
      { direction: 'INBOUND', text: 'nao esta funcionando' },
    ];
    expect(deviceInformed(history, 'iphone')).toEqual({ ok: false });
  });

  it('cliente citou a marca ou respondeu a pergunta do modelo: libera', () => {
    expect(deviceInformed([{ direction: 'INBOUND', text: 'tenho um iPhone 13' }], 'iphone')).toEqual({ ok: true });
    expect(deviceInformed([{ direction: 'INBOUND', text: 'é um galaxy s23' }], 'samsung')).toEqual({ ok: true });
    expect(deviceInformed([asked, { direction: 'INBOUND', text: '11 pro' }], 'iphone')).toEqual({ ok: true });
    expect(deviceInformed([asked, { direction: 'INBOUND', text: 'xiaomi' }], 'outros')).toEqual({ ok: true });
  });

  it('IA escolheu aparelho diferente do que o cliente disse', () => {
    expect(deviceInformed([{ direction: 'INBOUND', text: 'uso samsung' }], 'iphone')).toEqual({ ok: false, said: 'samsung' });
  });
});

describe('número do pedido errado + e-mail do cliente (Peter, 1411447)', () => {
  const found = {
    source: 'main',
    orders: [{ id: 141447, number: '141447', status: 'e-sim-enviado', email: 'thais_mancilha@hotmail.com', phone: '+55 (11) 90000-0000', cpf: '000.000.000-00' }],
  };
  const setup = (texts: string[]) => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const calls: Array<Record<string, unknown>> = [];
    const mcp = {
      call: jest.fn(async (_org: string, tool: string, q: Record<string, unknown>) => {
        // Só as buscas de pedido (a consulta de ativações confere o status).
        if (tool === 'consultar_ativacoes') return { activations: [] };
        calls.push(q);
        return q.orderId ? { source: 'main', orders: [] } : found;
      }),
    };
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ metadata: null })) },
      message: { findMany: jest.fn(async () => texts.map((t) => ({ content: { text: t } }))) },
    };
    const customerOrders = { conversationPhone: jest.fn(async () => '14075050924') };
    const svc = new SimpremiumToolsService(prisma, {}, mcp, {}, {}, {}, {}, {}, customerOrders);
    return { tool: svc.tools.find((t: any) => t.name === 'consultar_pedido'), calls };
  };
  const ctx = { organizationId: 'o', conversationId: 'peter' } as any;

  it('número não existe: busca pelo e-mail que o cliente mandou e acha o pedido', async () => {
    const { tool, calls } = setup(['thais_mancilha@hotmail.com', '1411447']);
    const res = await tool.execute({ orderId: '1411447' }, ctx);
    expect(calls).toEqual([{ orderId: '1411447' }, { email: 'thais_mancilha@hotmail.com' }]);
    expect(String(res.output)).toContain('o número 1411447 que o cliente informou NÃO existe');
    expect(String(res.output)).toContain('141447');
  });

  it('sem e-mail/CPF do cliente: não busca de novo e pede só o pedido (uma etapa por vez)', async () => {
    const { tool, calls } = setup(['1411447']);
    const res = await tool.execute({ orderId: '1411447' }, ctx);
    expect(calls).toEqual([{ orderId: '1411447' }]);
    expect(res.output).toMatchObject({ ok: false, pedido_nao_encontrado: '1411447' });
    expect(res.output.instrucao).toContain('NÃO pergunte ainda sobre o problema');
  });

  it('número escrito junto com texto ("Peddio142458") vira só o número', async () => {
    const { tool, calls } = setup(['Peddio142458']);
    await tool.execute({ orderId: 'Peddio142458' }, ctx);
    expect(calls[0]).toEqual({ orderId: '142458' });
  });
});

describe('aviso ao cliente na transferência', () => {
  const setup = (recentOutbound: string[]) => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({ metadata: null })),
        update: jest.fn(async () => ({ status: 'OPEN' })),
      },
      message: { findMany: jest.fn(async () => recentOutbound.map((t) => ({ content: { text: t } }))) },
      aiHelpRequest: { create: jest.fn(async () => ({})) },
    };
    const flows = { sendSteps: jest.fn(async () => ({ output: { ok: true } })) };
    const notes = { tryWrite: jest.fn(async () => undefined) };
    const tag = { execute: jest.fn(async () => ({ output: { ok: true } })) };
    const realtime = { emitToConversation: jest.fn() };
    const svc = new SimpremiumToolsService(prisma, realtime, {}, tag, flows, {}, {}, notes, {});
    return { tool: (n: string) => svc.tools.find((t: any) => t.name === n), flows };
  };
  const ctx = { organizationId: 'o', conversationId: 'c', agentId: 'a' } as any;
  const sentText = (flows: any) => flows.sendSteps.mock.calls[0][0].steps[0].content;

  it('escalar: avisa o setor responsável com o motivo para o cliente', async () => {
    const { tool, flows } = setup([]);
    const res = await tool('escalar_para_humano').execute(
      { reason: 'Pedido 141144 — eSIM não recebido', department: 'suporte', motivo_cliente: 'reenviar o e-mail do seu eSIM.' },
      ctx,
    );
    expect(sentText(flows)).toBe(
      'Vou transferir seu atendimento para o setor responsável para reenviar o e-mail do seu eSIM. Em instantes um atendente continua por aqui. 🙏',
    );
    expect(res.finalAction).toBe('TRANSFERRED_TO_HUMAN');
  });

  it('IA já avisou que ia encaminhar: não repete', async () => {
    const { tool, flows } = setup(['Certo, vou te encaminhar para a equipe de suporte.']);
    await tool('escalar_para_humano').execute({ reason: 'x', motivo_cliente: 'y' }, ctx);
    expect(flows.sendSteps).not.toHaveBeenCalled();
  });

  it('pedir_ajuda: avisa que vai verificar com a equipe', async () => {
    const { tool, flows } = setup([]);
    await tool('pedir_ajuda').execute({ problema: 'até que horas?' }, ctx);
    expect(sentText(flows)).toContain('verificar essa informação com a equipe');
  });
});

describe('instruções de roaming por fabricante', () => {
  const setup = (existing: string[], alreadySent = false) => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ metadata: null })) },
      aiToolCall: {
        findFirst: jest.fn(async () => (alreadySent ? { id: 'x' } : null)),
        findMany: jest.fn(async () => []),
      },
      message: {
        findMany: jest.fn(async () => [
          { direction: 'INBOUND', content: { text: 'meu celular é samsung s23' }, metadata: null },
        ]),
      },
    };
    const playbooks = {
      findBySlug: jest.fn(async (_o: string, _a: string, slug: string) =>
        existing.includes(slug) ? { slug, steps: [{ type: 'TEXT', content: slug }] } : null,
      ),
    };
    const flows = { sendSteps: jest.fn(async (flow: any) => ({ output: { ok: true, fluxo: flow.slug } })) };
    const svc = new SimpremiumToolsService(prisma, {}, {}, {}, flows, playbooks, {}, {}, {});
    return { tool: svc.tools.find((t: any) => t.name === 'enviar_instrucoes_roaming'), flows };
  };
  const ctx = { organizationId: 'o', conversationId: 'c', agentId: 'a' } as any;
  const all = [
    'instrucoes-configuracoes-iphone',
    'instrucoes-de-escolha-do-chip-e-roaming-para-samsung',
    'instrucoes-de-escolha-do-chip-e-roaming-para-motorola',
    'instrucoes-de-escolha-do-chip-e-roaming-para-outros',
  ];

  it('Samsung: envia o fluxo da Samsung', async () => {
    const { tool, flows } = setup(all);
    await tool.execute({ device: 'samsung' }, ctx);
    expect(flows.sendSteps.mock.calls[0][0].slug).toBe('instrucoes-de-escolha-do-chip-e-roaming-para-samsung');
  });

  it('fluxo do fabricante não cadastrado: usa o de "Outros"', async () => {
    const { tool, flows } = setup(['instrucoes-de-escolha-do-chip-e-roaming-para-outros']);
    await tool.execute({ device: 'samsung' }, ctx);
    expect(flows.sendSteps.mock.calls[0][0].slug).toBe('instrucoes-de-escolha-do-chip-e-roaming-para-outros');
  });

  it('já enviado nesta conversa: não reenvia', async () => {
    const { tool, flows } = setup(all, true);
    const res = await tool.execute({ device: 'samsung' }, ctx);
    expect(flows.sendSteps).not.toHaveBeenCalled();
    expect(res.output).toMatchObject({ ok: false, jaEnviado: true });
  });

  it('nenhum dos novos: cai no fluxo antigo instrucoes-roaming', async () => {
    const { tool, flows } = setup(['instrucoes-roaming']);
    await tool.execute({ device: 'samsung' }, ctx);
    expect(flows.sendSteps.mock.calls[0][0].slug).toBe('instrucoes-roaming');
  });
});

describe('cotação no idioma do cliente', () => {
  const quote = 'TEMPLATE_PRONTO — REGRAS: copie.\n\nSegue valor do plano com *15% de desconto*.\n*Preço por chip:* USD 34.85 / R$ 175.57';
  const setup = (lang: 'pt' | 'en') => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const translator = {
      languageOf: jest.fn(async () => lang),
      translate: jest.fn(async (texts: string[]) => texts.map(() => 'Here is the plan price with *15% off*.\n*Price per SIM:* USD 34.85 / R$ 175.57')),
    };
    const svc = new SimpremiumToolsService({}, {}, {}, {}, {}, {}, {}, {}, {}, translator);
    return { svc, translator };
  };
  const ctx = { organizationId: 'o', conversationId: 'c', agentId: 'a' } as any;

  it('cliente em inglês: corpo traduzido, regras mantidas', async () => {
    const { svc } = setup('en');
    const out = await svc.translateQuote(quote, ctx);
    expect(out.startsWith('TEMPLATE_PRONTO — REGRAS: copie.')).toBe(true);
    expect(out).toContain('*Price per SIM:* USD 34.85 / R$ 175.57');
    expect(out).not.toContain('Segue valor');
  });

  it('cliente em português: cotação intacta, sem tradução', async () => {
    const { svc, translator } = setup('pt');
    expect(await svc.translateQuote(quote, ctx)).toBe(quote);
    expect(translator.translate).not.toHaveBeenCalled();
  });
});

describe('planos com franquia só quando o cliente pede', () => {
  const { asksForOtherPlans } = require('./simpremium-tools.service');
  it('pedidos de outros planos', () => {
    for (const t of [
      'tem algum mais barato?',
      'não precisa ser ilimitado',
      'e os planos com franquia?',
      'quais são os outros planos?',
      'do you have something cheaper?',
      'what about the other plans?',
      'tienen algo más barato?',
    ]) expect([t, asksForOtherPlans(t)]).toEqual([t, true]);
  });
  it('nova cotação não é pedido de franquia (caso "now for europa 12 days")', () => {
    for (const t of ['now for europa 12 days', 'germany', 'quero o ilimitado', 'unlimited please', 'cotação para Itália 10 dias']) {
      expect([t, asksForOtherPlans(t)]).toEqual([t, false]);
    }
  });
});

describe('cliente cita o valor da observação da cotação', () => {
  const { asksForOtherPlans, lastObsPrice } = require('./quote-plans');
  const quotePt = 'Segue valor…\nObs.: Temos também planos com franquia de dados à partir de R$ 38.54';
  const quoteEn = 'Here is the plan price…\nNote: We also have plans with data allowance starting from R$ 38.54';

  it('acha o valor da observação em português e inglês', () => {
    expect(lastObsPrice(['Do you want to complete the purchase…', quoteEn])).toBe('38');
    expect(lastObsPrice([quotePt])).toBe('38');
    expect(lastObsPrice(['sem cotação'])).toBeNull();
  });
  it('"what is the 38 reais plan" (Peter) conta como pedido de outros planos', () => {
    expect(asksForOtherPlans('what is the 38 reais plan', '38')).toBe(true);
    expect(asksForOtherPlans('e esse de R$ 38,54?', '38')).toBe(true);
    expect(asksForOtherPlans('quero 2 chips, 15 dias', '38')).toBe(false);
    expect(asksForOtherPlans('meu pedido é 1438', '38')).toBe(false);
  });
});

describe('pedido de revenda (distribuidor/agência): confere pelo ICCID', () => {
  const resellerOrder = {
    source: 'distribuidor',
    orders: [{ id: 4808, number: '4808', status: 'e-sim-enviado', email: 'parceiros@caradochip.com.br', phone: '+55 (11) 98888-0000', cpf: '000.000.000-00' }],
  };
  const setup = (texts: string[]) => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const calls: string[] = [];
    const mcp = {
      call: jest.fn(async (_o: string, tool: string) => {
        calls.push(tool);
        if (tool === 'consultar_ativacoes') return { activations: [{ iccid: '8955170110290012345', start_date: '2026-10-20' }] };
        return { ...resellerOrder, orders: resellerOrder.orders.map((o) => ({ ...o, source: 'distribuidor' })) };
      }),
    };
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ metadata: null })) },
      message: { findMany: jest.fn(async () => texts.map((t) => ({ content: { text: t } }))) },
    };
    const customerOrders = { conversationPhone: jest.fn(async () => '14075050924') };
    const svc = new SimpremiumToolsService(prisma, {}, mcp, {}, {}, {}, {}, {}, customerOrders);
    return { tool: svc.tools.find((t: any) => t.name === 'consultar_pedido'), calls };
  };
  const ctx = { organizationId: 'o', conversationId: 'rev-' + Math.random(), agentId: 'a' } as any;

  it('sem ICCID: pede o número do chip, não e-mail/CPF; log mostra os dados de cobrança', async () => {
    const { tool } = setup(['4808']);
    const res = await tool.execute({ orderId: '4808' }, ctx);
    expect(res.output.pedido_de_revenda).toBe(true);
    expect(res.output.instrucao).toContain('ICCID');
    expect(res.output.instrucao).toContain('abaixo do QR Code');
    expect(res.audit.pedidos_encontrados[0]).toMatchObject({ pedido: '4808', revenda: true, email_cobranca: 'parceiros@caradochip.com.br' });
  });

  it('ICCID confere (com espaços, buscado nas ativações): libera', async () => {
    const { tool, calls } = setup(['4808', '8955 1701 1029 0012 345']);
    const res = await tool.execute({ orderId: '4808' }, { ...ctx, conversationId: 'rev-ok' });
    expect(calls).toContain('consultar_ativacoes');
    expect(String(res.output)).toContain('4808');
    expect(res.output.identidade_nao_confirmada).toBeUndefined();
  });

  it('IA manda só o ICCID (sem orderId): usa o pedido que pediu o ICCID (caso 2610278145844)', async () => {
    const conv = { ...ctx, conversationId: 'rev-only-iccid' };
    const first = setup(['2610278145844']);
    expect((await first.tool.execute({ orderId: '4808' }, conv)).output.pedido_de_revenda).toBe(true);
    const { tool, calls } = setup(['4808', '8955170110290012345']);
    const res = await tool.execute({ iccid: '8955170110290012345' }, conv);
    expect(calls).toContain('consultar_ativacoes');
    expect(res.output.identidade_nao_confirmada).toBeUndefined();
    expect(String(res.output)).toContain('4808');
  });

  it('ICCID que não confere: avisa que o número do chip não confere', async () => {
    const { tool } = setup(['4808', '8955170110290099999']);
    const res = await tool.execute({ orderId: '4808' }, { ...ctx, conversationId: 'rev-bad' });
    expect(res.output.instrucao).toContain('NÃO confere');
  });
});

describe('número exato do pedido (Pedido Central busca por "contém")', () => {
  const { exactOrderOnly } = require('./simpremium-tools.service');
  const resp = { source: 'main', orders: [{ id: 134808, number: '134808', email: 'x@y.com' }] };

  it('pediu 4808 e veio o 134808: trata como não encontrado', () => {
    expect(exactOrderOnly(resp, '4808')).toEqual({ source: 'main', orders: [], nao_encontrado: '4808' });
  });
  it('mistura de exato e parecido: fica só o exato', () => {
    const both = { source: 'main', orders: [...resp.orders, { id: 4808, number: '4808' }] };
    expect((exactOrderOnly(both, '4808') as any).orders.map((o: any) => o.number)).toEqual(['4808']);
  });
  it('número exato (com # ou não): resposta intacta', () => {
    const ok = { source: 'main', orders: [{ id: 142570, number: '#142570' }] };
    expect(exactOrderOnly(ok, '142570')).toBe(ok);
  });
});

describe('instruções de roaming só nos primeiros dias da ativação', () => {
  const { activationStartFrom, roamingTimingGuard } = require('./device-check');
  const out = '{"activations":[{"start_date":"2026-10-20","end_date":"2026-11-09"}]}';

  it('lê o início da ativação do retorno da consulta', () => {
    expect(activationStartFrom([out], '2026-10-26')).toBe('2026-10-20');
    expect(activationStartFrom(['{"start_date":"2026-11-01"}'], '2026-10-26')).toBeNull();
  });
  it('até 3 dias do início: envia', () => {
    expect(roamingTimingGuard('2026-10-23', '2026-10-26', undefined)).toBeNull();
  });
  it('depois de 3 dias: pergunta se é o primeiro dia de uso', () => {
    expect(roamingTimingGuard('2026-10-20', '2026-10-26', undefined)).toMatchObject({ ok: false, perguntar_uso: true });
  });
  it('primeiro dia de uso: envia', () => {
    expect(roamingTimingGuard('2026-10-20', '2026-10-26', 'primeiro_dia')).toBeNull();
  });
  it('já usava e parou: pede prints, sem instruções', () => {
    const g = roamingTimingGuard('2026-10-20', '2026-10-26', 'parou_de_funcionar');
    expect(g.ok).toBe(false);
    expect(g.instrucao).toContain('NÃO envie as instruções');
  });
  it('sem consulta de ativação: não bloqueia', () => {
    expect(roamingTimingGuard(null, '2026-10-26', undefined)).toBeNull();
  });
});

describe('consultar_parceiro', () => {
  const setup = (call: jest.Mock) => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const svc = new SimpremiumToolsService({}, {}, { call }, {}, {}, {}, {}, {}, {});
    return svc.tools.find((t: any) => t.name === 'consultar_parceiro');
  };
  const ctx = { organizationId: 'o', conversationId: 'c' } as any;

  it('manda CNPJ só com dígitos e e-mail minúsculo', async () => {
    const call = jest.fn(async () => ({ found: true, type: 'agencia' }));
    const res = await setup(call).execute({ cnpj: '12.345.678/0001-90', email: 'Agencia@X.com' }, ctx);
    expect(call).toHaveBeenCalledWith('o', 'consultar_parceiro', { cnpj: '12345678000190', email: 'agencia@x.com' });
    expect(res.output.resultado).toEqual({ found: true, type: 'agencia' });
  });

  it('consulta indisponível: segue e anota os dados na transferência', async () => {
    const call = jest.fn(async () => {
      throw new Error('Pedido Central consultar_parceiro falhou (404)');
    });
    const res = await setup(call).execute({ cupom: 'JOAO20' }, ctx);
    expect(res.output).toMatchObject({ ok: false, indisponivel: true });
  });

  it('sem nenhum dado: pede', async () => {
    const res = await setup(jest.fn()).execute({}, ctx);
    expect(res.output.ok).toBe(false);
  });
});

describe('status de pedido antigo não é informado (pode estar errado)', () => {
  const { hideStaleStatus, staleStatusNote } = require('./order-output');
  const idOf = (o: any) => String(o.number);
  const today = '2026-10-28';

  it('ativação encerrada ou pedido antigo sem ativação (caso 122998): sem status', () => {
    const orders = [
      { number: '122998', status: 'aguardando-envio', date: '2025-08-26T23:13:44+00:00' },
      { number: '141488', status: 'e-sim-enviado', date: '2026-10-03T03:55:42+00:00' },
    ];
    const periods = new Map([
      ['122998', []],
      ['141488', [{ start: '2026-10-01', end: '2026-10-10' }]],
    ]);
    const res = hideStaleStatus(orders, idOf, periods, today);
    expect(res.hidden).toEqual(['122998', '141488']);
    expect(res.orders[0].status).toBeUndefined();
    expect(res.orders[0].situacao_pedido).toContain('antigo');
    expect(res.orders[1].situacao_pedido).toContain('encerrada');
    expect(staleStatusNote(res.hidden)).toContain('NÃO informe o status');
  });

  it('ativação vigente ou futura, pedido recente sem ativação ou sem consulta: mantém o status', () => {
    const orders = [
      { number: '142570', status: 'aguardando-envio', date: '2026-10-22' },
      { number: '142840', status: 'aguardando-envio', date: '2026-10-28' },
      { number: '142245', status: 'e-sim-enviado', date: '2026-10-16' },
      { number: '999', status: 'completed', date: '2024-01-01' },
    ];
    const periods = new Map([
      ['142570', [{ start: '2026-10-29', end: '2026-11-16' }]],
      ['142840', []],
      ['142245', [{ start: '2026-10-27', end: '2026-11-15' }]],
    ]);
    const res = hideStaleStatus(orders, idOf, periods, today);
    expect(res.hidden).toEqual([]);
    expect(res.orders.map((o: any) => o.status)).toEqual(['aguardando-envio', 'aguardando-envio', 'e-sim-enviado', 'completed']);
  });
});

describe('cliente pede para cobrir o preço da concorrência', () => {
  const { asksPriceMatch } = require('./quote-plans');
  it('pedidos (caso da Gi: "Achei por 200", "iguale sim")', () => {
    for (const t of ['Achei por 200', 'Consegue fazer esse valor ?', 'iguale sim, por favor', 'vocês cobrem o preço da concorrência?', 'encontrei a R$ 180 em outro site']) {
      expect([t, asksPriceMatch(t)]).toEqual([t, true]);
    }
  });
  it('outras perguntas não', () => {
    for (const t of ['Se colar apartir de hj fica qual valor ?', 'tem plano por 20 dias?', 'Esse chip funciona na Itália tmb ?', 'quero fechar pelo whatsapp', 'é igual ao outro?']) {
      expect([t, asksPriceMatch(t)]).toEqual([t, false]);
    }
  });
});
