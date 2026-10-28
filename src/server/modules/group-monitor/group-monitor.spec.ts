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
