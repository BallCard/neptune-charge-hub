import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createModelscopeServer } from '../server/modelscope-server.mjs';
import { createNodeWebApi } from '../server/web-api.ts';

for (const edition of ['personal', 'campus']) test('ModelScope ' + edition + ' ignores platform Authorization and verifies only its app transport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'neptune-modelscope-'));
  await writeFile(join(directory, 'index.html'), '<h1>personal fixture</h1>');
  await writeFile(join(directory, '404.html'), 'not found');
  await writeFile(join(directory, 'server.mjs'), 'PRIVATE_FIXTURE');
  const received = [];
  const admin = { auth: { async getUser(token) { received.push(token); return { data: { user: null }, error: {} }; } } };
  const origin = 'https://personal.example.test';
  const server = createModelscopeServer({ directory, publicOrigin: origin,
    manifest: { version: 1, edition, release: 'fixture', cloudUrl: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', files: ['index.html', '404.html'] },
    api: createNodeWebApi(admin, origin, [], { personalOnly: true, personalUserId: '11111111-1111-4111-8111-111111111111' }),
    nearby: async (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ stations: [], publicOnly: true })); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = headers => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: '{}' });
  try {
    const home = await fetch(base); assert.equal(home.status, 200); assert.equal(await home.text(), '<h1>personal fixture</h1>');
    assert.equal((await (await fetch(base + '/health')).json()).edition, edition);
    assert.ok(home.headers.get('content-security-policy').endsWith('frame-ancestors https://modelscope.cn https://www.modelscope.cn'));
    assert.equal((await fetch(base + '/api/web/status', post({ Authorization: 'Bearer platform-injected-token' }))).status, 401);
    assert.deepEqual(received, []);
    assert.equal((await fetch(base + '/api/web/status', post({ Authorization: 'Bearer platform-injected-token', 'X-Neptune-Session': 'Bearer synthetic-app-session-token' }))).status, 401);
    assert.deepEqual(received, ['synthetic-app-session-token']);
    assert.equal((await fetch(base + '/api/web/status', post({ 'X-Neptune-Session': 'Bearer invalid value' }))).status, 401);
    assert.equal(received.length, 1);
    const hostile = await fetch(base + '/api/web/status', post({ Origin: 'https://hostile.example.test', 'X-Neptune-Session': 'Bearer synthetic-app-session-token' }));
    assert.equal(hostile.status, 403); assert.equal(received.length, 1);
    const nearby = await fetch(base + '/api/nearby'); assert.equal(nearby.status, 200); assert.equal((await nearby.json()).publicOnly, true);
    for (const path of ['/api/windows/status', '/server.mjs', '/.env', '/token.dpapi', '/asset-manifest.json']) {
      const r = await fetch(base + path); assert.equal(r.status, 404); assert.ok(!(await r.text()).includes('PRIVATE_FIXTURE'));
    }
    assert.equal((await fetch(base + '/api/web/status?action=tick', post({ 'X-Neptune-Session': 'Bearer synthetic-app-session-token' }))).status, 401);
    assert.deepEqual(received, ['synthetic-app-session-token', 'synthetic-app-session-token']);
    assert.equal((await fetch(base + '/api/web/status', { ...post({}), body: 'x'.repeat(20001) })).status, 413);
  } finally {
    await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true });
  }
});
