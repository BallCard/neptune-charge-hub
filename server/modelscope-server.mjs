import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import webApi, { checkedOrigin, webActions } from './web-api.ts';
import { createModelscopeNearby } from './modelscope-nearby.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const mime = { html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png',
  webmanifest: 'application/manifest+json', wasm: 'application/wasm', woff2: 'font/woff2' };

export function createModelscopeServer({ directory, manifest, publicOrigin, api = webApi, nearby }) {
  checkedOrigin(publicOrigin);
  if (manifest?.version !== 1 || !['personal', 'campus'].includes(manifest.edition) || !Array.isArray(manifest.files)
    || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(manifest.cloudUrl)) throw Error('Invalid deployment manifest');
  const allowed = new Set(manifest.files.map(path => {
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\')
      || path.split('/').some(part => !part || part.startsWith('.')) || !mime[path.split('.').at(-1)]) throw Error('Invalid public asset');
    return '/' + path;
  }));
  if (!allowed.has('/index.html') || !allowed.has('/404.html')) throw Error('Incomplete public assets');
  const base = resolve(directory);
  const nearbyApi = nearby ?? createModelscopeNearby({
    loadStations: async () => JSON.parse(await readFile(resolve(base, 'nearby/stations.json'), 'utf8')),
  });
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${manifest.cloudUrl}; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors https://modelscope.cn https://www.modelscope.cn`);
    try {
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (path === '/api/nearby') { await nearbyApi(req, res); return; }
      if (path.startsWith('/api/web/') && webActions.has(path.slice('/api/web/'.length))) {
        // The platform owns Authorization and may inject its own value. Only our
        // separate transport header can carry an app session or scheduler secret.
        const session = req.headers['x-neptune-session'];
        delete req.headers.authorization;
        if (typeof session === 'string' && /^Bearer [^\s]{16,8192}$/.test(session)) req.headers.authorization = session;
        delete req.headers['x-neptune-session'];
        await api(req, res); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { req.resume(); res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      if (path === '/health') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ app: 'neptune-charge-web', ready: true,
          edition: manifest.edition, release: manifest.release, cloudConfigured: !!process.env.NEPTUNE_SUPABASE_SECRET })); return;
      }
      let asset; try { asset = decodeURIComponent(path); } catch { res.writeHead(400).end(); return; }
      if (asset.endsWith('/')) asset += 'index.html';
      const exists = allowed.has(asset), file = resolve(base, '.' + (exists ? asset : '/404.html'));
      if (!file.startsWith(base + sep)) { res.writeHead(404).end(); return; }
      const body = await readFile(file);
      res.statusCode = exists ? 200 : 404; res.setHeader('Content-Type', mime[file.split('.').at(-1)]);
      res.setHeader('Cache-Control', exists && asset.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.statusCode = 503; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: '云端暂未响应，请刷新核对预约记录。' }));
    }
  });
}

async function main() {
  const manifest = JSON.parse(await readFile(resolve(root, 'asset-manifest.json'), 'utf8'));
  const publicOrigin = checkedOrigin(process.env.NEPTUNE_PUBLIC_ORIGIN || '');
  const port = Number(process.env.PORT || 7860);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
  createModelscopeServer({ directory: resolve(root, 'public'), manifest, publicOrigin }).listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ ready: true, app: 'neptune-charge-web', release: manifest.release, edition: manifest.edition }));
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => {
  console.error('Deployment startup failed; verify configuration.'); process.exitCode = 1;
});
