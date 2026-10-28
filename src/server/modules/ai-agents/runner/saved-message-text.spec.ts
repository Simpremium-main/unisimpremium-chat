import { savedMessageText } from './agent-runner.service';

describe('savedMessageText', () => {
  it('lê o texto salvo como { text }', () => {
    expect(savedMessageText({ text: ' Quero comprar um pacote para os EUA ' })).toBe(
      'Quero comprar um pacote para os EUA',
    );
  });
  it('lê a legenda de mídia', () => {
    expect(savedMessageText({ url: 'x', caption: 'meu print' })).toBe('meu print');
  });
  it('string e array de blocos', () => {
    expect(savedMessageText('oi')).toBe('oi');
    expect(savedMessageText([{ text: 'a' }, { text: 'b' }])).toBe('ab');
  });
  it('sem texto → vazio', () => {
    expect(savedMessageText(null)).toBe('');
    expect(savedMessageText({ url: 'x' })).toBe('');
  });
});

describe('nota interna não vai pro cliente', () => {
  const { sanitizeAssistantText } = require('./text-guards');
  it('descarta texto todo entre parênteses e "o usuário enviou"', () => {
    expect(sanitizeAssistantText('(respondendo pelo sistema: o usuário enviou novas mensagens)')).toBe('');
    expect(sanitizeAssistantText('O usuário enviou o número do pedido.')).toBe('');
  });
  it('resposta normal com parênteses no meio passa', () => {
    const t = 'Encontrei seu pedido 142727 (chip virtual), ativo de 27/10 a 12/11.';
    expect(sanitizeAssistantText(t)).toBe(t);
  });
});

describe('sem travessão nas respostas', () => {
  const { humanizeDashes } = require('./text-guards');
  it('troca travessão por vírgula e intervalo por "a"', () => {
    expect(humanizeDashes('Perfeito — parceria como *Influencer*.')).toBe('Perfeito, parceria como *Influencer*.');
    expect(humanizeDashes('responde por e-mail em até 24–48h.')).toBe('responde por e-mail em até 24 a 48h.');
    expect(humanizeDashes('a partir de 10 mil seguidores — cada caso é analisado.')).toBe('a partir de 10 mil seguidores, cada caso é analisado.');
  });
  it('mantém hífen comum e listas', () => {
    const t = 'Envie o e-mail.\n- *iPhone*: Ajustes\n- *Samsung*: Configurações\nDatas: 29/10/2026 - 03/11/2026';
    expect(humanizeDashes(t)).toBe(t);
  });
});
