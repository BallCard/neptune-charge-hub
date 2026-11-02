import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelscopeNearby } from '../server/modelscope-nearby.mjs';

function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers); return this; },
    end(body) { this.body = body; } };
}
const request = (method = 'GET') => ({ method, resume() {} });

test('ModelScope shares a single fixed public read for concurrent visitors and preserves observation time', async () => {
  let time = 0, calls = 0, finish;
  const observed = '2026-10-20T08:00:00.000Z', stations = [{ name: '合成站点' }];
  const handler = createModelscopeNearby({ now: () => time, loadStations: async () => stations,
    readStatus: async value => { assert.equal(value, stations); calls++; await new Promise(resolve => { finish = resolve; }); return { updated_at: observed, stations: [] }; } });
  const first = response(), second = response();
  const reads = [handler(request(), first), handler(request(), second)];
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1); finish(); await Promise.all(reads);
  assert.equal(first.body, second.body); assert.equal(JSON.parse(first.body).updated_at, observed);
  time = 29_999; await handler(request(), response()); assert.equal(calls, 1);
  time = 30_000; const next = handler(request(), response());
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2); finish(); await next;
});

test('ModelScope rejects mutations and HEAD does not read upstream', async () => {
  const handler = createModelscopeNearby({ loadStations: () => { throw Error('must not read'); } });
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const result = response(); await handler(request(method), result); assert.equal(result.statusCode, 405);
  }
  const head = response(); await handler(request('HEAD'), head); assert.equal(head.statusCode, 200); assert.equal(head.body, undefined);
});

test('ModelScope reports public read failures without serving stale data or internal errors', async () => {
  let time = 0, fail = false, calls = 0;
  const handler = createModelscopeNearby({ now: () => time, loadStations: async () => [],
    readStatus: async () => { calls++; if (fail) throw Error('PRIVATE_FIXTURE'); return { stations: [], updated_at: 'fixture' }; } });
  await handler(request(), response()); time = 30_000; fail = true;
  const result = response(); await handler(request(), result); assert.equal(result.statusCode, 503);
  assert.ok(!result.body.includes('PRIVATE_FIXTURE')); assert.ok(!result.body.includes('fixture'));
  assert.equal(result.headers['Retry-After'], '3');
  await Promise.all(Array.from({ length: 100 }, () => handler(request(), response())));
  assert.equal(calls, 2, 'failure cooldown prevents new upstream batches');
  time = 32_999; const cooling = response(); await handler(request(), cooling);
  assert.equal(cooling.statusCode, 503); assert.equal(cooling.headers['Retry-After'], '1');
  assert.equal(calls, 2);
  time = 33_000;
  fail = false; const recovered = response(); await handler(request(), recovered); assert.equal(recovered.statusCode, 200);
  assert.equal(calls, 3); assert.equal(recovered.headers['Retry-After'], undefined);
});
