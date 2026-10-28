import { dateRangesIn, inclusiveDays, tripDatesFor } from './quote-dates';

const today = '2026-10-28';

describe('datas da viagem na cotação', () => {
  it('"De 25/11 a 09/12" com 15 dias (caso do cruzeiro): usa as datas', () => {
    const texts = ['Faremos cruzeiro pelo Mediterrâneo', 'Países: França, Itália, Espanha e Portugal.', 'De 25/11 a 09/12'];
    expect(tripDatesFor(texts, 15, today)).toEqual({ start: '2026-11-25', end: '2026-12-09' });
  });

  it('formatos e virada de ano', () => {
    expect(dateRangesIn('vou de 28/12 até 05/01', today)).toEqual([{ start: '2026-12-28', end: '2027-01-05' }]);
    expect(dateRangesIn('29/10/2026 - 07/11/2026', today)).toEqual([{ start: '2026-10-29', end: '2026-11-07' }]);
    expect(dateRangesIn('05/12 a 11/12', today)).toEqual([{ start: '2026-12-05', end: '2026-12-11' }]);
    // Data que já passou neste ano → ano que vem.
    expect(dateRangesIn('10/03 a 20/03', today)).toEqual([{ start: '2027-03-10', end: '2027-03-20' }]);
    expect(inclusiveDays('2026-11-25', '2026-12-09')).toBe(15);
  });

  it('só dias, ou datas que não batem com os dias cotados: sem datas', () => {
    expect(tripDatesFor(['vou ficar 15 dias na Europa'], 15, today)).toBeNull();
    // Cliente mudou para 10 dias depois de dar as datas.
    expect(tripDatesFor(['agora são 10 dias', 'De 25/11 a 09/12'], 10, today)).toBeNull();
    expect(dateRangesIn('31/02 a 05/03', today)).toEqual([]);
  });
});

describe('cotação com as datas do cliente', () => {
  const { formatCotacao } = require('./simpremium-format');
  const raw = { results: [{ allowance: 'Ilimitado', totalUSD: 50, totalBRL: 280, raw: { calls: 'Sim' } }] };
  it('com período: datas no texto; sem: só "(N dias)"', () => {
    const withDates = formatCotacao(raw, { days: 15, countries: ['França'], period: '25/11/2026 - 09/12/2026' });
    expect(withDates).toContain('*Período da viagem:* 25/11/2026 - 09/12/2026 (15 dias)');
    expect(withDates).toContain('As datas da viagem já estão no texto');
    expect(formatCotacao(raw, { days: 15, countries: ['França'] })).toContain('*Período da viagem:* (15 dias)');
  });
});
