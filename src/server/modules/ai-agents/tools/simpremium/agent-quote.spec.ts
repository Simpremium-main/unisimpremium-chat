import { quoteMessages, tripDays } from './agent-quote.service';

describe('cotação do atendente', () => {
  const template =
    'TEMPLATE_PRONTO — REGRAS: (1) datas… (3) 2 mensagens.\n\nSegue valor do plano com *15% de desconto* com o cupom *MINHAVIAGEM*.\n\n*Países de Cobertura:* Estados Unidos\n*Período da viagem:* (6 dias)\n\n*Preço por chip:* USD 28.90 / R$ 162.71\n\n...\n\nQuer finalizar a compra pelo site ou prefere fechar aqui pelo WhatsApp?';

  it('conta ida e volta', () => {
    expect(tripDays('2026-10-29', '2026-11-03')).toBe(6);
  });

  it('tira as regras, põe as datas e separa as 2 mensagens', () => {
    const msgs = quoteMessages(template, { days: 6, startDate: '2026-10-29', endDate: '2026-11-03' });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).not.toContain('TEMPLATE_PRONTO');
    expect(msgs[0]).toContain('*Período da viagem:* 29/10/2026 - 03/11/2026 (6 dias)');
    expect(msgs[1]).toBe('Quer finalizar a compra pelo site ou prefere fechar aqui pelo WhatsApp?');
  });

  it('sem datas mantém só "(N dias)"', () => {
    expect(quoteMessages(template, { days: 6 })[0]).toContain('*Período da viagem:* (6 dias)');
  });
});

describe('desconto do atendente', () => {
  const { formatCotacao } = require('./simpremium-format');
  const raw = { results: [{ allowance: 'Ilimitado', totalUSD: 40, totalBRL: 200, raw: { calls: 'Não' } }] };
  const intro = (opts: object) => formatCotacao(raw, { days: 6, countries: ['Estados Unidos'], ...opts }).split('\n\n')[1];

  it('padrão: 15% com o cupom MINHAVIAGEM', () => {
    expect(intro({})).toBe('Segue valor do plano com *15% de desconto* com o cupom *MINHAVIAGEM*.');
  });
  it('outro desconto: sem citar cupom', () => {
    expect(intro({ couponDiscount: 10, hideCoupon: true })).toBe('Segue valor do plano com *10% de desconto*.');
  });
  it('sem desconto', () => {
    expect(intro({ couponDiscount: 0, hideCoupon: true })).toBe('Segue valor do plano.');
  });
});

describe('cotação de chip físico pede o CEP do frete', () => {
  const { formatCotacao } = require('./simpremium-format');
  const raw = { results: [{ allowance: 'Ilimitado', totalUSD: 45, totalBRL: 250, raw: { calls: 'Sim' } }] };
  const second = (opts: object) => formatCotacao(raw, { days: 12, countries: ['França'], ...opts }).split('\n\n...\n\n')[1];
  const rules = (opts: object) => formatCotacao(raw, { days: 12, countries: ['França'], ...opts }).split('\n\n')[0];

  it('físico sem CEP: a 2ª mensagem pede o CEP', () => {
    expect(second({ chipType: 'physical' })).toBe('Para calcular o valor e o prazo do frete, me informe o seu CEP, por favor.');
    expect(rules({ chipType: 'physical' })).toContain('chame calcular_frete');
  });
  it('físico com CEP já informado: pergunta como finalizar e manda calcular o frete', () => {
    expect(second({ chipType: 'physical', cep: '01310-100' })).toBe('Quer finalizar a compra pelo site ou prefere fechar aqui pelo WhatsApp?');
    expect(rules({ chipType: 'physical', cep: '01310-100' })).toContain('calcular_frete com esse CEP');
  });
  it('virtual: como antes', () => {
    expect(second({ chipType: 'virtual' })).toBe('Quer finalizar a compra pelo site ou prefere fechar aqui pelo WhatsApp?');
    expect(rules({ chipType: 'virtual' })).not.toContain('calcular_frete');
  });
});

describe('chip físico com CEP já informado: cotação → frete → finalizar', () => {
  const { formatCotacao, freteMessage } = require('./simpremium-format');
  const rates = JSON.stringify({
    rates: [
      { label: 'Envio Correios Normal', formatted: 'USD 5.00', delivery_days: 7 },
      { label: 'Envio Correios Expresso', formatted: 'USD 8.00', delivery_days: 3 },
    ],
  });

  it('monta a mensagem do frete', () => {
    expect(freteMessage(rates, '79034-620')).toBe(
      'Frete para o CEP 79034-620:\n*Envio Correios Normal:* USD 5.00 (cerca de 7 dias úteis)\n*Envio Correios Expresso:* USD 8.00 (cerca de 3 dias úteis)\n\nO prazo conta a partir do próximo dia útil após o envio.',
    );
    expect(freteMessage('{"rates":[]}', '79034-620')).toBeNull();
  });

  it('a cotação sai em 3 mensagens, nessa ordem', () => {
    const raw = { results: [{ allowance: 'Ilimitado', totalUSD: 45, totalBRL: 250, raw: { calls: 'Sim' } }] };
    const frete = freteMessage(rates, '79034-620');
    const t = formatCotacao(raw, { days: 12, countries: ['França'], chipType: 'physical', cep: '79034-620', frete });
    const parts = t.split('\n\n...\n\n');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('*Preço por chip:*');
    expect(parts[1]).toBe(frete);
    expect(parts[2]).toBe('Quer finalizar a compra pelo site ou prefere fechar aqui pelo WhatsApp?');
    expect(t.split('\n\n')[0]).not.toContain('calcular_frete');
  });
});
