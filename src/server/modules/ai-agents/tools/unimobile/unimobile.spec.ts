jest.mock('../../../../runtime/kv-store', () => ({
  KvStore: jest.fn().mockImplementation(() => {
    const m = new Map<string, string>();
    return {
      get: jest.fn(async (k: string) => m.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => (m.set(k, v), true)),
      del: jest.fn(async (k: string) => (m.delete(k) ? 1 : 0)),
    };
  }),
}));

import { UnimobileClient, UnimobileUnavailableError, partnerEnvKey } from './unimobile.client';
import { UnimobileToolsService, matchDevice } from './unimobile-tools.service';
import { canActivateNow, describeLine, isFullIccid, parseTariff, statusPt, withoutPrices, zonesCovering } from './unimobile-format';

const ICCID = '89012807332692737746';
const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] }) as any;
const ctx = { organizationId: 'o1', conversationId: 'c1', contactId: 'ct1', channelId: 'ch1', agentId: 'a1', runId: 'r1' };

function setup(responses: Record<string, unknown>, opts: { group?: boolean; partner?: string; vars?: Record<string, string> } = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown; auth: string }> = [];
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    const path = url.replace('https://api.test', '').split('?')[0];
    const body = responses[path];
    if (body === undefined) return { status: 404, text: async () => '<html>404</html>' } as any;
    return { status: 200, text: async () => JSON.stringify(body) } as any;
  });
  const client = new UnimobileClient(env({ UNIMOBILE_API_URL: 'https://api.test', UNIMOBILE_API_TOKEN: 'tok', UNIMOBILE_RESELLER_ID: '77', ...opts.vars }));
  const actions: any[] = [];
  const messages: any[] = [
    { id: 'm-ana', conversationId: 'c1', direction: 'INBOUND', senderName: 'Ana', content: { text: 'recarga 3gb' }, metadata: { rawPayload: { message: { sender_pn: '5511911110000@s.whatsapp.net' } } }, createdAt: new Date() },
  ];
  const prisma: any = {
    conversation: {
      findUnique: jest.fn(async () => ({
        isGroup: opts.group ?? true,
        metadata: opts.partner ? { groupPartner: opts.partner } : {},
        organizationId: 'o1',
        contactId: 'ct1',
        channelId: 'ch1',
      })),
    },
    aiAgent: { findUnique: jest.fn(async () => ({ name: 'Uni' })) },
    aiAgentRun: { findFirst: jest.fn(async () => ({ id: 'r1', agentId: 'a1' })) },
    message: {
      findMany: jest.fn(async () => messages),
      findUnique: jest.fn(async ({ where }: any) => messages.find((m) => m.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => messages.find((m) => m.externalId === where.externalId && m.direction === where.direction) ?? null),
    },
    aiPendingAction: {
      findFirst: jest.fn(async ({ where }: any) =>
        actions.find((x) => x.conversationId === where.conversationId && x.preview?.code === where.preview.equals) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        actions.filter((x) => x.conversationId === where.conversationId && x.status === 'PENDING' && x.expiresAt > new Date()),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pa${actions.length + 1}`, status: 'PENDING', createdAt: new Date(), ...data };
        actions.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = actions.find((x) => x.id === where.id && x.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(actions.find((x) => x.id === where.id), data)),
    },
  };
  const sender: any = { contactExternalId: jest.fn(async () => 'g@g.us'), send: jest.fn(async () => ({})) };
  const svc = new UnimobileToolsService(prisma, client, sender);
  const run = (name: string, input: Record<string, unknown>) => svc.tools.find((t) => t.name === name)!.execute(input, { ...ctx, triggerMessageId: 'm-ana' });
  const inbound = (id: string, text: string, from: string, extra: Record<string, unknown> = {}) => {
    messages.push({ id, conversationId: 'c1', direction: 'INBOUND', senderName: from, content: { text }, metadata: { rawPayload: { message: { sender_pn: from === 'Ana' ? '5511911110000@s.whatsapp.net' : '5511922220000@s.whatsapp.net' } }, ...extra }, createdAt: new Date() });
    return svc.handleConfirmation(id);
  };
  const sent = () => sender.send.mock.calls.map((c: any[]) => c[2].text as string);
  return { svc, run, calls, sender, actions, messages, inbound, sent };
}

const detail = {
  Result: 'Ok',
  Data: [{
    iccid: ICCID,
    status: 'Activado',
    'client data': [{ name: 'Peter', email: 'p@x.com', tariff: 'USA 50Gb 30 Dias' }],
    esim: [{ number: '7862397452', lpaCode: 'LPA:1$X$Y', iosQuickInstall: 'https://esimsetup.apple.com/x' }],
  }],
};

describe('formatação Uni Mobile', () => {
  it('status, tarifa, ICCID e datas', () => {
    expect(statusPt('Pendiente').status).toBe('pendente');
    expect(statusPt('Activo').status).toBe('ativa');
    expect(statusPt('Baja').status).toBe('encerrada');
    expect(parseTariff('EUR_017D_ILIM_SODA_UNIG_ESIM')).toEqual({ zona: 'EUR', dias: 17, franquia: 'Ilimitado', tipo: 'ESIM' });
    expect(isFullIccid('8901 2807 3326 9273 7746')).toBe(true);
    expect(isFullIccid('4815')).toBe(false);
    expect(canActivateNow('2026-10-29', '2026-10-30')).toBe(true);
    expect(canActivateNow('2026-10-27', '2026-10-30')).toBe(false);
    expect(partnerEnvKey('Viagens Álfa')).toBe('VIAGENS_ALFA');
  });

  it('em grupo não leva titular nem código de instalação', () => {
    const group = describeLine(detail.Data[0], null, { group: true });
    expect(group).toMatchObject({ iccid: ICCID, status: 'ativa', plano: 'USA 50Gb 30 Dias', numero: '7862397452' });
    expect(JSON.stringify(group)).not.toMatch(/Peter|p@x\.com|LPA|esimsetup/);
    const priv = describeLine(detail.Data[0], null, { group: false });
    expect(priv).toMatchObject({ titular: 'Peter', instalacao: { codigo_lpa: 'LPA:1$X$Y' } });
  });

  it('data de início e fim pelo ordersList', () => {
    const l = describeLine({ iccid: ICCID, status: 'Pendiente' }, { iccId: ICCID, tariff: 'EUR_017D_ILIM_SODA_UNIG_ESIM', init_date: '2026-11-01' }, { group: true });
    expect(l).toMatchObject({ status: 'pendente', inicio: '01/11/2026', fim_previsto: '17/11/2026', dias: 17 });
  });

  it('sem preço, cobertura e compatibilidade', () => {
    expect(withoutPrices([{ title: 'x', price: 9, currency: 'USD' }])).toEqual([{ title: 'x' }]);
    const zones = [{ zone_code: 'EUR', zone_name_br: 'Europa', countries_data: [{ country_br: 'Itália', iso_code: 'IT' }] }];
    expect(zonesCovering(zones, 'italia')).toHaveLength(1);
    expect(zonesCovering(zones, 'Japão')).toHaveLength(0);
    const list = [{ brand: 'Apple', models: ['iPhone 15'] }];
    expect(matchDevice(list, 'Apple iPhone 15')).toMatchObject({ compativel: true });
    expect(matchDevice(list, 'iPhone 7')).toMatchObject({ compativel: false });
  });
});

describe('ferramentas Uni Mobile', () => {
  it('consulta pelo ICCID completo, sem dados do titular no grupo', async () => {
    const { run, calls } = setup({ [`/orders/iccidDetail/${ICCID}`]: detail });
    const out: any = (await run('uni_consultar_linha', { iccid: '8901 2807 3326 9273 7746' })).output;
    expect(out).toMatchObject({ encontrado: true, linhas: [{ status: 'ativa', plano: 'USA 50Gb 30 Dias' }] });
    expect(JSON.stringify(out)).not.toMatch(/Peter|LPA/);
    expect(calls[0].auth).toBe('Bearer tok');
  });

  it('busca por e-mail cai em aviso quando ordersList não existe', async () => {
    const { run } = setup({});
    const out: any = (await run('uni_consultar_linha', { email: 'a@b.com' })).output;
    expect(out.encontrado).toBe(false);
    expect(out.aviso).toMatch(/não está disponível/);
  });

  it('busca pelo final do ICCID no ordersList', async () => {
    const { run } = setup({
      '/orders/ordersList': { Result: 'Ok', Data: [{ iccId: ICCID, email: 'a@b.com', tariff: 'USA_030D_50GB_SODA_UNIG_ESIM', init_date: '2026-10-20', status: 'Activado' }] },
      [`/orders/iccidDetail/${ICCID}`]: detail,
    });
    const out: any = (await run('uni_consultar_linha', { final_iccid: '7746' })).output;
    expect(out).toMatchObject({ encontrado: true, quantidade: 1, linhas: [{ iccid: ICCID, inicio: '20/10/2026' }] });
  });

  it('ação manda código no grupo e não executa nada antes da confirmação', async () => {
    const { run, calls, actions, sent } = setup({});
    const out: any = (await run('uni_recarregar', { iccid: ICCID, gb: 3, solicitante: 'Ana' })).output;
    expect(out).toMatchObject({ ok: true, status: 'aguardando_confirmacao' });
    expect(calls).toHaveLength(0);
    expect(actions[0]).toMatchObject({ toolName: 'uni_recarregar', args: { iccid: ICCID, gb: 3 } });
    expect(actions[0].preview).toMatchObject({ code: out.codigo, requesterName: 'Ana', requestMessageId: 'm-ana', requesterKey: '5511911110000' });
    expect(sent()[0]).toContain(`SIM ${out.codigo}`);
  });

  it('"SIM <código>" de quem pediu executa na API e avisa', async () => {
    const { run, calls, actions, inbound, sent } = setup({ [`/orders/topup/${ICCID}`]: { Result: 'Ok', Message: 'Topup applied successfully' } });
    const { codigo } = (await run('uni_recarregar', { iccid: ICCID, gb: 3, solicitante: 'Ana' })).output as any;
    expect(await inbound('m2', `sim ${codigo}`, 'Ana')).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'POST', body: { reseller_id: 77, topUp: 3 } });
    expect(actions[0].status).toBe('EXECUTED');
    expect(sent().at(-1)).toMatch(/Recarga de 3 GB.*concluído/);
    // Repetir o código não executa de novo.
    expect(await inbound('m3', `SIM ${codigo}`, 'Ana')).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('10 solicitações: cada código executa só a sua', async () => {
    const { run, calls, inbound } = setup({ '/orders/sendEmail': { Result: 'Ok' } });
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const iccid = `8901280733269273${String(7700 + i)}`;
      codes.push(((await run('uni_reenviar_email', { iccid, solicitante: 'Ana' })).output as any).codigo);
    }
    expect(new Set(codes).size).toBe(10);
    await inbound('m9', `SIM ${codes[6]}`, 'Ana');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ iccId: '89012807332692737706' });
  });

  it('confirmação de outra pessoa não vale', async () => {
    const { run, calls, inbound, sent } = setup({ '/orders/activateLine': { Result: 'Ok' } });
    const { codigo } = (await run('uni_ativar_linha', { iccid: ICCID, solicitante: 'Ana' })).output as any;
    expect(await inbound('m2', `SIM ${codigo}`, 'Bruno')).toBe(true);
    expect(calls).toHaveLength(0);
    expect(sent().at(-1)).toMatch(/Só Ana pode confirmar/);
  });

  it('"sim" citando a mensagem do código também confirma', async () => {
    const { run, calls, messages, inbound } = setup({ '/orders/sendEmail': { Result: 'Ok' } });
    const { codigo } = (await run('uni_reenviar_email', { iccid: ICCID, solicitante: 'Ana' })).output as any;
    messages.push({ id: 'out1', conversationId: 'c1', direction: 'OUTBOUND', externalId: 'ext-1', content: { text: `🔐 ... responda *SIM ${codigo}*` } });
    expect(await inbound('m2', 'sim', 'Ana', { replyTo: { externalMessageId: 'ext-1' } })).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('sem solicitação aberta, "sim 1234" segue para a IA; código errado é avisado', async () => {
    const { run, inbound, sent } = setup({});
    expect(await inbound('m1', 'sim 1234', 'Ana')).toBe(false);
    await run('uni_reenviar_email', { iccid: ICCID, solicitante: 'Ana' });
    expect(await inbound('m2', 'sim 0000', 'Ana')).toBe(true);
    expect(sent().at(-1)).toMatch(/Não encontrei/);
  });

  it('falha da API marca como falhou e avisa no grupo', async () => {
    const { run, actions, inbound, sent } = setup({ '/orders/cancelOrder': { Result: 'Error', Message: 'IccId not found, not pending or active or has been active for more than 3 days.' } });
    const { codigo } = (await run('uni_cancelar_pedido', { iccid: ICCID, solicitante: 'Ana' })).output as any;
    await inbound('m2', `SIM ${codigo}`, 'Ana');
    expect(actions[0].status).toBe('REJECTED');
    expect(actions[0].rejectedReason).toMatch(/3 days/);
    expect(sent().at(-1)).toMatch(/não foi possível/);
  });

  it('valida antes de pedir confirmação', async () => {
    const { run, actions } = setup({});
    expect(((await run('uni_recarregar', { iccid: ICCID, gb: 2 })).output as any).ok).toBe(false);
    expect(((await run('uni_criar_pedido', { tipo: 'esim', tarifa: 'EUR_017D_ILIM_SODA_UNIG_CHIP', data_inicio: '2099-01-01', nome: 'Ana Silva', email: 'a@b.com', documento: '12345' })).output as any).instrucao).toMatch(/ESIM/);
    expect(actions).toHaveLength(0);
  });

  it('token do parceiro do grupo', async () => {
    const { run, calls } = setup({ [`/orders/iccidDetail/${ICCID}`]: detail }, { partner: 'Viagens Alfa', vars: { UNIMOBILE_TOKEN_VIAGENS_ALFA: 'tok-alfa' } });
    await run('uni_consultar_linha', { iccid: ICCID });
    expect(calls[0].auth).toBe('Bearer tok-alfa');
  });

  it('catálogo ausente vira aviso para a IA', async () => {
    const { run } = setup({});
    expect(((await run('uni_planos', { zona: 'EUR' })).output as any)).toMatchObject({ disponivel: false });
  });

  it('endpoint ausente vira UnimobileUnavailableError', async () => {
    setup({});
    const client = new UnimobileClient(env({ UNIMOBILE_API_URL: 'https://api.test', UNIMOBILE_API_TOKEN: 'tok' }));
    await expect(client.request(client.credentials(), 'GET', '/catalog/plans')).rejects.toBeInstanceOf(UnimobileUnavailableError);
  });
});
