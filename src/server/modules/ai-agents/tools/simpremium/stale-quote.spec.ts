import { staleRepeatedQuote } from './simpremium-tools.service';
import { gapMarker } from '../../runner/prompt-builder.service';

const QUOTE =
  'Segue valor do plano com *15% de desconto* com o cupom *MINHAVIAGEM*.\n\n*Países de Cobertura:* Alemanha\n*Período da viagem:* 25/10/2026 - 01/11/2026 (8 dias)\n\n*Incluso:* Internet Ilimitado';
const at = (iso: string) => new Date(iso);
const msg = (direction: string, text: string, iso: string) => ({ direction, text, createdAt: at(iso) });

describe('staleRepeatedQuote (caso real: "Preciso de uma cotação" 16h depois)', () => {
  // ordem decrescente, como vem do banco
  const history = [
    msg('INBOUND', 'Preciso de uma cotação', '2026-10-23T22:18:00Z'),
    msg('INBOUND', 'nao possui', '2026-10-23T21:40:00Z'),
    msg('OUTBOUND', 'Encontrei o pedido 141875…', '2026-10-23T06:10:00Z'),
    msg('INBOUND', 'agora preciso de ajuda sobre um pedido', '2026-10-23T06:09:00Z'),
    msg('OUTBOUND', QUOTE, '2026-10-23T06:03:00Z'),
    msg('INBOUND', '25/10 ate 1/11 para alemanha', '2026-10-23T06:01:00Z'),
  ];
  const now = at('2026-10-23T22:19:00Z');

  it('segura a cotação velha e devolve o que foi cotado', () => {
    expect(staleRepeatedQuote(history, ['Alemanha'], 8, now)).toEqual({
      countries: 'Alemanha',
      period: '25/10/2026 - 01/11/2026 (8 dias)',
      hoursAgo: 16,
    });
  });

  it('libera: cotação recente (fluxo "quais são os planos de 29?")', () => {
    expect(staleRepeatedQuote(history, ['Alemanha'], 8, at('2026-10-23T06:30:00Z'))).toBeNull();
  });

  it('libera: outro destino ou outro período', () => {
    expect(staleRepeatedQuote(history, ['França'], 8, now)).toBeNull();
    expect(staleRepeatedQuote(history, ['Alemanha'], 15, now)).toBeNull();
  });

  it('libera: depois da cotação alguém citou o destino (cliente ou a IA confirmando)', () => {
    const confirmado = [
      msg('INBOUND', 'sim, a mesma', '2026-10-23T22:21:00Z'),
      msg('OUTBOUND', 'É para a mesma viagem (Alemanha, 25/10 a 01/11) ou outro destino?', '2026-10-23T22:20:00Z'),
      ...history,
    ];
    expect(staleRepeatedQuote(confirmado, ['Alemanha'], 8, now)).toBeNull();
    const clienteDisse = [msg('INBOUND', 'cotação pra alemanha de novo', '2026-10-23T22:18:00Z'), ...history.slice(1)];
    expect(staleRepeatedQuote(clienteDisse, ['Alemanha'], 8, now)).toBeNull();
  });

  it('sem cotação anterior não bloqueia', () => {
    expect(staleRepeatedQuote([msg('INBOUND', 'oi', '2026-10-23T22:18:00Z')], ['Alemanha'], 8, now)).toBeNull();
  });
});

describe('gapMarker', () => {
  it('descreve a pausa em horas ou dias', () => {
    expect(gapMarker(16.2)).toContain('16h');
    expect(gapMarker(50)).toContain('2 dias');
  });
});
