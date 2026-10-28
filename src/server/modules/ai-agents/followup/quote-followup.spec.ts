import {
  closeDueAt,
  decideFollowup,
  followupDueAt,
  inFollowupWindow,
  isDecline,
  isQuoteText,
  FollowupMessage,
  FollowupState,
} from './quote-followup';

// Horários em Brasília (UTC-3).
const br = (s: string) => new Date(`${s}-03:00`);
const quote = 'Segue valor do plano...\n*Preço por chip:* USD 28.90 / R$ 162.71';
const followupText = 'Ficou alguma dúvida sobre a cotação acima?\nVamos fechar o pedido?';
const msg = (id: string, direction: 'INBOUND' | 'OUTBOUND', text: string, at: string, ai = direction === 'OUTBOUND'): FollowupMessage => ({
  id,
  direction,
  text,
  createdAt: br(at),
  aiAgentId: ai ? 'agent' : null,
});
const none = (): FollowupState => ({});

describe('cobrança de retorno da cotação', () => {
  it('reconhece a cotação e a recusa', () => {
    expect(isQuoteText(quote)).toBe(true);
    expect(isQuoteText('Encontrei seu pedido 142727')).toBe(false);
    expect(isDecline('Não quero, obrigado')).toBe(true);
    expect(isDecline('Achei caro')).toBe(true);
    expect(isDecline('Vou verificar e depois retorno')).toBe(false);
  });

  it('horário: 10:00 às 17:59; antes das 10h vai para as 10h; depois das 18h, 10h do dia seguinte', () => {
    expect(inFollowupWindow(br('2026-10-27T09:59:00'))).toBe(false);
    expect(inFollowupWindow(br('2026-10-27T10:00:00'))).toBe(true);
    expect(inFollowupWindow(br('2026-10-27T17:59:00'))).toBe(true);
    expect(inFollowupWindow(br('2026-10-27T18:00:00'))).toBe(false);
    expect(followupDueAt(br('2026-10-27T13:00:00'))).toEqual(br('2026-10-27T15:00:00'));
    expect(followupDueAt(br('2026-10-27T16:30:00'))).toEqual(br('2026-10-28T10:00:00'));
    expect(followupDueAt(br('2026-10-27T05:00:00'))).toEqual(br('2026-10-27T10:00:00'));
    expect(closeDueAt(br('2026-10-27T15:00:00'))).toEqual(br('2026-10-28T10:00:00'));
    expect(closeDueAt(br('2026-10-27T10:00:00'))).toEqual(br('2026-10-28T10:00:00'));
  });

  it('sem retorno: cobra 2h depois', () => {
    const m = [msg('1', 'INBOUND', 'quero eSIM EUA', '2026-10-27T11:00:00'), msg('q', 'OUTBOUND', quote, '2026-10-27T11:01:00')];
    expect(decideFollowup(m, br('2026-10-27T12:59:00'), none)).toMatchObject({ send: false, reason: 'ainda-nao' });
    expect(decideFollowup(m, br('2026-10-27T13:05:00'), none)).toMatchObject({ send: true, stage: 'cobranca', quoteId: 'q' });
  });

  it('"vou verificar" (e a IA respondeu): cobra 2h depois da última mensagem', () => {
    const m = [
      msg('q', 'OUTBOUND', quote, '2026-10-27T11:00:00'),
      msg('2', 'INBOUND', 'Vou verificar e te retorno', '2026-10-27T11:10:00'),
      msg('3', 'OUTBOUND', 'Combinado, fico no aguardo!', '2026-10-27T11:11:00'),
    ];
    expect(decideFollowup(m, br('2026-10-27T13:12:00'), none)).toMatchObject({ send: true, stage: 'cobranca' });
  });

  it('cotação às 17:00: cobra às 10:00 do dia seguinte', () => {
    const m = [msg('q', 'OUTBOUND', quote, '2026-10-27T17:00:00')];
    expect(decideFollowup(m, br('2026-10-27T19:05:00'), none)).toMatchObject({ send: false, reason: 'ainda-nao' });
    expect(decideFollowup(m, br('2026-10-28T10:05:00'), none)).toMatchObject({ send: true, stage: 'cobranca' });
  });

  it('12h depois da cobrança, sem resposta: encerramento (dentro da janela)', () => {
    const m = [msg('q', 'OUTBOUND', quote, '2026-10-27T11:00:00'), msg('f', 'OUTBOUND', followupText, '2026-10-27T13:00:00')];
    const state = () => ({ followupAt: br('2026-10-27T13:00:00') });
    // 13:00 + 12h = 01:00 → 10:00 do dia seguinte
    expect(decideFollowup(m, br('2026-10-28T09:00:00'), state)).toMatchObject({ send: false, reason: 'ainda-nao' });
    expect(decideFollowup(m, br('2026-10-28T10:05:00'), state)).toMatchObject({ send: true, stage: 'encerramento' });
    // kv perdido: acha a cobrança pelo texto
    expect(decideFollowup(m, br('2026-10-28T10:05:00'), none)).toMatchObject({ send: true, stage: 'encerramento' });
  });

  it('cliente respondeu à cobrança: não encerra', () => {
    const m = [
      msg('q', 'OUTBOUND', quote, '2026-10-27T11:00:00'),
      msg('f', 'OUTBOUND', followupText, '2026-10-27T13:00:00'),
      msg('r', 'INBOUND', 'vou ver com meu marido', '2026-10-27T14:00:00'),
      msg('a', 'OUTBOUND', 'Combinado!', '2026-10-27T14:01:00'),
    ];
    expect(decideFollowup(m, br('2026-10-28T10:05:00'), () => ({ followupAt: br('2026-10-27T13:00:00') }))).toMatchObject({
      send: false,
      reason: 'respondeu-a-cobranca',
    });
  });

  it('recusou, humano assumiu, cliente falou por último ou já encerrado: nada', () => {
    const base = [msg('q', 'OUTBOUND', quote, '2026-10-27T11:00:00')];
    const later = br('2026-10-27T13:30:00');
    expect(
      decideFollowup([...base, msg('2', 'INBOUND', 'não quero', '2026-10-27T11:05:00'), msg('3', 'OUTBOUND', 'Tudo bem!', '2026-10-27T11:06:00')], later, none),
    ).toMatchObject({ send: false, reason: 'recusou' });
    expect(decideFollowup([...base, msg('2', 'OUTBOUND', 'Oi, sou a Ana', '2026-10-27T11:05:00', false)], later, none)).toMatchObject({
      send: false,
      reason: 'humano',
    });
    expect(decideFollowup([...base, msg('2', 'INBOUND', 'e o pagamento?', '2026-10-27T11:05:00')], later, none)).toMatchObject({
      send: false,
      reason: 'cliente-falou-por-ultimo',
    });
    expect(decideFollowup(base, later, () => ({ closedAt: br('2026-10-27T12:00:00') }))).toMatchObject({ send: false, reason: 'ja-encerrado' });
  });

  it('cotação antiga (deploy, fila parada): não cobra atrasado', () => {
    const m = [msg('q', 'OUTBOUND', quote, '2026-10-24T11:00:00')];
    expect(decideFollowup(m, br('2026-10-27T15:00:00'), none)).toMatchObject({ send: false, reason: 'atrasado-demais' });
  });

  it('cotação do atendente passada para a IA: cobra em nome do agente do canal', () => {
    const m = [
      msg('q', 'OUTBOUND', quote, '2026-10-27T11:00:00', false),
      msg('2', 'OUTBOUND', 'Quer finalizar pelo site ou aqui?', '2026-10-27T11:00:05', false),
    ];
    const handoff = { messageId: 'q', at: br('2026-10-27T11:01:00').toISOString() };
    expect(decideFollowup(m, br('2026-10-27T13:05:00'), none)).toMatchObject({ send: false, reason: 'sem-cotacao' });
    expect(decideFollowup(m, br('2026-10-27T13:05:00'), none, handoff, 'orq')).toMatchObject({ send: true, agentId: 'orq' });
  });
});

describe('prazos e horário configurados pela organização', () => {
  const { quoteFollowupSettings, DEFAULT_QUOTE_FOLLOWUP_SETTINGS } = require('./quote-followup');

  it('sem configuração ou com valores inválidos: padrões (2h, 12h, 10h às 18h)', () => {
    expect(quoteFollowupSettings(null)).toEqual(DEFAULT_QUOTE_FOLLOWUP_SETTINGS);
    expect(
      quoteFollowupSettings({ quoteFollowup: { followupDelayHours: 0, closeDelayHours: 500, windowStartHour: 19, windowEndHour: 9 } }),
    ).toEqual(DEFAULT_QUOTE_FOLLOWUP_SETTINGS);
  });

  it('cobrança em 1h, encerramento em 6h, das 8h às 20h', () => {
    const cfg = quoteFollowupSettings({
      quoteFollowup: { enabled: true, followupDelayHours: 1, closeDelayHours: 6, windowStartHour: 8, windowEndHour: 20 },
    });
    const m = [msg('q', 'OUTBOUND', quote, '2026-10-27T18:30:00')];
    expect(decideFollowup(m, br('2026-10-27T19:35:00'), none, null, null, cfg)).toMatchObject({ send: true, stage: 'cobranca' });
    // Padrão: 18h30 + 2h passa do horário → só no dia seguinte.
    expect(decideFollowup(m, br('2026-10-27T19:35:00'), none)).toMatchObject({ send: false, reason: 'ainda-nao' });
    const followed = [...m, msg('f', 'OUTBOUND', followupText, '2026-10-27T19:35:00')];
    // 19h35 + 6h = 01h35 → abre às 8h.
    expect(decideFollowup(followed, br('2026-10-28T08:05:00'), none, null, null, cfg)).toMatchObject({ send: true, stage: 'encerramento' });
    expect(followupDueAt(br('2026-10-27T19:30:00'), cfg)).toEqual(br('2026-10-28T08:00:00'));
    expect(closeDueAt(br('2026-10-27T09:00:00'), cfg)).toEqual(br('2026-10-27T15:00:00'));
    expect(inFollowupWindow(br('2026-10-27T19:59:00'), cfg)).toBe(true);
  });
});
