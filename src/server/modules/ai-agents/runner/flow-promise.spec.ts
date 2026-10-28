import { alreadySent, pendingFlowSteps, reproduces } from './flow-promise';

const step = (id: string, type: 'TEXT' | 'IMAGE', content: string, caption: string | null = null) =>
  ({ id, type, content, caption }) as any;
const flow = (slug: string, steps: any[], instructions = '') => ({ slug, name: slug, steps, instructions }) as any;

const verificar = flow('verificar-esim', [
  step('s1', 'TEXT', 'Apenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar:'),
  step('s2', 'IMAGE', 'https://cdn/iphone-esim.png'),
  step('s3', 'IMAGE', 'https://cdn/android-esim.png'),
]);
const outro = flow('boas-vindas', [step('b1', 'TEXT', 'Olá! Seja bem-vindo à Simpremium, como posso ajudar hoje?'), step('b2', 'IMAGE', 'https://cdn/x.png')]);

describe('fluxo copiado na resposta sem enviar o fluxo', () => {
  it('casos dos logs: frase do fluxo (com ":" ou ".") no meio da resposta → manda as imagens que faltam', () => {
    for (const reply of [
      'Apenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar:',
      'Olá Gi! 👋\nObrigado por entrar em contato conosco da Simpremium\n\nApenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar.\n\nSobre as datas: …',
    ]) {
      const p = pendingFlowSteps([reply], [outro, verificar], new Set());
      expect(p?.playbook.slug).toBe('verificar-esim');
      expect(p?.steps.map((s) => s.id)).toEqual(['s2', 's3']);
    }
  });

  it('não dispara se o fluxo já foi enviado neste run, ou se a resposta não reproduz o fluxo', () => {
    const reply = 'Apenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar:';
    expect(pendingFlowSteps([reply], [verificar], new Set(['verificar-esim']))).toBeNull();
    expect(pendingFlowSteps(['Seu aparelho é compatível? Me conta o modelo.'], [verificar], new Set())).toBeNull();
    expect(pendingFlowSteps([''], [verificar], new Set())).toBeNull();
  });

  it('textos curtos não contam como cópia', () => {
    expect(reproduces('Olá, tudo bem?', 'Olá!')).toBe(false);
  });

  it('não reenvia o que já está entre as últimas mensagens da conversa', () => {
    const recent = [{ mediaUrl: 'https://cdn/iphone-esim.png' }, { text: 'oi' }];
    expect(alreadySent(verificar.steps[1], recent)).toBe(true);
    expect(alreadySent(verificar.steps[2], recent)).toBe(false);
    expect(alreadySent(verificar.steps[0], [{ text: verificar.steps[0].content }])).toBe(true);
  });
});

describe('fluxo copiado: a frase pode estar na legenda ou nas instruções', () => {
  const reply = 'Apenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar:';

  it('legenda da imagem reproduzida → manda as imagens (com a legenda)', () => {
    const f = flow('verificar-esim', [
      step('i1', 'IMAGE', 'https://cdn/a.png', reply),
      step('i2', 'IMAGE', 'https://cdn/b.png'),
    ]);
    expect(pendingFlowSteps([reply], [f], new Set())?.steps.map((s) => s.id)).toEqual(['i1', 'i2']);
  });

  it('frase entre aspas no "O que fazer" → manda o fluxo inteiro', () => {
    const f = flow('verificar-esim', [step('i1', 'IMAGE', 'https://cdn/a.png')], `Antes da cotação diga "${reply}" e envie as mensagens.`);
    expect(pendingFlowSteps([reply], [f], new Set())?.steps.map((s) => s.id)).toEqual(['i1']);
  });
});

describe('despedida da IA igual à última mensagem de um fluxo', () => {
  const resolvido = flow('suporte-resolvido', [
    step('r1', 'TEXT', 'Perfeito!\nSe precisar de algo, é só nos chamar!'),
    step('r2', 'TEXT', 'Desejamos uma ótima viagem!  💛'),
  ]);
  it('não manda as mensagens de antes (caso da Tainara: 2 despedidas)', () => {
    const reply = 'Combinado! Fico no aguardo quando quiser ativar. Desejamos uma ótima viagem! 💛';
    expect(pendingFlowSteps([reply], [resolvido], new Set())).toBeNull();
  });
});

describe('frase do prompt que anuncia o verificar-esim', () => {
  // Fluxo real: só o texto "Para verificar…"; a frase "Apenas confirmando…" está no prompt.
  const real = flow('verificar-esim', [
    step('v1', 'TEXT', 'Para verificar se o seu aparelho é compatível com chip virtual, entre em:\n- *iPhone*: Entre em Ajustes > Celular e veja se há a opção Adicionar eSIM.'),
  ]);
  const reply =
    'Sim, temos cobertura para Pequim (China), Hong Kong e Singapura.\nApenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar:';

  it('resposta anuncia o passo a passo e não chamou o fluxo → manda o fluxo (sempre, mesmo já enviado antes)', () => {
    const p = pendingFlowSteps([reply], [outro, real], new Set());
    expect(p?.steps.map((s) => s.id)).toEqual(['v1']);
    expect(p?.promised).toBe(true);
  });
  it('fluxo já enviado neste run, ou resposta sem a frase → nada', () => {
    expect(pendingFlowSteps([reply], [real], new Set(['verificar-esim']))).toBeNull();
    expect(pendingFlowSteps(['Sim, temos cobertura para a China.'], [real], new Set())).toBeNull();
  });
});

describe('cotação com o link do produto não é cópia do fluxo de apresentação', () => {
  const { reproduces } = require('./flow-promise');
  const quote =
    '*Preço por chip:* USD 38.25 / R$ 212.67\n\nPara detalhes do plano acesse: https://simpremium.com.br/produto/chip-fisico\nObs.: Temos também planos com franquia de dados à partir de R$ 61.44';
  it('mensagem do fluxo que é só um link não conta', () => {
    expect(reproduces(quote, 'E link do chip físico:\nhttps://simpremium.com.br/produto/chip-fisico')).toBe(false);
  });
  it('texto de verdade copiado continua contando', () => {
    expect(
      reproduces(
        'Apenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar:',
        'Apenas confirmando, o seu aparelho é compatível com eSIM, certo? Segue abaixo como verificar:',
      ),
    ).toBe(true);
  });
});
