import { AiAgentKind } from '@prisma/client';

import { discountedPrice, formatAtivacoes, formatCotacao, formatFrete, formatPedido, AMBIGUOUS_CLOSE_WORDS } from './simpremium-format';
import { splitBubbles } from '../builtin/reply-to-conversation.tool';
import { readAgentOptions } from '../../agents/agent-options';
import { FLOWS_TOOLSET, ToolRegistry } from '../tool-registry.service';
import { renderFlowsSection } from '../../runner/prompt-builder.service';
import { spokeWithoutNewInfo } from '../../runner/agent-runner.service';

// Respostas reais do Pedido Central (só os campos que o formatador usa).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const portugal = require('./__fixtures__/cotacao-portugal.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const japao = require('./__fixtures__/cotacao-japao.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const frete = require('./__fixtures__/frete.json');

describe('formatCotacao', () => {
  it('com ilimitado: mostra o mais barato com 15% (MINHAVIAGEM) e o "a partir de"', () => {
    const out = formatCotacao(portugal, { days: 7, countries: ['Portugal'], chipType: 'virtual' });
    const best = portugal.results
      .filter((p: any) => p.allowance === 'Ilimitado')
      .reduce((a: any, b: any) => (a.totalUSD <= b.totalUSD ? a : b));
    expect(out).toMatch(/^TEMPLATE_PRONTO/);
    expect(out).toContain('*15% de desconto* com o cupom *MINHAVIAGEM*');
    expect(out).toContain('*Países de Cobertura:* Portugal');
    expect(out).toContain('*Período da viagem:* (7 dias)');
    expect(out).toContain(`USD ${discountedPrice(best.totalUSD, best.totalBRL, 15).usd.toFixed(2)}`);
    expect(out).toContain('https://simpremium.com.br/produto/chip-virtual');
    expect(out).toContain('Obs.: Temos também planos com franquia de dados à partir de R$');
    // Tudo depois do "..." é a 2ª mensagem.
    expect(splitBubbles(out.replace(/^TEMPLATE_PRONTO[^\n]*\n+/, ''))).toEqual([
      expect.stringContaining('Segue valor do plano'),
      'Quer finalizar a compra pelo site ou prefere fechar aqui pelo WhatsApp?',
    ]);
  });

  it('franquiaApenas: lista diárias e do período, sem planos mais caros que o ilimitado', () => {
    const out = formatCotacao(japao, { days: 10, countries: ['Japão'], franquiaApenas: true, chipType: 'physical' });
    const cheapestUnlimited = Math.min(
      ...japao.results.filter((p: any) => p.allowance === 'Ilimitado').map((p: any) => p.totalUSD),
    );
    const lines = out.split('\n').filter((l) => l.startsWith('*Franquia'));
    expect(lines.length).toBeGreaterThan(0);
    expect(out).toContain(`copie TODAS as ${lines.length} linhas`);
    expect(out).toContain('https://simpremium.com.br/produto/chip-fisico');
    for (const line of lines) {
      const usd = Number(line.match(/USD ([\d.]+)/)![1]);
      expect(usd).toBeLessThan(discountedPrice(cheapestUnlimited, cheapestUnlimited * 5, 15).usd + 0.01);
    }
    // Um plano por franquia.
    const allowances = lines.map((l) => l.match(/\*Franquia (.+?) por chip/)![1]);
    expect(new Set(allowances).size).toBe(allowances.length);
  });

  it('cupom validado muda o percentual e o nome', () => {
    const out = formatCotacao(portugal, { days: 7, countries: ['Portugal'], couponCode: 'viaja20', couponDiscount: 20 });
    expect(out).toContain('*20% de desconto* com o cupom *VIAJA20*');
  });

  it('desconto só no valor líquido: a taxa de ativação (USD 5,95) fica fora', () => {
    // Alemanha 10 dias: 39,95 → (39,95 − 5,95) × 0,85 + 5,95 = 34,85.
    expect(discountedPrice(39.95, 201.26, 15).usd).toBe(34.85);
    // R$ com o mesmo câmbio do plano (201,26 / 39,95).
    expect(discountedPrice(39.95, 201.26, 15).brl).toBe(175.57);
    expect(discountedPrice(39.95, 201.26, 0)).toEqual({ usd: 39.95, brl: 201.26 });
    // Plano mais barato que a taxa: nada a descontar.
    expect(discountedPrice(4, 20, 15)).toEqual({ usd: 4, brl: 20 });
  });

  it('resposta inesperada passa direto', () => {
    expect(formatCotacao({ error: 'x' }, { days: 1, countries: [] })).toBe('{"error":"x"}');
  });
});

describe('formatadores de pedido', () => {
  it('frete: esconde frete grátis/agência no formato real ({ rates })', () => {
    const out = JSON.parse(formatFrete(frete));
    expect(out.rates.map((r: any) => r.label)).toEqual(['Envio Expresso', 'Entrega Motoboy']);
  });

  it('ativações: remove operadora, plano e ICCID', () => {
    const out = formatAtivacoes([{ iccid: '8955', operator: 'TIM', plan: 'TIM-EU', start: '2026-11-01', status: 'ativo' }]);
    const data = JSON.parse(out.split('\n')[0]);
    expect(data).toEqual([{ start: '2026-11-01', status: 'ativo' }]);
    expect(out).toContain('NUNCA mencione nome de operadora');
  });

  it('pedido: anexa as regras de privacidade', () => {
    expect(formatPedido({ id: 1 })).toContain('NUNCA os repita ou mostre');
  });

  it('não encerra depois de resposta ambígua', () => {
    expect(AMBIGUOUS_CLOSE_WORDS.test('ok')).toBe(true);
    expect(AMBIGUOUS_CLOSE_WORDS.test('pode encerrar, obrigado pela ajuda')).toBe(false);
  });
});

describe('splitBubbles', () => {
  it('divide em linhas só com "..." e mantém o resto', () => {
    expect(splitBubbles('a\n\n...\n\nb')).toEqual(['a', 'b']);
    expect(splitBubbles('a\n---\nb\n…\nc')).toEqual(['a', 'b', 'c']);
    expect(splitBubbles('frase com... reticências')).toEqual(['frase com... reticências']);
  });
});

describe('opções do agente e pacotes de ferramentas', () => {
  const fake = (name: string) => ({ name, description: name, parameters: { type: 'object' }, execute: jest.fn() });
  const registry = new ToolRegistry(
    { get: () => undefined } as any,
    fake('replyToConversation') as any,
    fake('transferToHuman') as any,
    fake('tagConversation') as any,
    fake('listAvailableAgents') as any,
    fake('delegateToAgent') as any,
    fake('handBackToOrchestrator') as any,
    fake('getProductPitch') as any,
    fake('checkBonusEligibility') as any,
    fake('checkMembersAccess') as any,
    fake('consultarClickUpCliente') as any,
    fake('consultarN8nCliente') as any,
    fake('listarReunioesCliente') as any,
    fake('lerTranscricaoReuniao') as any,
    fake('agendarReuniao') as any,
    fake('moveRecoveryCard') as any,
    fake('enviarMensagensDoFluxo') as any,
    { tools: [fake('cotacao_chip'), fake('escalar_para_humano')] } as any,
    { tools: [fake('uni_consultar_linha'), fake('uni_recarregar')] } as any,
    fake('addInternalNote') as any,
    fake('buscar_conhecimento') as any,
  );
  const names = (modelParams: unknown, implicit: string[] = []) =>
    registry
      .getLlmDefinitionsForAgent(AiAgentKind.WORKER, 'agent-1', readAgentOptions(modelParams), implicit)
      .map((d) => d.name);

  it('agente sem opções mantém exatamente as ferramentas de antes (+ nota interna e base de conhecimento)', () => {
    expect(names(null)).toEqual([
      'replyToConversation',
      'transferToHuman',
      'tagConversation',
      'addInternalNote',
      'buscar_conhecimento',
      'handBackToOrchestrator',
      'getProductPitch',
      'checkBonusEligibility',
      'checkMembersAccess',
    ]);
  });

  it('pacote simpremium + ferramentas desligadas', () => {
    const params = {
      toolsets: ['simpremium'],
      disabledTools: ['transferToHuman', 'tagConversation', 'handBackToOrchestrator'],
    };
    expect(names(params)).toEqual([
      'replyToConversation',
      'addInternalNote',
      'buscar_conhecimento',
      'cotacao_chip',
      'escalar_para_humano',
    ]);
    expect(names(params, [FLOWS_TOOLSET])).toContain('enviarMensagensDoFluxo');
    expect(
      registry.isAllowedForAgent('transferToHuman', AiAgentKind.WORKER, 'agent-1', readAgentOptions(params)),
    ).toBe(false);
  });

  it('pacote unimobile só para quem tem', () => {
    expect(names(null)).not.toContain('uni_consultar_linha');
    expect(names({ toolsets: ['unimobile'] })).toEqual(expect.arrayContaining(['uni_consultar_linha', 'uni_recarregar']));
  });

  it('lê e limita as opções', () => {
    expect(readAgentOptions({ promptMode: 'standalone', maxRepliesPerRun: 99 })).toMatchObject({
      promptMode: 'standalone',
      maxRepliesPerRun: 20,
    });
    expect(readAgentOptions({ maxRepliesPerRun: 0 }).maxRepliesPerRun).toBe(1);
    expect(readAgentOptions('lixo')).toMatchObject({ promptMode: 'default', toolsets: null, maxRepliesPerRun: 1 });
  });
});

describe('seção de fluxos no prompt', () => {
  const flow = (over: Record<string, unknown> = {}) =>
    ({
      name: 'Cotação de Chip',
      slug: 'cotacao-de-chip',
      trigger: 'Quando o cliente quer chip',
      instructions: 'Etapa 1: envie as mensagens.',
      steps: [
        { type: 'TEXT', content: 'Temos chip físico e virtual.', caption: null },
        { type: 'IMAGE', content: 'https://x.test/a.jpg', caption: 'Ajustes > Celular' },
      ],
      ...over,
    }) as any;

  it('mesmo formato do Simp, apontando para a ferramenta', () => {
    const out = renderFlowsSection([flow()], true);
    expect(out).toContain('## Fluxos de Atendimento Configurados');
    expect(out).toContain('### Cotação de Chip');
    expect(out).toContain('**Gatilho:** Quando o cliente quer chip');
    expect(out).toContain('**O que fazer:** Etapa 1: envie as mensagens.');
    expect(out).toContain('chame `enviarMensagensDoFluxo` com fluxo="cotacao-de-chip"');
    expect(out).toContain('2. [imagem] https://x.test/a.jpg — Ajustes > Celular');
  });

  it('sem fluxos, sem seção', () => {
    expect(renderFlowsSection([], true)).toBe('');
  });
});

describe('fim do turno depois de responder', () => {
  const ok = { ok: true };
  it('respondeu sem consulta depois → encerra', () => {
    expect(spokeWithoutNewInfo([{ toolName: 'set_label', output: ok }, { toolName: 'replyToConversation', output: ok }])).toBe(true);
    expect(spokeWithoutNewInfo([{ toolName: 'enviarMensagensDoFluxo', output: ok }])).toBe(true);
  });
  it('respondeu e consultou → volta ao modelo com o resultado', () => {
    expect(spokeWithoutNewInfo([{ toolName: 'replyToConversation', output: ok }, { toolName: 'cotacao_chip', output: 'TEMPLATE' }])).toBe(false);
  });
  it('resposta bloqueada ou só consulta → segue', () => {
    expect(spokeWithoutNewInfo([{ toolName: 'replyToConversation', output: { ok: false } }])).toBe(false);
    expect(spokeWithoutNewInfo([{ toolName: 'cotacao_chip', output: 'x' }])).toBe(false);
  });
});

describe('cotacao_chip: planos com franquia depois do ilimitado', () => {
  const quoteText = (countries: string, obs: boolean) =>
    `Segue valor do plano com *15% de desconto* com o cupom *MINHAVIAGEM*.\n\n*Países de Cobertura:* ${countries}\n*Período da viagem:* (15 dias)\n\n*Incluso:* Internet Ilimitado${obs ? '\nObs.: Temos também planos com franquia de dados à partir de R$ 34.04' : ''}`;
  const svc = (outbound: string[]) => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const prisma = {
      message: { findMany: jest.fn(async () => outbound.map((t) => ({ content: { text: t } }))) },
      conversation: { findUnique: jest.fn(async () => ({ metadata: null })) },
    };
    return new SimpremiumToolsService(prisma, {}, {}, {}, {}, {}, {}, {}, {} as any);
  };
  const ctx = { conversationId: 'c' } as any;

  it('última cotação foi a do ilimitado com a nota, mesmos países → só franquia', async () => {
    const s = svc(['Quer finalizar a compra pelo site ou prefere fechar aqui pelo WhatsApp?', quoteText('Espanha', true)]);
    await expect(s.lastQuoteOfferedFranchise(ctx, ['Espanha'])).resolves.toBe(true);
  });
  it('outro país, ou a última cotação já era de franquia → cotação normal', async () => {
    await expect(svc([quoteText('Espanha', true)]).lastQuoteOfferedFranchise(ctx, ['Japão'])).resolves.toBe(false);
    await expect(svc([quoteText('Espanha', false)]).lastQuoteOfferedFranchise(ctx, ['Espanha'])).resolves.toBe(false);
    await expect(svc([]).lastQuoteOfferedFranchise(ctx, ['Espanha'])).resolves.toBe(false);
  });
});

describe('set_label', () => {
  it('tag inexistente em Configurações → Tags não é falha: grava a etiqueta na conversa', async () => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const update = jest.fn(async () => ({}));
    const prisma = { conversation: { findUnique: jest.fn(async () => ({ metadata: { x: 1 } })), update } };
    const tag = { execute: jest.fn(async () => ({ output: { ok: false, error: 'none of these tags exist' } })) };
    const svc = new SimpremiumToolsService(prisma, {}, {}, tag, {}, {}, {}, {}, {} as any);
    const tool = svc.tools.find((t: any) => t.name === 'set_label');
    const res = await tool.execute({ label: 'duvidas' }, { conversationId: 'c' });
    expect(res.output).toEqual({ ok: true, label: 'duvidas', tagAplicada: false });
    expect(update).toHaveBeenCalledWith({ where: { id: 'c' }, data: { metadata: { x: 1, aiLabel: 'duvidas' } } });
  });
});
