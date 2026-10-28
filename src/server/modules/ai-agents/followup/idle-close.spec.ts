import { decideIdleClose, isAcknowledgment } from './idle-close';
import { FollowupMessage } from './quote-followup';

const t0 = new Date('2026-10-27T22:14:11Z');
const min = (n: number) => new Date(t0.getTime() + n * 60_000);
let seq = 0;
const inb = (text: string, at = t0): FollowupMessage => ({ id: `m${seq++}`, direction: 'INBOUND', text, createdAt: at });
const ai = (text: string, at = t0): FollowupMessage => ({
  id: `m${seq++}`,
  direction: 'OUTBOUND',
  text,
  createdAt: at,
  aiAgentId: 'agent-1',
});

describe('encerramento da dúvida respondida (5 min sem mensagem do cliente)', () => {
  // Caso da Lina: pergunta sobre rotear, a IA respondeu sem pergunta pendente.
  const lina = [
    inb('Rotear com uma pessoa que está ao meu lado com outro celular'),
    ai('Sim. Você pode compartilhar a internet do seu eSIM ativando o ponto de acesso (hotspot) do seu celular.'),
    ai('No iPhone: Ajustes > Ponto de Acesso Pessoal.'),
  ];

  it('5 min depois da resposta: encerra com a mensagem', () => {
    expect(decideIdleClose(lina, min(5))).toMatchObject({ close: true, agentId: 'agent-1', sendMessage: true });
  });
  it('antes de 5 min, ou muito depois (deploy/fila parada): não', () => {
    expect(decideIdleClose(lina, min(4))).toEqual({ close: false, reason: 'ainda-nao' });
    expect(decideIdleClose(lina, min(40))).toEqual({ close: false, reason: 'atrasado-demais' });
  });
  it('resposta com pergunta para o cliente: não encerra', () => {
    const msgs = [inb('Roteamento'), ai('Você quer saber sobre compartilhar a internet do eSIM via hotspot ou migrar o eSIM?')];
    expect(decideIdleClose(msgs, min(6))).toEqual({ close: false, reason: 'pergunta-pendente' });
  });
  it('pedido de retorno sem "?": não encerra (caso do Rubem, seleção manual da operadora)', () => {
    for (const ask of [
      'Nessa mesma tela, toque em *Seleção de Rede* e teste as operadoras.\n\nDepois me diga se alguma operadora conectou.',
      'Me envie o print da tela *Ajustes > Celular*, por favor.',
      'Fico no aguardo do seu retorno.',
    ]) {
      expect(decideIdleClose([inb('estou sem sinal'), ai(ask)], min(6))).toEqual({ close: false, reason: 'pergunta-pendente' });
    }
  });
  it('cliente relatou problema (internet lenta, sem internet): não encerra como dúvida', () => {
    for (const t of ['a internet está muito lenta', 'estou sem internet', 'o chip não funciona', 'está caindo toda hora']) {
      expect(decideIdleClose([inb(t), ai('Entendi. Vamos verificar as configurações.')], min(6))).toEqual({ close: false, reason: 'suporte' });
    }
  });
  it('"?" dentro de um link não é pergunta', () => {
    const msgs = [inb('como instalo?'), ai('Veja o vídeo: https://simpremium.com.br/o-que-e-e-sim?utm=x')];
    expect(decideIdleClose(msgs, min(6))).toMatchObject({ close: true });
  });
  it('cliente falou por último, atendente respondeu, transferência ou cotação: não', () => {
    expect(decideIdleClose([...lina, inb('e no Android?')], min(6))).toEqual({ close: false, reason: 'ultima-nao-e-da-ia' });
    const human = { ...ai('Oi, aqui é o Pedro.'), aiAgentId: null };
    expect(decideIdleClose([inb('oi'), human], min(6))).toEqual({ close: false, reason: 'ultima-nao-e-da-ia' });
    expect(decideIdleClose([inb('oi'), human, ai('Segue.')], min(6))).toEqual({ close: false, reason: 'atendente' });
    expect(
      decideIdleClose([inb('quero falar com alguém'), ai('Vou transferir seu atendimento para o setor responsável.')], min(6)),
    ).toEqual({ close: false, reason: 'transferido' });
    const quote = ai('*Preço por chip:* USD 38.25 / R$ 212.67');
    expect(decideIdleClose([inb('cotação Itália'), quote, inb('obrigado'), ai('Por nada!')], min(6))).toEqual({
      close: false,
      reason: 'cotacao',
    });
  });
  it('a IA já se despediu: encerra sem mandar outra mensagem', () => {
    expect(decideIdleClose([inb('ok, obrigado'), ai('Por nada! Desejamos uma ótima viagem! 💛')], min(5))).toMatchObject({
      close: true,
      sendMessage: false,
    });
  });
});

describe('cliente só agradeceu', () => {
  it('agradecimentos e confirmações', () => {
    for (const t of ['ok', 'Ok, obrigado', 'Obrigada!!', 'valeu 🙏', '👍', 'Muito obrigado pela ajuda', 'blz, obg', 'Perfeito, obrigado e boa noite']) {
      expect([t, isAcknowledgment(t)]).toEqual([t, true]);
    }
  });
  it('pergunta nova, cumprimento ou texto vazio não', () => {
    for (const t of ['ok, e o frete?', 'Boa noite', 'obrigado, mas não chegou o QR code', 'como faço a ativação?', '']) {
      expect([t, isAcknowledgment(t)]).toEqual([t, false]);
    }
  });
});
