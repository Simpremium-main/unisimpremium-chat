import { activationStatus, annotateActivationDates, isoDay, prepareOrderOutput, stripInternal, todayIso, withChipCheck } from './order-output';

describe('saída das consultas de pedido pra IA', () => {
  it('tira campos internos em qualquer nível e códigos de plano no texto', () => {
    const out = stripInternal({
      id: 142611,
      plan: 'TIM-EUROPA',
      ativacoes: [{ iccid: '8955', operator: 'TIM 11', descricao: 'UDBAC-South American 8 Destinations-Total-1GB', franquia: 'Ilimitado' }],
      nota: 'Plano TIM-EUROPA, chip virtual',
    });
    expect(out).toEqual({
      id: 142611,
      ativacoes: [{ descricao: '[plano interno]', franquia: 'Ilimitado' }],
      nota: 'Plano [plano interno], chip virtual',
    });
    // Nome comum não é código interno.
    expect(stripInternal('Tim Maia comprou eSIM Europa')).toBe('Tim Maia comprou eSIM Europa');
  });

  it('datas em vários formatos', () => {
    expect(isoDay('2026-10-24T09:00:00')).toBe('2026-10-24');
    expect(isoDay('24/10/2026')).toBe('2026-10-24');
    expect(isoDay('amanhã')).toBeNull();
  });

  it('situação da ativação comparada com hoje', () => {
    expect(activationStatus('2026-10-24', '2026-11-21', '2026-10-24')).toBe('EM USO HOJE — dia 1 de 29, vai até 21/11/2026');
    expect(activationStatus('2026-11-01', '2026-11-10', '2026-10-30')).toBe('AINDA NÃO COMEÇOU — começa em 01/11/2026 (daqui a 2 dias)');
    expect(activationStatus('2026-09-01', '2026-09-10', '2026-10-24')).toBe('ENCERRADA — terminou em 10/09/2026');
  });

  it('marca cada período com início e fim, em qualquer nível', () => {
    const out: any = annotateActivationDates(
      { pedido: 142611, ativacoes: [{ data_inicio: '24/10/2026', data_fim: '21/11/2026' }] },
      '2026-10-25',
    );
    expect(out.ativacoes[0].situacao_hoje).toBe('EM USO HOJE — dia 2 de 29, vai até 21/11/2026');
    expect(out.situacao_hoje).toBeUndefined();
    expect(prepareOrderOutput({ start_date: '2026-10-30', iccid: 'x' }, '2026-10-24')).toEqual({
      start_date: '2026-10-30',
      situacao_hoje: 'AINDA NÃO COMEÇOU — começa em 30/10/2026 (daqui a 6 dias)',
    });
  });

  it('hoje no fuso de São Paulo (23h de SP ainda é o mesmo dia)', () => {
    expect(todayIso(new Date('2026-10-25T02:30:00Z'))).toBe('2026-10-24');
  });
});


describe('prazo de envio do eSIM (até 10:59 do dia anterior à ativação)', () => {
  const { esimSendStatus, annotateActivationDates } = require('./order-output');
  const act = { start_date: '2026-10-27', end_date: '2026-11-08', status: 'aguardando-envio' };

  it('caso da Dea: hoje é o dia do envio, 08:03 → no prazo, aguardar (não transferir)', () => {
    const out = annotateActivationDates(act, '2026-10-26', 8 * 60 + 3);
    expect(out.envio_esim).toContain('NO PRAZO');
    expect(out.envio_esim).toContain('HOJE (26/10/2026 até as 10:59');
    expect(out.envio_esim).toContain('NÃO transfira');
  });
  it('mesmo dia depois das 10:59 → atrasado, suporte', () => {
    expect(esimSendStatus('2026-10-27', '2026-10-26', 11 * 60)).toContain('ATRASADO');
  });
  it('dia do envio já passou → atrasado', () => {
    expect(esimSendStatus('2026-10-27', '2026-10-27', 8 * 60)).toContain('ATRASADO');
  });
  it('envio em outro dia → no prazo, com a data', () => {
    expect(esimSendStatus('2026-10-30', '2026-10-26', 9 * 60)).toContain('em 29/10/2026 até as 10:59');
  });
  it('já enviado: sem o campo', () => {
    const out = annotateActivationDates({ ...act, status: 'e-sim-enviado' }, '2026-10-26', 8 * 60);
    expect(out.envio_esim).toBeUndefined();
  });
});

describe('withChipCheck', () => {
  it('leva número da linha e final do ICCID para conferência, sem o ICCID inteiro', () => {
    const raw = { activations: [{ order_number: '141307', iccid: '8955 0328 0000 1754 3532', msisdn: '5511961015763' }] };
    const out = prepareOrderOutput(withChipCheck(raw), '2026-10-26', 600) as any;
    expect(out.activations[0].conferencia_chip).toEqual({ linha_tem_numero: true, numero_da_linha: '5511961015763', iccid_final: '543532' });
    expect(out.activations[0].iccid).toBeUndefined();
  });
  it('plano TIM: tem número e é +55; plano só de dados: sem número', () => {
    const raw = {
      activations: [
        { operator: 'TIM', plan: 'TIM-EUROPA', iccid: '89550328000017543532' },
        { operator: 'UDBAC', plan: 'UDBAC-South-1GB', iccid: '89852000000000955206' },
      ],
    };
    const out = prepareOrderOutput(withChipCheck(raw), '2026-10-26', 600) as any;
    expect(out.activations[0].conferencia_chip).toEqual({ linha_tem_numero: true, numero_brasileiro: true, iccid_final: '543532' });
    expect(out.activations[1].conferencia_chip).toEqual({ linha_tem_numero: false, iccid_final: '955206' });
    expect(out.activations[0].operator).toBeUndefined();
  });

  it('retorno real do Pedido Central com phone_number (pedido 141307)', () => {
    const raw = {
      activations: [
        {
          order_number: '141307', origem: 'site', source: 'main', order_id: '141307', item_id: 67890, unit: 1,
          plan: 'TIM NACIONAL MUNDO 2', operator: 'TIM 11', franchise: '10GB', destination: 'EUA',
          iccid: '89550328000017529176', phone_number: '5511961015763',
          start_date: '2026-10-20', end_date: '2026-10-30', period_days: 11, status: 'completed',
        },
      ],
    };
    const a = (prepareOrderOutput(withChipCheck(raw), '2026-10-27', 600) as any).activations[0];
    expect(a.conferencia_chip).toEqual({
      linha_tem_numero: true,
      numero_brasileiro: true,
      numero_da_linha: '5511961015763',
      iccid_final: '529176',
    });
    expect(a.plan).toBeUndefined();
    expect(a.operator).toBeUndefined();
    expect(a.iccid).toBeUndefined();
  });

  it('sem ICCID nem número: nada muda', () => {
    expect(withChipCheck({ a: [{ order_number: '1' }] })).toEqual({ a: [{ order_number: '1' }] });
  });
});

describe('vários pedidos: só os com ativação vigente ou futura', () => {
  const { onlyCurrentOrders, activationPeriods } = require('./order-output');
  const today = '2026-10-27';
  const orders = [{ number: '142788' }, { number: '133094' }, { number: '130738' }, { number: '101677' }, { number: '142900' }];
  const periods = new Map([
    ['142788', [{ start: '2026-10-27', end: '2026-11-05' }]],
    ['133094', [{ start: '2026-04-20', end: '2026-05-01' }]],
    ['130738', [{ start: '2026-02-20', end: '2026-03-01' }]],
    ['101677', [{ start: '2024-06-01', end: '2024-06-10' }]],
    ['142900', [{ start: '2026-12-01', end: '2026-12-10' }]],
  ]);
  const idOf = (o: any) => o.number;

  it('tira os encerrados e marca o período', () => {
    const r = onlyCurrentOrders(orders, idOf, periods, today);
    expect(r.kept.map(idOf)).toEqual(['142788', '142900']);
    expect(r.kept[0].ativacao).toBe('27/10/2026 a 05/11/2026 (vigente)');
    expect(r.kept[1].ativacao).toBe('01/12/2026 a 10/12/2026 (futura)');
    expect(r.omitted).toEqual(['133094', '130738', '101677']);
  });

  it('todos encerrados: mantém todos', () => {
    const r = onlyCurrentOrders(orders.slice(1, 4), idOf, periods, today);
    expect(r.kept).toHaveLength(3);
    expect(r.omitted).toEqual([]);
  });

  it('pedido sem ativação consultada fica', () => {
    const r = onlyCurrentOrders([{ number: '1' }, { number: '133094' }], idOf, periods, today);
    expect(r.kept.map(idOf)).toEqual(['1']);
  });

  it('lê os períodos do retorno de consultar_ativacoes', () => {
    expect(activationPeriods({ activations: [{ start_date: '2026-10-27', end_date: '2026-11-12' }] })).toEqual([
      { start: '2026-10-27', end: '2026-11-12' },
    ]);
  });
});

describe('troca manual de operadora: não vale para PREPAID/TMOBILE/UNI nos EUA', () => {
  const { withChipCheck } = require('./order-output');
  const act = (operator: string, plan: string, destination: string) =>
    withChipCheck({ operator, plan, destination, iccid: '8901260000000000001', start_date: '2026-10-27' }).conferencia_chip;

  it('PREPAID, TMOBILE ou UNI com destino EUA: selecao_manual_operadora false', () => {
    expect(act('PREPAID', 'PREPAID-USA', 'Estados Unidos')).toMatchObject({ selecao_manual_operadora: false });
    expect(act('TMOBILE', 'TMOBILE-US', 'Estados Unidos e Canadá')).toMatchObject({ selecao_manual_operadora: false });
    expect(act('T-Mobile', 'T-Mobile 30d', 'EUA')).toMatchObject({ selecao_manual_operadora: false });
    expect(act('UNI 3', 'UNI-USA', 'USA')).toMatchObject({ selecao_manual_operadora: false });
  });

  it('outro plano nos EUA, ou UNI fora dos EUA: pode trocar', () => {
    expect(act('TIM 11', 'TIM-EUA', 'Estados Unidos')).not.toHaveProperty('selecao_manual_operadora');
    expect(act('UNI 3', 'UNI-EUROPA', 'França, Itália')).not.toHaveProperty('selecao_manual_operadora');
    expect(act('TIM 11', 'TIM-EUROPA', 'Espanha')).not.toHaveProperty('selecao_manual_operadora');
  });
});
