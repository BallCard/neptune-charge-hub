import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runProbe } from './aliyun-readonly-probe.mjs';

// A separate deployment with no account, booking, scheduler or charging code.
export function createProbeServer({ probe = runProbe, now = Date.now } = {}) {
  let cached, completedAt = -Infinity, pending;
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status, body) => {
      res.statusCode = status;
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
    };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        req.resume(); res.setHeader('Allow', 'GET, HEAD');
        send(405, { error: 'READ_ONLY' }); return;
      }
      const path = new URL(req.url || '/', 'http://localhost');
      if (path.search) { send(400, { error: 'NO_PARAMETERS' }); return; }
      if (path.pathname === '/' || path.pathname === '/health') {
        send(200, { app: 'neptune-modelscope-probe', ready: true,
          scope: 'public-connectivity-only', charging: false }); return;
      }
      if (path.pathname === '/transport') {
        send(200, { authorizationPresent: typeof req.headers.authorization === 'string',
          alternatePresent: typeof req.headers['x-neptune-session'] === 'string' }); return;
      }
      if (path.pathname !== '/probe') { send(404, { error: 'NOT_FOUND' }); return; }
      if (req.method === 'HEAD') { send(200, { ready: true }); return; }
      if (!cached || now() - completedAt >= 30_000) {
        pending ??= Promise.resolve().then(probe).then(value => {
          cached = value; completedAt = now(); return value;
        }).finally(() => { pending = undefined; });
        await pending;
      }
      send(200, cached);
    } catch {
      send(503, { error: 'PROBE_UNAVAILABLE' });
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 7860);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
  createProbeServer().listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ app: 'neptune-modelscope-probe', ready: true, port }));
  });
}
