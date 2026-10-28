import { pickAvatar, pickName } from './zappfy-contact-enricher.service';

describe('foto de perfil da Zappfy', () => {
  it('aceita os campos de foto da uazapi (image, imagePreview, wa_profilePicUrl)', () => {
    expect(pickAvatar({ image: 'https://pps.whatsapp.net/a.jpg' })).toBe('https://pps.whatsapp.net/a.jpg');
    expect(pickAvatar({ image: '', imagePreview: 'https://pps.whatsapp.net/p.jpg' })).toBe('https://pps.whatsapp.net/p.jpg');
    expect(pickAvatar({ wa_profilePicUrl: 'https://x/y.jpg' })).toBe('https://x/y.jpg');
    expect(pickAvatar({ image: 'none' })).toBeUndefined();
    expect(pickAvatar(null)).toBeUndefined();
  });
  it('nome: contato salvo, depois o nome do WhatsApp', () => {
    expect(pickName({ wa_contactName: 'Peter S', wa_name: 'Peter' })).toBe('Peter S');
    expect(pickName({ wa_name: '', name: 'Ana' })).toBe('Ana');
  });
});

describe('ZappfyContactEnricherService.enrich', () => {
  const { ZappfyContactEnricherService } = require('./zappfy-contact-enricher.service');
  const setup = (contact: any, details: any) => {
    const prisma = {
      contactChannel: {
        findUnique: jest.fn(async () => ({ id: 'cc', profileName: null, profileAvatarUrl: null, contactId: contact.id, contact })),
        update: jest.fn(async () => ({})),
      },
      contact: { update: jest.fn(async (_a: any) => ({})) as jest.Mock },
    };
    const http = { sendRequest: jest.fn(async (_c: any, ep: string) => (ep === '/chat/details' ? details : { chats: [] })) };
    return { svc: new ZappfyContactEnricherService(prisma, http), prisma, http };
  };

  it('contato sem foto: busca em /chat/details pelo número e salva', async () => {
    const { svc, prisma, http } = setup({ id: 'k', name: null, avatarUrl: null, metadata: {} }, { image: 'https://pps.whatsapp.net/a.jpg', wa_name: 'Peter' });
    await svc.enrich({ id: 'ch' }, '14075050924@s.whatsapp.net');
    expect(http.sendRequest).toHaveBeenCalledWith({ id: 'ch' }, '/chat/details', { number: '14075050924', preview: false });
    const data = (prisma.contact.update.mock.calls as any)[0][0].data;
    expect(data.avatarUrl).toBe('https://pps.whatsapp.net/a.jpg');
    expect(data.name).toBe('Peter');
    expect(data.metadata.avatarFetchedAt).toBeDefined();
  });

  it('foto recente: não chama a Zappfy; sem foto e checado há pouco: também não', async () => {
    const recent = new Date().toISOString();
    const a = setup({ id: 'k', avatarUrl: 'https://x', metadata: { avatarFetchedAt: recent } }, {});
    await a.svc.enrich({ id: 'ch' }, '1@s.whatsapp.net');
    expect(a.http.sendRequest).not.toHaveBeenCalled();
    const b = setup({ id: 'k', avatarUrl: null, metadata: { avatarCheckedAt: recent } }, {});
    await b.svc.enrich({ id: 'ch' }, '1@s.whatsapp.net');
    expect(b.http.sendRequest).not.toHaveBeenCalled();
  });

  it('foto com mais de 3 dias: renova', async () => {
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const { svc, prisma } = setup({ id: 'k', name: 'P', avatarUrl: 'https://old', metadata: { avatarFetchedAt: old, avatarCheckedAt: old } }, { imagePreview: 'https://new' });
    await svc.enrich({ id: 'ch' }, '1@s.whatsapp.net');
    expect((prisma.contact.update.mock.calls as any)[0][0].data.avatarUrl).toBe('https://new');
  });
});
