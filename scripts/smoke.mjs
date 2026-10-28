#!/usr/bin/env node
// Teste de fumaça do app no ar (local ou produção). Não altera dados.
//
//   node scripts/smoke.mjs https://seu-app.vercel.app
//   SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke.mjs https://...   (inclui login)
//   CRON_SECRET=... node scripts/smoke.mjs https://...                       (inclui o tick)

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const { SMOKE_EMAIL, SMOKE_PASSWORD, CRON_SECRET } = process.env;
let failed = 0;

async function check(label, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    console.log(`✓ ${label}${detail ? ` — ${detail}` : ''} (${Date.now() - t0}ms)`);
  } catch (err) {
    failed++;
    console.log(`✗ ${label} — ${err.message}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const get = (path, init) => fetch(base + path, { redirect: 'manual', ...init });

console.log(`Smoke test: ${base}\n`);

await check('página /login', async () => {
  const r = await get('/login');
  expect(r.status === 200, `status ${r.status}`);
});
await check('/ redireciona para /inbox', async () => {
  const r = await get('/');
  expect([307, 308].includes(r.status) && r.headers.get('location')?.endsWith('/inbox'), `status ${r.status} → ${r.headers.get('location')}`);
});
await check('API responde (404 JSON do Nest)', async () => {
  const r = await get('/api/v1/rota-inexistente');
  const j = await r.json();
  expect(r.status === 404 && j.error === 'NotFoundException', `status ${r.status} ${JSON.stringify(j).slice(0, 80)}`);
  return 'nomes de classe preservados';
});
await check('rota protegida sem token = 401', async () => {
  const r = await get('/api/v1/tags');
  expect(r.status === 401, `status ${r.status}`);
});
await check('Swagger /docs', async () => {
  const r = await get('/docs');
  const js = await get('/docs/swagger-ui-bundle.js');
  expect(r.status === 200 && js.status === 200, `docs ${r.status}, bundle ${js.status}`);
});
await check('MCP /mcp/health', async () => {
  const r = await get('/mcp/health');
  const j = await r.json();
  expect(j.status === 'ok', JSON.stringify(j));
});
await check('MCP sem API key = 401', async () => {
  const r = await get('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(r.status === 401, `status ${r.status}`);
});
await check('tick sem segredo = 401', async () => {
  const r = await get('/api/internal/tick');
  expect(r.status === 401, `status ${r.status}`);
});

if (CRON_SECRET) {
  await check('tick com CRON_SECRET', async () => {
    const r = await get('/api/internal/tick?wait=1', { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    const j = await r.json();
    expect(r.status === 200 && j.reason === 'tick', `status ${r.status} ${JSON.stringify(j).slice(0, 100)}`);
    return `filas=[${j.started.join(',')}] processados=${j.processed} falhas=${j.failed}`;
  });
}

if (SMOKE_EMAIL && SMOKE_PASSWORD) {
  let token, org;
  await check('login', async () => {
    const r = await get('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
    });
    const j = await r.json();
    expect(r.status === 201 && j.data?.accessToken, `status ${r.status} ${JSON.stringify(j).slice(0, 100)}`);
    token = j.data.accessToken;
    org = j.data.organizations?.[0]?.id;
    return j.data.organizations?.[0]?.name;
  });
  if (token) {
    const auth = { Authorization: `Bearer ${token}`, 'x-organization-id': org };
    await check('rota autenticada (/tags)', async () => {
      const r = await get('/api/v1/tags', { headers: auth });
      expect(r.status === 200, `status ${r.status}`);
    });
    await check('realtime: sessão com Supabase configurado', async () => {
      const r = await get('/api/v1/realtime/session', { headers: auth });
      const j = await r.json();
      expect(j.data?.supabase?.url && j.data?.topics?.user, `supabase=${JSON.stringify(j.data?.supabase)}`);
      return j.data.supabase.url;
    });
    await check('storage: upload direto habilitado', async () => {
      const r = await get('/api/v1/messages/uploads/direct', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'media', mimeType: 'image/png', size: 5 * 1024 * 1024 }),
      });
      const j = await r.json();
      expect(j.data?.direct === true && j.data.uploadUrl, JSON.stringify(j).slice(0, 120));
      return 'URL assinada gerada (nada foi enviado)';
    });
  }
}

console.log(failed ? `\n${failed} verificação(ões) falharam` : '\nTudo certo');
process.exit(failed ? 1 : 0);
