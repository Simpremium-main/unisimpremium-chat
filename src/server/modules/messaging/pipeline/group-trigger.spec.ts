import { groupShouldTrigger, mentionedNumbers, ownerNumber } from './group-trigger';

describe('groupShouldTrigger', () => {
  const own = '5511999990000';

  it('ignora conversa solta do grupo', () => {
    expect(groupShouldTrigger({ text: 'bom dia pessoal', ownNumber: own })).toBe(false);
    expect(groupShouldTrigger({ text: 'ok, obrigado!', ownNumber: own })).toBe(false);
  });

  it('responde número de pedido', () => {
    expect(groupShouldTrigger({ text: '142458', ownNumber: own })).toBe(true);
    expect(groupShouldTrigger({ text: 'e o #142458?', ownNumber: own })).toBe(true);
  });

  it('responde quando fala de pedido, status ou entrega', () => {
    expect(groupShouldTrigger({ text: 'qual o status do pedido da Maria?' })).toBe(true);
    expect(groupShouldTrigger({ text: 'já foi entregue?' })).toBe(true);
    expect(groupShouldTrigger({ text: 'tem rastreio?' })).toBe(true);
  });

  it('não confunde data, CEP, CPF ou telefone com pedido', () => {
    expect(groupShouldTrigger({ text: 'viajo 10/11/2026' })).toBe(false);
    expect(groupShouldTrigger({ text: 'cep 01310-100' })).toBe(false);
    expect(groupShouldTrigger({ text: 'meu cpf 123.456.789-00' })).toBe(false);
    expect(groupShouldTrigger({ text: 'liga (11) 98888-7777' })).toBe(false);
  });

  it('responde menção ao número conectado', () => {
    const raw = { message: { content: { contextInfo: { mentionedJID: [`${own}@s.whatsapp.net`] } } } };
    expect(groupShouldTrigger({ text: '@5511999990000 oi', rawPayload: raw, ownNumber: own })).toBe(true);
    expect(groupShouldTrigger({ text: 'oi @55 11 99999-0000', ownNumber: own })).toBe(true);
  });

  it('não responde menção a outra pessoa', () => {
    const raw = { message: { content: { contextInfo: { mentionedJID: ['5521988887777@s.whatsapp.net'] } } } };
    expect(groupShouldTrigger({ text: '@Fulano oi', rawPayload: raw, ownNumber: own })).toBe(false);
  });

  it('responde quem cita mensagem nossa', () => {
    expect(groupShouldTrigger({ text: 'e agora?', repliesToUs: true })).toBe(true);
  });
});

describe('ownerNumber / mentionedNumbers', () => {
  it('lê o dono da instância', () => {
    expect(ownerNumber({ owner: '5511999990000' })).toBe('5511999990000');
    expect(ownerNumber({ owner: { id: '5511999990000:12@s.whatsapp.net' } })).toBe('5511999990000');
    expect(ownerNumber({})).toBeNull();
  });

  it('acha menções em qualquer nível', () => {
    expect(mentionedNumbers({ a: { mentionedJid: ['5511999990000@s.whatsapp.net'] } })).toEqual(['5511999990000']);
    expect(mentionedNumbers({ a: { other: ['5511999990000@s.whatsapp.net'] } })).toEqual([]);
  });
});
