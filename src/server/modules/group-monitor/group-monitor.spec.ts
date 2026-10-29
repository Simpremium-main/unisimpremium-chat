import { normalizeGroup } from './group-sync.service';
import { summarizeOutput } from './group-monitor.service';

describe('summarizeOutput', () => {
  it('lê o JSON do texto formatado', () => {
    const out = `${JSON.stringify({ number: '142458', status: 'processing' })}\n\n[REGRAS OBRIGATÓRIAS — leia]`;
    expect(summarizeOutput(out, null)).toEqual({ outcome: 'found', orders: [{ id: '142458', status: 'processing' }] });
  });

  it('lê a saída com auditoria', () => {
    const out = { resultado: { ok: false, pedido_nao_encontrado: '999' }, _auditoria: {} };
    expect(summarizeOutput(out, null).outcome).toBe('not-found');
  });

  it('identidade não confirmada e erro', () => {
    expect(summarizeOutput({ ok: false, identidade_nao_confirmada: true }, null).outcome).toBe('unverified');
    expect(summarizeOutput(null, 'timeout').outcome).toBe('error');
  });
});

describe('normalizeGroup', () => {
  it('lê o GroupInfo do /group/list', () => {
    expect(
      normalizeGroup({ JID: '120363@g.us', Name: 'Parceiro Alfa', Participants: [{}, {}, {}] }),
    ).toEqual({ jid: '120363@g.us', name: 'Parceiro Alfa', participants: 3, avatarUrl: undefined });
  });

  it('lê o chat do /chat/find', () => {
    const g = normalizeGroup({ wa_chatid: '120363@g.us', wa_name: 'Grupo B', image: 'https://x/y.jpg' });
    expect(g).toMatchObject({ jid: '120363@g.us', name: 'Grupo B', participants: null, avatarUrl: 'https://x/y.jpg' });
  });

  it('ignora o que não é grupo', () => {
    expect(normalizeGroup({ wa_chatid: '5511999990000@s.whatsapp.net' })).toBeNull();
  });
});
