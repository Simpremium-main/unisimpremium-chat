import { announcedAction, isTransferPromise, repliedSinceLastCustomerMessage, spokeWithoutNewInfo } from './agent-runner.service';
import { isToolCallFailure } from '../agents/agents.service';

const reply = (text: string) => ({ name: 'replyToConversation', arguments: { text } });

describe('announcedAction', () => {
  it('detecta promessa de ação ainda não feita', () => {
    expect(
      announcedAction([reply('Vou localizar o seu pedido 142434 pelo CPF informado para verificar a ativação.')]),
    ).toBe('Vou localizar o seu pedido 142434 pelo CPF informado para verificar a ativação');
    expect(announcedAction([reply('Certo! Deixa eu verificar aqui pra você')])).toBe('Deixa eu verificar aqui pra você');
  });

  it('detecta promessa de envio/encaminhamento (instruções, equipe)', () => {
    expect(announcedAction([reply('Vou enviar as instruções de roaming para iPhone agora.')])).toBe(
      'Vou enviar as instruções de roaming para iPhone agora',
    );
    expect(announcedAction([reply('Certo, vou te encaminhar para nossa equipe especializada!')])).toBe(
      'vou te encaminhar para nossa equipe especializada',
    );
    expect(announcedAction([reply('Já te envio o passo a passo')])).toBe('Já te envio o passo a passo');
  });

  it('gerúndio também é promessa ("Encaminhando seu caso…", "estou verificando")', () => {
    expect(
      announcedAction([reply('Entendi. Encaminhando seu caso para o suporte verificar o envio do eSIM, pois a ativação já começou.')]),
    ).toBe('Encaminhando seu caso para o suporte verificar o envio do eSIM, pois a ativação já começou');
    expect(announcedAction([reply('Certo, estou verificando aqui')])).toBe('estou verificando aqui');
    expect(announcedAction([reply('Vou transferir você para o setor responsável.')])).toBe('Vou transferir você para o setor responsável');
  });

  it('presente no começo da frase ("Encaminho para o suporte agora")', () => {
    expect(
      announcedAction([reply('Perfeito. Encaminho para o suporte agora para que verifiquem o envio e reenviem o QR Code.')]),
    ).toBe('Encaminho para o suporte agora para que verifiquem o envio e reenviem o QR Code');
    expect(isTransferPromise('Encaminho para o suporte agora')).toBe(true);
    expect(announcedAction([reply('O envio do eSIM é feito por e-mail. Passo a passo abaixo.')])).toBeNull();
  });

  it('promessa de transferência (cai na transferência forçada se repetir)', () => {
    expect(isTransferPromise('Encaminhando seu atendimento ao suporte agora')).toBe(true);
    expect(isTransferPromise('vou te transferir para o setor responsável')).toBe(true);
    expect(isTransferPromise('Vou verificar a ativação do pedido')).toBe(false);
  });

  it('ignora respostas sem promessa e outras ferramentas', () => {
    expect(announcedAction([reply('Encontrei o pedido 142434. A ativação está programada de 10/11 a 03/12.')])).toBeNull();
    expect(announcedAction([{ name: 'addInternalNote', arguments: { content: 'vou verificar' } }])).toBeNull();
  });
});

describe('fim do turno depois de falar com o cliente', () => {
  it('instruções de roaming (mesmo seguidas de nota interna) encerram o turno', () => {
    expect(
      spokeWithoutNewInfo([
        { toolName: 'enviar_instrucoes_roaming', output: { ok: true, mensagensEnviadas: 9 } },
        { toolName: 'addInternalNote', output: { ok: true } },
      ]),
    ).toBe(true);
  });

  it('consulta depois de falar traz informação nova: o turno continua', () => {
    expect(
      spokeWithoutNewInfo([
        { toolName: 'replyToConversation', output: { ok: true } },
        { toolName: 'consultar_pedido', output: '...' },
      ]),
    ).toBe(false);
  });
});

describe('alerta de falha de skill', () => {
  it('trava de regra (pedir CPF, perguntar modelo) não é falha', () => {
    expect(isToolCallFailure({ error: null, output: { ok: false, guard: true, instrucao: 'peça o CPF' } })).toBe(false);
    expect(isToolCallFailure({ error: null, output: { ok: false, error: 'Pedido Central falhou (500)' } })).toBe(true);
  });
});

describe('não responde de novo o que já foi respondido', () => {
  const inb = { direction: 'INBOUND', metadata: {} };
  const ia = { direction: 'OUTBOUND', metadata: { aiAgentId: 'a' } };
  const bot = { direction: 'OUTBOUND', metadata: { chatbotFlowId: 'f' } };

  it('follow-up depois da IA já ter respondido "Comprei chip / Quero saber se está ok": pula', () => {
    expect(repliedSinceLastCustomerMessage([ia, inb, inb])).toBe(true);
  });
  it('cliente mandou algo depois da resposta: responde', () => {
    expect(repliedSinceLastCustomerMessage([inb, ia, inb])).toBe(false);
  });
  it('robô terminou e passou pra IA: a mensagem do robô não conta', () => {
    expect(repliedSinceLastCustomerMessage([bot, bot, inb])).toBe(false);
  });
});

describe('fechar pelo WhatsApp', () => {
  const { wantsToCloseOnWhatsapp } = require('../tools/simpremium/quote-plans');
  const { announcedAction, isClosingPromise } = require('./agent-runner.service');

  it('reconhece o pedido de fechar aqui', () => {
    expect(wantsToCloseOnWhatsapp('quero fechar por aqui, duvidas')).toBe(true);
    expect(wantsToCloseOnWhatsapp('Pode ser pelo whats')).toBe(false);
    expect(wantsToCloseOnWhatsapp('pelo whatsapp')).toBe(true);
    expect(wantsToCloseOnWhatsapp('vou pagar no pix')).toBe(true);
    expect(wantsToCloseOnWhatsapp('não quero fechar agora')).toBe(false);
    expect(wantsToCloseOnWhatsapp('O plano é ilimitado?')).toBe(false);
  });

  it('"Vou finalizar seu pedido pelo WhatsApp agora" é promessa de fechamento', () => {
    const p = announcedAction([
      { name: 'replyToConversation', arguments: { text: 'O WhatsApp não muda.\n...\nÓtimo. Vou finalizar seu pedido pelo WhatsApp agora.' } },
    ]);
    expect(p).toMatch(/Vou finalizar seu pedido/);
    expect(isClosingPromise(p)).toBe(true);
    expect(isClosingPromise('Vou encaminhar para o suporte')).toBe(false);
  });
});
