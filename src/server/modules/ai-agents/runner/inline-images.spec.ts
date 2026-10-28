import { imageMime, MediaUrlResolverService } from './media-url-resolver.service';

describe('imagens enviadas como bytes para a IA', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  it('reconhece o tipo pelos bytes, mesmo com content-type errado', () => {
    expect(imageMime(jpeg, 'application/octet-stream')).toBe('image/jpeg');
    expect(imageMime(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe('image/png');
    expect(imageMime(Buffer.from('xxxx'), 'image/webp; charset=binary')).toBe('image/webp');
    expect(imageMime(Buffer.from('xxxx'), 'text/html')).toBeNull();
  });

  it('baixa as imagens recentes e guarda o base64 (print do cliente)', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response(jpeg, { headers: { 'content-type': 'application/octet-stream' } })) as any;
    try {
      const svc = new MediaUrlResolverService({} as any, {} as any, { get: () => undefined } as any);
      const media = new Map([['m1', { url: 'https://cdn.zappfy/x.enc' }]]);
      await svc.inlineRecentImages([{ id: 'm1', type: 'IMAGE', direction: 'INBOUND' } as any], media);
      expect(media.get('m1')).toMatchObject({ mimeType: 'image/jpeg', base64: { mediaType: 'image/jpeg', data: jpeg.toString('base64') } });
    } finally {
      global.fetch = realFetch;
    }
  });

  it('falha ao baixar: mantém a URL (o provedor ainda tenta)', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => new Response('no', { status: 403 })) as any;
    try {
      const svc = new MediaUrlResolverService({} as any, {} as any, { get: () => undefined } as any);
      const media = new Map([['m1', { url: 'https://cdn.zappfy/x.enc' }]]);
      await svc.inlineRecentImages([{ id: 'm1', type: 'IMAGE', direction: 'INBOUND' } as any], media);
      expect(media.get('m1')).toEqual({ url: 'https://cdn.zappfy/x.enc' });
    } finally {
      global.fetch = realFetch;
    }
  });
});
