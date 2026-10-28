import { parseQuote } from './previous-quote';

describe('cotação anterior lida do texto', () => {
  it('cotação da Julia (25/10): países, datas, dias, desconto e tipo', () => {
    const text =
      '*Julia:*\nSegue valor do plano com *20% de desconto*:\n\n*Países de Cobertura:* Suíça, Itália\n*Período da viagem:* 29/10/2026 - 07/11/2026 (10 dias)\n\n*Incluso:* Internet Ilimitado + Ligação Local\n*Preço por chip:* USD 33.15 / R$ 184.31\n\nPara detalhes do plano acesse: https://simpremium.com.br/produto/chip-virtual';
    expect(parseQuote(text)).toEqual({
      paises: ['Suíça', 'Itália'],
      datas: '29/10/2026 - 07/11/2026',
      inicio: '2026-10-29',
      dias: 10,
      tipo: 'virtual',
      desconto_percent: 20,
      cupom: null,
      ilimitado: true,
    });
  });

  it('cotação da IA sem datas e chip físico', () => {
    const text =
      'Segue valor do plano com *15% de desconto* com o cupom *MINHAVIAGEM*.\n\n*Países de Cobertura:* Espanha, França e Portugal\n*Período da viagem:* (12 dias)\n\n*Incluso:* Internet 10GB\n*Preço por chip:* USD 40.00 / R$ 220.00\n\nPara detalhes do plano acesse: https://simpremium.com.br/produto/chip-fisico';
    expect(parseQuote(text)).toMatchObject({
      paises: ['Espanha', 'França', 'Portugal'],
      datas: null,
      inicio: null,
      dias: 12,
      tipo: 'physical',
      desconto_percent: 15,
      cupom: 'MINHAVIAGEM',
      ilimitado: false,
    });
  });
});

describe('cotacao_chip atualizando a cotação anterior (caso da Julia, 20%)', () => {
  const julia =
    '*Julia:*\nSegue valor do plano com *20% de desconto*:\n\n*Países de Cobertura:* Suíça, Itália\n*Período da viagem:* 29/10/2026 - 07/11/2026 (10 dias)\n\n*Incluso:* Internet Ilimitado + Ligação Local\n*Preço por chip:* USD 33.15 / R$ 184.31\n\nPara detalhes do plano acesse: https://simpremium.com.br/produto/chip-virtual';
  const setup = () => {
    const { SimpremiumToolsService } = require('./simpremium-tools.service');
    const mcp = {
      call: jest.fn(async () => ({
        results: [{ allowance: 'Ilimitado', totalUSD: 45, totalBRL: 250, raw: { calls: 'Sim' } }],
      })),
    };
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ metadata: null })) },
      message: {
        findMany: jest.fn(async (q: any) =>
          q.where?.conversation
            ? [{ content: { text: julia }, createdAt: new Date(Date.now() - 3 * 86_400_000), conversationId: 'old' }]
            : [{ direction: 'INBOUND', content: { text: 'atualiza esse orçamento pra mim por favor' }, createdAt: new Date() }],
        ),
      },
    };
    const svc = new SimpremiumToolsService(prisma, {}, mcp, {}, {}, {}, {}, {}, {});
    return svc.tools.find((t: any) => t.name === 'cotacao_chip');
  };
  const ctx = { organizationId: 'o', conversationId: 'new', contactId: 'c1', agentId: 'a' } as any;

  it('mantém os 20% (sem cupom), as datas e recalcula o valor', async () => {
    const res = await setup().execute(
      { days: 10, countries: ['Suíça', 'Itália'], chipType: 'virtual', atualizarCotacaoAnterior: true },
      ctx,
    );
    const out = String(res.output);
    expect(out).toContain('Segue valor do plano com *20% de desconto*.');
    expect(out).not.toContain('MINHAVIAGEM');
    expect(out).toContain('*Período da viagem:* 29/10/2026 - 07/11/2026 (10 dias)');
  });
});
