import { nearbyStatus } from '../modules/nearby/status.mjs';

// One fixed public station list, shared across visitors. No account or booking access.
export function createModelscopeNearby({ loadStations, readStatus = nearbyStatus, now = Date.now }) {
  let cached, completedAt = -Infinity, pending, retryAt = -Infinity;
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      req.resume(); res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    // Health checks must not start a batch of upstream reads.
    if (req.method === 'HEAD') { res.end(); return; }
    try {
      if (!cached || now() - completedAt >= 30_000) {
        if (now() < retryAt) throw Error('Public read cooling down');
        pending ??= Promise.resolve().then(loadStations).then(readStatus).then(value => {
          const body = JSON.stringify(value);
          cached = body; completedAt = now(); retryAt = -Infinity; return body;
        }).catch(error => {
          // A failed batch must not turn every subsequent visitor into a new batch.
          retryAt = now() + 3_000; throw error;
        }).finally(() => { pending = undefined; });
        await pending;
      }
      res.end(cached);
    } catch {
      res.statusCode = 503;
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((retryAt - now()) / 1000))));
      res.end(JSON.stringify({ error: '暂时无法读取空位，请稍后刷新。' }));
    }
  };
}
