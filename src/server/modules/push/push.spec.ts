jest.mock('../../runtime/kv-store', () => ({ KvStore: jest.fn().mockImplementation(() => ({})) }));
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));

import * as webpush from 'web-push';
import { InboxPushProcessor, messagePreview } from './inbox-push.processor';
import { PushService } from './push.service';
import { InboxViewsService } from '../inbox-views/inbox-views.service';
import { inboxPushJob } from './inbox-push.job';

const config = (env: Record<string, string>) => ({ get: (k: string) => env[k] }) as any;

describe('push no celular: envio', () => {
  const sub = { id: 's1', endpoint: 'https://push/1', p256dhKey: 'p', authKey: 'a' };

  it('sem chaves VAPID fica desligado e não envia', async () => {
    const prisma: any = { pushSubscription: { findMany: jest.fn() } };
    const svc = new PushService(prisma, config({}));
    expect(svc.config()).toEqual({ enabled: false, publicKey: null });
    expect(await svc.sendToUser('u1', { title: 't', body: 'b', url: '/', badge: 1 })).toBe(0);
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it('aparelho expirado (410) é removido; os outros recebem', async () => {
    const prisma: any = {
      pushSubscription: {
        findMany: jest.fn(async () => [sub, { ...sub, id: 's2', endpoint: 'https://push/2' }]),
        delete: jest.fn(async () => ({})),
      },
    };
    (webpush.sendNotification as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockResolvedValueOnce({});
    const svc = new PushService(prisma, config({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }));
    const sent = await svc.sendToUser('u1', { title: 't', body: 'b', url: '/inbox', badge: 3, tag: 'conv-c1' });
    expect(sent).toBe(1);
    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    const [, body, opts] = (webpush.sendNotification as jest.Mock).mock.calls[0];
    expect(JSON.parse(body)).toMatchObject({ badge: 3, url: '/inbox' });
    expect(opts).toEqual({ TTL: 3600, urgency: 'high' });
  });
});

describe('push no celular: quem recebe', () => {
  function setup(opts: { summary?: any; access?: any } = {}) {
    const prisma: any = {
      conversation: {
        findFirst: jest.fn(async () => ({ channelId: 'ch1', contact: { name: 'Ana Souza', phone: '+5511' } })),
      },
      message: { findFirst: jest.fn(async () => ({ type: 'TEXT', content: { text: 'Oi, meu chip não\nconecta' } })) },
    };
    const push: any = {
      isEnabled: true,
      subscribedMembers: jest.fn(async () => [
        { id: 'uo1', userId: 'u1', role: 'AGENT' },
        { id: 'uo2', userId: 'u2', role: 'ADMIN' },
      ]),
      sendToUser: jest.fn(async () => 1),
    };
    const inboxViews: any = {
      pushSummary: jest.fn(async () => opts.summary ?? { total: 4, view: { id: 'v9', name: 'Não respondidas' } }),
    };
    const channelAccess: any = {
      getAccessibleChannelIds: jest.fn(async (uoId: string) =>
        opts.access ? opts.access(uoId) : uoId === 'uo1' ? new Set(['outro']) : 'ALL',
      ),
    };
    return { proc: new InboxPushProcessor(prisma, push, inboxViews, channelAccess), push, inboxViews };
  }
  const job = { data: { organizationId: 'o1', conversationId: 'c1' } } as any;

  it('só quem vê o canal; título = contato, texto = inbox + mensagem, número = total', async () => {
    const { proc, push, inboxViews } = setup();
    expect(await proc.process(job)).toEqual({ sent: 1 });
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(push.sendToUser).toHaveBeenCalledWith('u2', {
      title: 'Ana Souza',
      body: 'Não respondidas · Oi, meu chip não conecta',
      url: '/inbox?view=v9&conversationId=c1',
      badge: 4,
      tag: 'conv-c1',
    });
    expect(inboxViews.pushSummary).toHaveBeenCalledTimes(1);
  });

  it('conversa fora das inboxes de push (IA atendendo, já respondida) não notifica', async () => {
    const { proc, push } = setup({ summary: { total: 2, view: null }, access: () => 'ALL' });
    expect(await proc.process(job)).toEqual({ sent: 0 });
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('sem ninguém com notificação ativada, nem consulta a conversa', async () => {
    const { proc, push } = setup();
    push.subscribedMembers.mockResolvedValue([]);
    expect(await proc.process(job)).toEqual({ skipped: 'no-subscribers' });
  });

  it('prévia da mensagem: texto, mídia e limite de tamanho', () => {
    expect(messagePreview({ type: 'IMAGE', content: {} })).toBe('📷 Imagem');
    expect(messagePreview({ type: 'IMAGE', content: { caption: 'comprovante' } })).toBe('comprovante');
    expect(messagePreview(null)).toBe('Nova mensagem');
    expect(messagePreview({ type: 'TEXT', content: { text: 'a'.repeat(300) } })).toHaveLength(140);
  });

  it('job com debounce por conversa', () => {
    const j = inboxPushJob('o1', 'c1');
    expect(j.opts.deduplication).toMatchObject({ id: 'inbox-push:c1', replace: true });
    expect(j.opts.delay).toBe(5_000);
  });
});

describe('InboxViewsService.pushSummary', () => {
  it('push só da "Não respondidas" (as inboxes da IA saíram)', async () => {
    const views = [{ id: 'v1', name: 'Não respondidas', filters: {}, metadata: { builtin: true } }];
    const prisma: any = { inboxView: { findMany: jest.fn(async () => views) } };
    const conversations: any = {
      countInbox: jest.fn(async (_o: string, q: any) => (q.conversationIds ? 1 : 5)),
    };
    const out = await new InboxViewsService(prisma, conversations).pushSummary('o1', 'u1', 'ALL', 'c1');
    expect(out).toEqual({ total: 5, view: { id: 'v1', name: 'Não respondidas' } });
    expect(prisma.inboxView.findMany.mock.calls[0][0].where.name.in).toEqual(['Não respondidas']);
  });
});

describe('cadastro do aparelho (validação da API)', () => {
  it('aceita o toJSON() do navegador, que traz expirationTime', async () => {
    const { ValidationPipe } = require('@nestjs/common');
    const { SavePushSubscriptionDto } = require('./dto/push-subscription.dto');
    // Mesmas opções do pipe global (http.ts).
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const body = { endpoint: 'https://web.push.apple.com/abc', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } };
    await expect(pipe.transform(body, { type: 'body', metatype: SavePushSubscriptionDto })).resolves.toMatchObject({
      endpoint: body.endpoint,
      keys: body.keys,
    });
    await expect(
      pipe.transform({ endpoint: 'x', keys: { p256dh: 'p' } }, { type: 'body', metatype: SavePushSubscriptionDto }),
    ).rejects.toBeTruthy();
  });
});
