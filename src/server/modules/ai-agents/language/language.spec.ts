const store = new Map<string, string>();
jest.mock('../../../runtime/kv-store', () => ({
  KvStore: jest.fn().mockImplementation(() => ({
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => (store.set(k, v), true)),
  })),
}));
import { detectLanguage } from './customer-language';
import { FlowTranslatorService } from './flow-translator.service';

describe('idioma do cliente', () => {
  it('português é o padrão', () => {
    expect(detectLanguage(['Olá, tudo bem?', 'gostaria de um orçamento para chip virtual'])).toBe('pt');
    expect(detectLanguage(['ok'])).toBe('pt');
    expect(detectLanguage([''])).toBe('pt');
  });
  it('inglês e espanhol com evidência clara', () => {
    expect(detectLanguage(['Hello, I need a chip for my trip to Germany'])).toBe('en');
    expect(detectLanguage(['Hola, necesito un chip para mi viaje'])).toBe('es');
  });
  it('pedido explícito vale mesmo escrito em português (caso do Peter)', () => {
    expect(
      detectLanguage([
        'Olá, gostaria de atendimento\nEstou tentando adquirir meu plano, mas o sistema não reconhece o número do meu cartão de crédito.\nPodemos fazer isso em inglês, por favor?',
      ]),
    ).toBe('en');
    expect(detectLanguage(['Can we speak in English?'])).toBe('en');
    expect(detectLanguage(['¿Puede atenderme en español?'])).toBe('es');
  });
  it('o pedido mais recente vale; citar o idioma sem pedir não troca', () => {
    expect(detectLanguage(['Podemos falar em inglês?', 'Hello there', 'Pode voltar a falar em português, por favor'])).toBe('pt');
    expect(detectLanguage(['O site está em inglês e não entendi o checkout'])).toBe('pt');
  });

  it('conversa do Peter: fluxo do eSIM vai em inglês', () => {
    expect(
      detectLanguage([
        'Olá, gostaria de atendimento\nEstou tentando adquirir meu plano, mas o sistema não reconhece o número do meu cartão de crédito.\nPodemos fazer isso em inglês, por favor?',
        'i need a quotation for germany 10 days',
        'how do i know if my device accepts esim',
      ]),
    ).toBe('en');
  });
  it('trocou de idioma no meio (sem pedir): valem as últimas mensagens', () => {
    expect(
      detectLanguage([
        'Olá, estou com problema no meu chip, não funciona e já tentei de tudo, por favor me ajude',
        'hello, i need help with my order',
        'how can i check it',
        'thanks, what do i have to do now',
      ]),
    ).toBe('en');
  });

  it('uma palavra solta não troca o idioma', () => {
    expect(detectLanguage(['hi'])).toBe('pt');
  });
});

describe('tradução das mensagens fixas', () => {
  const setup = (reply: string) => {
    const llm = { complete: jest.fn(async () => ({ message: { role: 'assistant', content: reply } })) };
    const prisma = { aiAgent: { findUnique: jest.fn(async () => ({ modelId: 'gpt-5-mini' })) } };
    return { svc: new FlowTranslatorService(prisma as any, llm as any), llm };
  };
  const ctx = { organizationId: 'o', agentId: 'a' };

  beforeEach(() => store.clear());

  it('cliente em português: não chama a IA', async () => {
    const { svc, llm } = setup('[]');
    expect(await svc.translate(['Olá!'], 'pt', ctx)).toEqual(['Olá!']);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('traduz uma vez e reaproveita a tradução guardada', async () => {
    const { svc, llm } = setup('["To check if your phone supports eSIM, go to:"]');
    const texts = ['Para verificar se o seu aparelho é compatível com chip virtual, entre em:', ''];
    expect(await svc.translate(texts, 'en', ctx)).toEqual(['To check if your phone supports eSIM, go to:', '']);
    expect(await svc.translate(texts, 'en', ctx)).toEqual(['To check if your phone supports eSIM, go to:', '']);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('resposta inválida da IA: manda o original em português', async () => {
    const { svc } = setup('desculpe, não consegui');
    expect(await svc.translate(['Olá!'], 'en', ctx)).toEqual(['Olá!']);
  });
});
