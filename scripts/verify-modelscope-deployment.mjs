import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const origin = process.env.NEPTUNE_QA_ORIGIN;
if (!origin || !/^https:\/\/[a-z0-9-]+\.ms\.show$/.test(origin)) throw Error('Provide the inspected ModelScope host');
const base = resolve('.local/modelscope/deployment'), directory = resolve(process.argv[2] || '');
if (!directory.startsWith(base + sep)) throw Error('Provide a screened deployment package');
const manifest = JSON.parse(await readFile(join(directory, 'asset-manifest.json'), 'utf8'));
const get = (path, options = {}) => fetch(origin + path, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000), ...options });
const response = await get('/health'); assert.equal(response.status, 200);
const health = await response.json(); assert.equal(health.app, 'neptune-charge-web');
assert.ok(['personal', 'campus'].includes(manifest.edition));
assert.equal(health.edition, manifest.edition); assert.equal(health.release, manifest.release); assert.equal(health.cloudConfigured, true);
let index = 0, checked = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (index < manifest.files.length) {
    const path = manifest.files[index++], result = await get('/' + path);
    assert.equal(result.status, 200, path);
    const local = await readFile(join(directory, 'public', path));
    const expected = /\.(html|js|css|txt|json|svg|webmanifest)$/.test(path) ? Buffer.from(local.toString('utf8').replaceAll('\r\n', '\n')) : local;
    assert.ok(Buffer.from(await result.arrayBuffer()).equals(expected), 'Asset differs: ' + path);
    checked++;
  }
}));
const home = await get('/'); assert.equal(home.status, 200);
assert.ok(home.headers.get('content-security-policy')?.endsWith('frame-ancestors https://modelscope.cn https://www.modelscope.cn'));
assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
for (const path of ['/server.mjs', '/asset-manifest.json', '/.env', '/token.dpapi', '/api/windows/status', '/downloads/app.apk']) {
  assert.equal((await get(path)).status, 404, path);
}
const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
for (const action of ['status', 'operations', 'tick']) assert.equal((await get('/api/web/' + action, post)).status, 401);
assert.equal((await get('/api/web/status', { ...post, headers: { ...post.headers, Origin: 'https://untrusted.example.invalid' } })).status, 403);
const cloud = await get('/api/web/health'); assert.equal(cloud.status, 200); assert.equal((await cloud.json()).schedulerReady, true);
const nearby = await get('/api/nearby'); assert.equal(nearby.status, 200);
const sockets = await nearby.json(); assert.equal(sockets.stations.length, 14);
assert.ok(Date.now() - Date.parse(sockets.updated_at) < 60_000, 'Stale public data');
const devices = sockets.stations.flatMap(station => station.devices_detail);
assert.equal(devices.length, 35); assert.ok(devices.some(device => device.reachable && device.ports.length > 0), 'No actual device ports');
assert.equal((await get('/api/nearby', post)).status, 405);
console.log(JSON.stringify({ result: 'PASS', release: health.release, exactStaticFiles: checked, personalOnly: manifest.edition === 'personal', edition: manifest.edition,
  privatePathsDenied: true, anonymousSchedulerDenied: true, publicDevices: devices.filter(device => device.reachable).length,
  publicPorts: devices.reduce((sum, device) => sum + device.ports.length, 0), chargingRequests: 0 }));
