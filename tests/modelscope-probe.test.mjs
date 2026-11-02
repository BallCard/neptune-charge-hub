import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProbeServer } from '../server/modelscope-probe.mjs';

async function withServer(options, run) {
  const server = createProbeServer(options);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('probe HTTP boundary refuses charging, parameters and all mutations', async () => {
  let calls = 0;
  await withServer({ probe: async () => { calls++; return { ok: true }; } }, async base => {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/probe', { method: 'HEAD' })).status, 200);
    for (const path of ['/api/web/tick', '/.env', '/token.dpapi', '/server.mjs']) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    assert.equal((await fetch(base + '/probe?url=https://example.test')).status, 400);
    assert.equal((await fetch(base + '/probe', { method: 'POST', body: 'private-input' })).status, 405);
    assert.equal(calls, 0);
  });
});

test('concurrent visitors share one probe and thirty seconds of completed results', async () => {
  let calls = 0, time = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  await withServer({ now: () => time, probe: async () => { calls++; await gate; return { ok: true, number: calls }; } }, async base => {
    const requests = Array.from({ length: 4 }, () => fetch(base + '/probe').then(r => r.json()));
    release(); const responses = await Promise.all(requests);
    assert.equal(calls, 1); assert.ok(responses.every(r => r.number === 1));
    time = 29_999; await fetch(base + '/probe'); assert.equal(calls, 1);
    time = 30_000; await fetch(base + '/probe'); assert.equal(calls, 2);
  });
});

test('transport reports presence only and errors never expose raw details', async () => {
  await withServer({ probe: async () => { throw Error('PRIVATE_SERVER_DETAIL'); } }, async base => {
    const response = await fetch(base + '/transport', { headers: {
      Authorization: 'Bearer synthetic-private-value', 'X-Neptune-Session': 'synthetic-alternate-value',
    } });
    assert.deepEqual(await response.json(), { authorizationPresent: true, alternatePresent: true });
    const failure = await fetch(base + '/probe'); assert.equal(failure.status, 503);
    assert.equal(await failure.text(), '{"error":"PROBE_UNAVAILABLE"}');
  });
});
