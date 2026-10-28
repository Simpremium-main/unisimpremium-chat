import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

import { AiCredentialsService, stripAiSecrets } from './ai-credentials.service';
import { parseModelId } from './llm.constants';
import { runWithLlmOrg } from './llm-context';
import { LlmService } from './llm.service';
import { LlmMessage } from './llm.types';
import { ModelRouterService } from '../runner/model-router.service';

/** Servidor HTTP falso no lugar das APIs da Anthropic e da OpenAI. */
interface Captured {
  path: string;
  headers: IncomingMessage['headers'];
  body: any;
}
let server: Server;
let captured: Captured[] = [];
let reply: (path: string, body: any) => unknown = () => ({});

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      captured.push({ path: req.url ?? '', headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply(req.url ?? '', body)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
});

afterAll(() => {
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.OPENAI_BASE_URL;
  server.close();
});

beforeEach(() => {
  captured = [];
});

/** Credenciais em memória: org-1 tem as duas chaves, org-2 só a da OpenAI. */
function fakeCredentials(defaults: Record<string, string | null> = {}): AiCredentialsService {
  const keys: Record<string, Partial<Record<'openai' | 'anthropic', string>>> = {
    'org-1': { openai: 'sk-openai', anthropic: 'sk-ant' },
    'org-2': { openai: 'sk-openai-2' },
    'org-3': {},
  };
  return {
    getApiKey: async (org: string | undefined, p: 'openai' | 'anthropic') => (org && keys[org]?.[p]) || null,
    getDefaultModel: async (org: string | undefined) => {
      if (!org) return null;
      if (org in defaults) return defaults[org];
      if (keys[org]?.anthropic) return 'anthropic/claude-haiku-5-5';
      if (keys[org]?.openai) return 'openai/gpt-5-mini';
      return null;
    },
  } as unknown as AiCredentialsService;
}

const anthropicText = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
  ...extra,
});

describe('parseModelId', () => {
  it('reconhece prefixos e IDs crus', () => {
    expect(parseModelId('anthropic/claude-opus-5-5')).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(parseModelId('openai/gpt-5')).toEqual({ provider: 'openai', model: 'gpt-5' });
    expect(parseModelId('claude-haiku-5-5')).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(parseModelId('gpt-4.1-mini')).toEqual({ provider: 'openai', model: 'gpt-4.1-mini' });
    expect(parseModelId('o3')).toEqual({ provider: 'openai', model: 'o3' });
  });

  it('devolve null para default, legado e vazio', () => {
    expect(parseModelId('default')).toBeNull();
    expect(parseModelId('sakana/fugu-ultra-20260615')).toBeNull();
    expect(parseModelId('fugu')).toBeNull();
    expect(parseModelId('')).toBeNull();
    expect(parseModelId(undefined)).toBeNull();
  });
});

describe('ModelRouterService', () => {
  const router = new ModelRouterService();
  const select = (modelId: string, modelParams: Record<string, unknown> | null, phase: 'tool' | 'synthesis', agentKind: 'WORKER' | 'ORCHESTRATOR' = 'WORKER') =>
    router.selectModel({ agentKind, modelId, modelParams, phase });

  it('sem routing usa o modelo do agente nas duas fases', () => {
    expect(select('anthropic/claude-sonnet-5-5', null, 'tool')).toBe('anthropic/claude-sonnet-5-5');
    expect(select('anthropic/claude-sonnet-5-5', null, 'synthesis')).toBe('anthropic/claude-sonnet-5-5');
  });

  it('routing.primary: tools no modelo barato, síntese de worker no do agente', () => {
    const params = { routing: { primary: 'anthropic/claude-haiku-5-5' } };
    expect(select('openai/gpt-5', params, 'tool')).toBe('anthropic/claude-haiku-5-5');
    expect(select('openai/gpt-5', params, 'synthesis')).toBe('openai/gpt-5');
    expect(select('openai/gpt-5', params, 'synthesis', 'ORCHESTRATOR')).toBe('anthropic/claude-haiku-5-5');
  });

  it('IDs legados viram `default` e não disparam síntese dupla', () => {
    const params = { routing: { primary: 'sakana/fugu' } };
    expect(select('sakana/fugu-ultra-20260615', params, 'tool')).toBe('default');
    expect(select('sakana/fugu-ultra-20260615', params, 'synthesis')).toBe('default');
  });
});

describe('LlmService.resolve', () => {
  const llm = new LlmService(fakeCredentials());

  it('usa o modelo pedido quando há chave', async () => {
    await expect(llm.resolve('openai/gpt-5', 'org-1')).resolves.toMatchObject({ provider: 'openai', model: 'gpt-5', apiKey: 'sk-openai' });
  });

  it('modelo de provedor sem chave cai no padrão da org', async () => {
    await expect(llm.resolve('anthropic/claude-opus-5-5', 'org-2')).resolves.toMatchObject({ provider: 'openai', model: 'gpt-5-mini' });
  });

  it('legado e `default` caem no padrão', async () => {
    await expect(llm.resolve('sakana/fugu', 'org-1')).resolves.toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    await expect(llm.resolve('default', 'org-1')).resolves.toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: 'sk-ant' });
  });

  it('sem chave nenhuma explica o que fazer', async () => {
    await expect(llm.resolve('default', 'org-3')).rejects.toThrow(/Configurações → IA/);
  });
});

describe('Claude (wire format)', () => {
  const llm = new LlmService(fakeCredentials());

  it('monta system com cache, junta tool_results e reenvia o turno cru', async () => {
    const rawAssistant = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { q: 'pedido' } },
      { type: 'tool_use', id: 'toolu_2', name: 'lookup', input: { q: 'frete' } },
    ];
    const messages: LlmMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'Regras fixas', cache: true }, { type: 'text', text: 'Contexto do dia' }] },
      { role: 'assistant', content: 'Olá! Como posso ajudar?' },
      { role: 'user', content: [{ type: 'text', text: 'Cadê meu pedido?' }, { type: 'image', url: 'https://x.test/a.png' }] },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'toolu_1', name: 'lookup', arguments: { q: 'pedido' } }],
        providerData: { provider: 'anthropic', content: rawAssistant },
      },
      { role: 'tool', toolCallId: 'toolu_1', name: 'lookup', content: 'enviado' },
      { role: 'tool', toolCallId: 'toolu_2', name: 'lookup', content: 'grátis' },
    ];
    reply = () => anthropicText('Seu pedido já foi enviado!');

    const res = await llm.complete({
      modelId: 'anthropic/claude-sonnet-5-5',
      organizationId: 'org-1',
      messages,
      tools: [{ name: 'lookup', description: 'Busca', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
      temperature: 0.7,
      maxTokens: 2048,
    });

    const req = captured[0];
    expect(req.path).toBe('/v1/messages?beta=true');
    expect(req.headers['x-api-key']).toBe('sk-ant');
    expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    const body = req.body;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(16000);
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system).toEqual([
      { type: 'text', text: 'Regras fixas', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Contexto do dia' },
    ]);
    expect(body.tools[0]).toEqual({ name: 'lookup', description: 'Busca', input_schema: { type: 'object', properties: { q: { type: 'string' } } } });
    // Começa com user (o histórico abria com a saudação do agente).
    expect(body.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(body.messages[2].content[1]).toEqual({ type: 'image', source: { type: 'url', url: 'https://x.test/a.png' } });
    // Turno do Claude volta exatamente como veio (thinking + os 2 tool_use).
    expect(body.messages[3].content).toEqual(rawAssistant);
    // Os dois resultados juntos numa única mensagem.
    expect(body.messages[4].content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'enviado' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: 'grátis' },
    ]);

    expect(res.message.content).toBe('Seu pedido já foi enviado!');
    expect(res.stopReason).toBe('stop');
    expect(res.rawModelId).toBe('anthropic/claude-sonnet-5-5');
    // input total = 1000 sem cache + 500 do cache; custo pela tabela do Sonnet 5.5.
    expect(res.usage.inputTokens).toBe(1500);
    expect(res.usage.costUsd).toBeCloseTo((1000 * 2 + 500 * 0.2 + 100 * 10) / 1e6, 10);
  });

  it('devolve tool calls e guarda o conteúdo cru (descartando o que veio antes de um fallback)', async () => {
    reply = () =>
      anthropicText('', {
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: '', signature: 'old' },
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
          { type: 'text', text: 'Vou verificar.' },
          { type: 'tool_use', id: 'toolu_9', name: 'lookup', input: { q: 'x' } },
        ],
      });
    const res = await llm.complete({ modelId: 'claude-opus-5-5', organizationId: 'org-1', messages: [{ role: 'user', content: 'oi' }] });
    expect(res.stopReason).toBe('tool_calls');
    expect(res.message.toolCalls).toEqual([{ id: 'toolu_9', name: 'lookup', arguments: { q: 'x' } }]);
    expect(res.message.providerData?.content).toEqual([
      { type: 'text', text: 'Vou verificar.' },
      { type: 'tool_use', id: 'toolu_9', name: 'lookup', input: { q: 'x' } },
    ]);
  });

  it('chamada curta (classificador) usa effort low; modelo sem fallback não manda o beta', async () => {
    reply = () => anthropicText('{"intent":"SALES"}', { model: 'claude-haiku-5-5' });
    await llm.complete({ modelId: 'default', organizationId: 'org-1', messages: [{ role: 'user', content: 'quero comprar' }], maxTokens: 200, temperature: 0 });
    const body = captured[0].body;
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.fallbacks).toBeUndefined();
    expect(captured[0].headers['anthropic-beta']).toBeUndefined();
  });

  it('pega a org do contexto (runWithLlmOrg)', async () => {
    reply = (path) => ({
      id: 'c1',
      object: 'chat.completion',
      model: 'gpt-5-mini',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
      path,
    });
    await runWithLlmOrg('org-2', () => llm.complete({ modelId: 'default', messages: [{ role: 'user', content: 'oi' }] }));
    expect(captured[0].path).toBe('/v1/chat/completions');
    expect(captured[0].headers.authorization).toBe('Bearer sk-openai-2');
  });
});

describe('ChatGPT (wire format)', () => {
  const llm = new LlmService(fakeCredentials());

  it('usa max_completion_tokens, sem temperatura em modelo de raciocínio, e prompt_cache_key', async () => {
    reply = () => ({
      id: 'c1',
      object: 'chat.completion',
      model: 'gpt-5-2025-08-07',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
          },
        },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 400 } },
    });

    const res = await llm.complete({
      modelId: 'openai/gpt-5',
      organizationId: 'org-1',
      messages: [
        { role: 'system', content: 'Você é um atendente.' },
        { role: 'user', content: 'oi' },
        // Turno anterior do Claude: a OpenAI ignora o conteúdo cru e usa texto + tool calls.
        {
          role: 'assistant',
          content: 'Vou ver',
          toolCalls: [{ id: 'toolu_1', name: 'lookup', arguments: { q: 'a' } }],
          providerData: { provider: 'anthropic', content: [{ type: 'thinking', thinking: '', signature: 's' }] },
        },
        { role: 'tool', toolCallId: 'toolu_1', name: 'lookup', content: 'achei' },
      ],
      tools: [{ name: 'lookup', description: 'Busca', parameters: { type: 'object', properties: {} } }],
      temperature: 0.7,
      maxTokens: 2048,
      cacheKey: 'conv:1',
    });

    const body = captured[0].body;
    expect(captured[0].headers.authorization).toBe('Bearer sk-openai');
    expect(body.model).toBe('gpt-5');
    expect(body.max_completion_tokens).toBe(16000);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.prompt_cache_key).toBe('conv:1');
    expect(body.messages[2]).toEqual({
      role: 'assistant',
      content: 'Vou ver',
      tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"a"}' } }],
    });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'toolu_1', content: 'achei' });

    expect(res.stopReason).toBe('tool_calls');
    expect(res.message.toolCalls).toEqual([{ id: 'call_1', name: 'lookup', arguments: { q: 'x' } }]);
    expect(res.usage.costUsd).toBeCloseTo((600 * 1.25 + 400 * 0.125 + 50 * 10) / 1e6, 10);
  });

  it('modelo comum mantém temperatura e o teto do agente', async () => {
    reply = () => ({
      id: 'c1',
      object: 'chat.completion',
      model: 'gpt-4.1-mini',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'oi' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    await llm.complete({ modelId: 'gpt-4.1-mini', organizationId: 'org-1', messages: [{ role: 'user', content: 'oi' }], temperature: 0.2, maxTokens: 300 });
    expect(captured[0].body.temperature).toBe(0.2);
    expect(captured[0].body.max_completion_tokens).toBe(300);
  });
});

describe('AiCredentialsService', () => {
  function makeService(env: Record<string, string> = {}) {
    let settings: any = {};
    const prisma = {
      organization: {
        findUnique: async () => ({ settings }),
        findUniqueOrThrow: async () => ({ settings }),
        update: async ({ data }: any) => {
          settings = data.settings;
        },
      },
      $transaction: async (fn: any) => fn(prisma),
      $queryRaw: async () => [],
    };
    const config = { get: (k: string) => ({ JWT_SECRET: 'segredo-de-teste', ...env })[k] };
    const svc = new AiCredentialsService(prisma as any, config as any);
    // Sem rede: toda chave "funciona" e enxerga um modelo.
    (svc as any).fetchModels = async (p: string) => [{ id: `${p}/x`, provider: p, label: 'x' }];
    return { svc, getSettings: () => settings };
  }

  it('cifra a chave, devolve só mascarada e decifra no uso', async () => {
    const { svc, getSettings } = makeService();
    const view = await svc.update('org-1', { anthropicKey: 'sk-ant-api03-abcdefghijklmnop1234' });
    expect(JSON.stringify(getSettings())).not.toContain('abcdefghijklmnop');
    expect(getSettings().ai.anthropicKey).toMatch(/^v1:/);
    expect(view.providers.anthropic).toEqual({ configured: true, source: 'organization', hint: 'sk-ant-…1234' });
    expect(view.effectiveDefaultModel).toBe('anthropic/claude-haiku-5-5');
    await expect(svc.getApiKey('org-1', 'anthropic')).resolves.toBe('sk-ant-api03-abcdefghijklmnop1234');
  });

  it('modelo padrão escolhido vale só se o provedor tiver chave', async () => {
    const { svc } = makeService({ OPENAI_API_KEY: 'sk-env' });
    let view = await svc.update('org-1', { defaultModel: 'claude-sonnet-5-5' });
    expect(view.defaultModel).toBe('anthropic/claude-sonnet-5-5');
    expect(view.effectiveDefaultModel).toBe('openai/gpt-5-mini');
    expect(view.providers.openai.source).toBe('env');
    view = await svc.update('org-1', { anthropicKey: 'sk-ant-1234567890' });
    expect(view.effectiveDefaultModel).toBe('anthropic/claude-sonnet-5-5');
    view = await svc.update('org-1', { anthropicKey: null, defaultModel: null });
    expect(view.providers.anthropic.configured).toBe(false);
    expect(view.defaultModel).toBeNull();
  });

  it('chave cifrada com outro segredo é ignorada (sem quebrar)', async () => {
    const { svc } = makeService();
    await svc.update('org-1', { openaiKey: 'sk-proj-1234567890' });
    (svc as any).cipherKey = Buffer.alloc(32, 7);
    (svc as any).settingsCache.clear();
    await expect(svc.getApiKey('org-1', 'openai')).resolves.toBeNull();
  });

  it('stripAiSecrets tira settings.ai da organização', () => {
    expect(stripAiSecrets({ id: 'o', settings: { ai: { openaiKey: 'v1:x' }, theme: 'x' } })).toEqual({ id: 'o', settings: { theme: 'x' } });
  });
});
