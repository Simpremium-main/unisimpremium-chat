import { migrationGuidance, migrationOperator, operatorOf } from './chip-migration';

describe('migração de chip', () => {
  const g = (chipAtual: 'fisico' | 'virtual', destino: 'fisico' | 'virtual', operator: any) =>
    migrationGuidance({ orderId: '4808', chipAtual, destino, operator });

  it('operadora pelo plano/operadora das ativações', () => {
    expect(operatorOf('TIM-EUROPA')).toBe('TIM');
    expect(operatorOf('UNI Global')).toBe('UNI');
    expect(operatorOf('PREPAID USA')).toBe('PREPAID');
    expect(operatorOf('UNIVERSAL')).toBe('OUTRA');
    expect(operatorOf('ORANGE')).toBe('OUTRA');
    expect(migrationOperator([{ operator: 'TIM', plan: 'TIM-EUROPA' }])).toBe('TIM');
    expect(migrationOperator({ ativacoes: [{ plan: 'PREPAID-USA' }] })).toBe('PREPAID');
    expect(migrationOperator([{ operator: 'TIM' }, { operator: 'ORANGE' }])).toBe('VARIAS');
    expect(migrationOperator({ status: 'ativo' })).toBeNull();
  });

  it('físico em outro aparelho: qualquer aparelho desbloqueado, e transfere', () => {
    const out = g('fisico', 'fisico', null);
    expect(out).toMatch(/qualquer aparelho desbloqueado/);
    expect(out).toMatch(/escalar_para_humano.*Migração de chip — pedido 4808/);
  });

  it('virtual → virtual: dados, prazo, taxa e Pix por operadora (sem citar a operadora)', () => {
    const prepaid = g('virtual', 'virtual', 'PREPAID');
    expect(prepaid).toMatch(/EID e o IMEI2 do aparelho ANTERIOR e do aparelho NOVO/);
    expect(prepaid).toMatch(/2 a 4 horas, feito entre 12h e 20h/);
    expect(prepaid).toMatch(/USD 5,95 \(R\$ 30\).*pix@simpremium\.com\.br/);
    expect(prepaid).toMatch(/por e-mail/);

    const uni = g('virtual', 'virtual', 'UNI');
    expect(uni).toMatch(/IMEI2 do aparelho ANTERIOR e do aparelho NOVO/);
    expect(uni).not.toMatch(/EID/);
    expect(uni).toMatch(/1 a 3 horas/);

    const tim = g('virtual', 'virtual', 'TIM');
    expect(tim).toMatch(/ICCID do eSIM instalado no aparelho ANTERIOR.*abaixo do QR Code/);
    expect(tim).toMatch(/alguns minutos/);

    for (const out of [prepaid, uni, tim]) {
      expect(out).not.toMatch(/\b(PREPAID|UNI|TIM)\b/);
      expect(out).toMatch(/escalar_para_humano/);
    }
  });

  it('demais operadoras: não é possível (físico → virtual e virtual → virtual), e transfere', () => {
    for (const atual of ['fisico', 'virtual'] as const) {
      const out = g(atual, 'virtual', 'OUTRA');
      expect(out).toMatch(/Não é possível/);
      expect(out).toMatch(/escalar_para_humano/);
    }
  });

  it('físico → virtual em plano que permite: possível, equipe passa os passos', () => {
    const out = g('fisico', 'virtual', 'TIM');
    expect(out).toMatch(/é possível/);
    expect(out).not.toMatch(/\bTIM\b/);
  });

  it('sem plano confirmado ou chips de planos diferentes: não promete, transfere', () => {
    expect(g('virtual', 'virtual', null)).toMatch(/Não prometa nada/);
    expect(g('virtual', 'virtual', 'VARIAS')).toMatch(/planos diferentes/);
  });
});
