// Isolated event function: no credentials, public trigger, scheduler, or charging routes.
const deviceEndpoint = 'https://www.szlzxn.cn/wxn/getDeviceInfo';
const cloudEndpoint = 'https://jozlxfxhtpximjcfrhya.supabase.co/auth/v1/health';
const devices = ['60459110', '60459111'];

async function boundedJson(response) {
  if (!response.body) throw Error('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const parts = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 65536) {
      await reader.cancel();
      throw Error('RESPONSE_TOO_LARGE');
    }
    parts.push(Buffer.from(part.value));
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

async function checkDevice(id, fetcher) {
  const start = Date.now();
  try {
    const response = await fetcher(deviceEndpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ areaId: '6', devaddress: id }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || response.redirected) {
      await response.body?.cancel();
      return { kind: 'device', id, ok: false, status: response.status, ms: Date.now() - start };
    }
    const value = await boundedJson(response);
    const valid = value?.success === true && String(value.obj?.devaddress) === id
      && typeof value.obj?.portstatur === 'string'
      && value.obj.portstatur.length > 0 && value.obj.portstatur.length <= 99;
    return { kind: 'device', id, ok: valid, status: response.status,
      ports: valid ? value.obj.portstatur.length : 0, ms: Date.now() - start };
  } catch (error) {
    return { kind: 'device', id, ok: false, ms: Date.now() - start,
      error: ['TimeoutError', 'AbortError'].includes(error?.name) ? 'TIMEOUT' : 'REQUEST_FAILED' };
  }
}

async function checkCloud(fetcher) {
  const start = Date.now();
  try {
    const response = await fetcher(cloudEndpoint, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    // An unauthenticated 401 proves HTTPS reachability, not database/auth success.
    return { kind: 'cloud-https', ok: !response.redirected && [200, 401].includes(response.status),
      status: response.status, authenticated: false, databaseVerified: false, ms: Date.now() - start };
  } catch (error) {
    return { kind: 'cloud-https', ok: false, authenticated: false, databaseVerified: false,
      ms: Date.now() - start,
      error: ['TimeoutError', 'AbortError'].includes(error?.name) ? 'TIMEOUT' : 'REQUEST_FAILED' };
  }
}

export async function runProbe(fetcher = fetch) {
  const checks = await Promise.all([
    ...devices.map(id => checkDevice(id, fetcher)), checkCloud(fetcher),
  ]);
  return { app: 'neptune-readonly-probe', version: 1, at: new Date().toISOString(),
    runtime: process.version, scope: 'public-connectivity-only',
    ok: checks.every(check => check.ok), checks };
}

export async function handler(event) {
  let input;
  try {
    input = JSON.parse(typeof event === 'string' ? event : Buffer.from(event).toString('utf8'));
  } catch {
    throw Error('Expected only {"action":"probe"}');
  }
  if (!input || Object.keys(input).length !== 1 || input.action !== 'probe') {
    throw Error('Expected only {"action":"probe"}');
  }
  return runProbe();
}
