import { asksSeveralScreens, manualNetworkExplainedTooEarly } from './text-guards';

describe('uma tela por mensagem', () => {
  it('pedidos de mais de uma tela (caso do pedido 142245)', () => {
    for (const t of [
      'Peça, por favor, um print da tela *Ajustes > Celular* mostrando as linhas e outro print da tela do nosso chip com o *Roaming de Dados* ativado. Envie uma tela por mensagem.',
      'Pode me mandar dois prints: a tela das linhas e a do roaming?',
      'Me envie os prints das telas de configuração, por favor.',
      'Manda um print da tela Ajustes > Celular e outra da linha do nosso chip.',
      'Depois me mande uma segunda tela com o Roaming de Dados.',
    ]) {
      expect([t, asksSeveralScreens(t)]).toEqual([t, true]);
    }
  });

  it('uma tela só, ou sem pedido de print', () => {
    for (const t of [
      'Pode me mandar um print da tela *Ajustes > Celular*?',
      'Agora, pode me mandar um print da tela da linha do nosso chip mostrando o *Roaming de Dados*?',
      'Recebi o print. Nessa tela, toque em *Seleção de Rede* e desative o *Automático*.',
      'O seu eSIM será enviado por e-mail amanhã até as 10:59.',
    ]) {
      expect([t, asksSeveralScreens(t)]).toEqual([t, false]);
    }
  });
});

describe('explicação da seleção manual da operadora só depois de funcionar', () => {
  const explanation =
    'O seu aparelho pode conectar automaticamente numa operadora com a qual o chip não tem parceria ou que está com instabilidade na região em que você está. Por isso, com esse passo, fazemos a alteração manual da operadora.';
  it('junto do pedido para fazer a seleção (caso do Rubem): barra', () => {
    const t = `Nessa mesma tela da linha do nosso chip, toque em *Seleção de Rede*, desative o *Automático* e teste as opções.\n...\n${explanation}`;
    expect(manualNetworkExplainedTooEarly(t)).toBe(true);
  });
  it('sozinha (cliente já confirmou) ou só o pedido: passa', () => {
    expect(manualNetworkExplainedTooEarly(explanation)).toBe(false);
    expect(
      manualNetworkExplainedTooEarly('Toque em *Seleção de Rede*, desative o *Automático* e teste as opções. Conseguiu conectar em alguma operadora?'),
    ).toBe(false);
  });
});
