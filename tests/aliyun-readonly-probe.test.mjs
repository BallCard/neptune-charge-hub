import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, runProbe } from '../server/aliyun-readonly-probe.mjs';

function deviceResponse(id, extra = {}) {
  return Response.json({ success: true, obj: { devaddress: id, portstatur: '000111000111', ...extra } });
}

test('probe only calls two fixed public devices and unauthenticated cloud HTTPS', async () => {
  const requests = [];
  const result = await runProbe(async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers?.Authorization, undefined);
    if (options.method === 'GET') return new Response('private body must not be returned', { status: 401 });
    assert.equal(url, 'https://www.szlzxn.cn/wxn/getDeviceInfo');
    assert.deepEqual([...options.body.keys()], ['areaId', 'devaddress']);
    return deviceResponse(options.body.get('devaddress'), { hidden: 'must-not-escape' });
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.filter(x => x.options.method === 'POST').map(x => x.options.body.get('devaddress')), ['60459110', '60459111']);
  assert.equal(requests[2].url, 'https://jozlxfxhtpximjcfrhya.supabase.co/auth/v1/health');
  assert.equal(result.checks[2].authenticated, false);
  assert.equal(result.checks[2].databaseVerified, false);
  assert.doesNotMatch(JSON.stringify(result), /private body|must-not-escape/);
});

test('failures are reported once without retries or raw error details', async () => {
  let calls = 0;
  const result = await runProbe(async () => { calls++; throw Error('sensitive upstream details'); });
  assert.equal(calls, 3);
  assert.equal(result.ok, false);
  assert.ok(result.checks.every(x => x.error === 'REQUEST_FAILED'));
  assert.doesNotMatch(JSON.stringify(result), /sensitive/);
});

test('wrong device, oversized body and unexpected cloud status fail closed', async () => {
  const result = await runProbe(async (_url, options) => {
    if (options.method === 'GET') return new Response('', { status: 503 });
    return options.body.get('devaddress') === '60459110'
      ? deviceResponse('99999999') : new Response('x'.repeat(65537));
  });
  assert.equal(result.ok, false);
  assert.ok(result.checks.every(x => !x.ok));
});

test('timeout does not trigger a second request', async () => {
  let calls = 0;
  const result = await runProbe(async () => { calls++; throw new DOMException('timeout', 'TimeoutError'); });
  assert.equal(calls, 3);
  assert.ok(result.checks.every(x => x.error === 'TIMEOUT'));
});

test('event cannot select an endpoint, pass credentials, or invoke charging', async () => {
  for (const event of ['', '{}', '{"action":"tick"}', '{"action":"probe","url":"https://example.com"}', '{"action":"probe","token":"test"}']) {
    await assert.rejects(handler(Buffer.from(event)), /Expected only/);
  }
});
