// Bounded, read-only smoke check. No account, booking, tick or charging requests.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
const origin = process.env.NEPTUNE_QA_ORIGIN;
if (!origin || !/^https:\/\/[a-z0-9-]+\.ms\.show$/.test(origin)) throw Error('Provide the inspected ModelScope host');
const get = path => fetch(origin + path, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
async function wave() {
  const results = await Promise.all(Array.from({ length: 12 }, async () => {
    const start = performance.now(), response = await get('/api/nearby');
    assert.equal(response.status, 200);
    const data = await response.json(), devices = data.stations.flatMap(s => s.devices_detail);
    assert.equal(data.stations.length, 14); assert.equal(devices.length, 35);
    assert.ok(devices.some(d => d.reachable && d.ports.length > 0), 'No live ports');
    const age = Date.now() - Date.parse(data.updated_at);
    assert.ok(age >= -5000 && age < 60_000, 'Invalid observation age');
    return { ms: Math.round(performance.now() - start), observed: data.updated_at,
      devices: devices.filter(d => d.reachable).length, ports: devices.reduce((n, d) => n + d.ports.length, 0) };
  }));
  const times = results.map(x => x.ms).sort((a, b) => a - b);
  return { requests: results.length, minMs: times[0], medianMs: times[6], p95Ms: times[11],
    observationVersions: new Set(results.map(x => x.observed)).size,
    observed: results.at(-1).observed, minReachableDevices: Math.min(...results.map(x => x.devices)),
    minPorts: Math.min(...results.map(x => x.ports)) };
}
const first = await wave(); console.log(JSON.stringify({ wave: 1, ...first }));
await delay(31_000);
const second = await wave(); assert.notEqual(second.observed, first.observed, 'Observation never refreshed');
const health = await get('/api/web/health'); assert.equal(health.status, 200);
assert.equal((await health.json()).schedulerReady, true);
console.log(JSON.stringify({ result: 'PASS', wave: 2, ...second, schedulerReady: true, chargingRequests: 0,
  scope: '24 read-only requests in two bounded bursts; not sustained capacity evidence' }));
