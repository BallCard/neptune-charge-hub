import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), source = join(root, 'out'), files = [];
const edition = JSON.parse(await readFile(join(source, 'app-edition.json'), 'utf8')).edition;
if (!['personal', 'campus'].includes(edition)) throw Error('Build personal or campus edition first');
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!prefix && entry.name === 'downloads') continue;
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) throw Error('Unexpected public file');
    const path = prefix + entry.name;
    if (entry.isDirectory()) { await walk(join(directory, entry.name), path + '/'); continue; }
    if (!/\.(html|js|css|txt|json|svg|png|webmanifest|wasm|woff2)$/.test(path)) throw Error('Unexpected public extension');
    const raw = await readFile(join(directory, entry.name));
    // Git checks out LF on the Linux runtime; normalize screened text before
    // hashing so Windows source line endings cannot change deployed bytes.
    const data = /\.(html|js|css|txt|json|svg|webmanifest)$/.test(path) ? Buffer.from(raw.toString('utf8').replaceAll('\r\n', '\n')) : raw;
    if (data.length > 5_000_000 || /(?:sb_secret_[A-Za-z0-9_-]{16,}|SUPABASE_SERVICE_ROLE_KEY|\/api\/hub|openId=test-local-only)/.test(data.toString('utf8'))) throw Error('Invalid public asset');
    files.push({ path, data });
  }
}
await walk(source); files.sort((a, b) => a.path.localeCompare(b.path));
if (!files.some(f => f.path === 'index.html') || !files.some(f => f.path === 'sw.js')) throw Error('Incomplete export');
if (!files.some(f => f.path.endsWith('.js') && f.data.includes(Buffer.from('X-Neptune-Session')))) throw Error('Build with NEXT_PUBLIC_NEPTUNE_AUTH_HEADER=x-neptune-session');
const cloud = JSON.parse(files.find(f => f.path === 'cloud-config.json').data.toString('utf8'));
if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(cloud.url)) throw Error('Invalid cloud URL');
const bundled = await build({ entryPoints: [join(root, 'server/modelscope-server.mjs')], bundle: true, platform: 'node', target: 'node22',
  format: 'esm', write: false, logLevel: 'silent', define: { 'process.env.NEPTUNE_BUILD_EDITION': JSON.stringify(edition) },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
const code = bundled.outputFiles[0].contents;
const hash = createHash('sha256').update('modelscope-' + edition + '-v1').update(code);
for (const { path, data } of files) hash.update(path).update(data);
const release = hash.digest('hex').slice(0, 12), output = join(root, '.local/modelscope/deployment', release);
await mkdir(output, { recursive: true });
for (const { path, data } of files) { const target = join(output, 'public', path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, data); }
await writeFile(join(output, 'server.mjs'), code);
await writeFile(join(output, 'asset-manifest.json'), JSON.stringify({ version: 1, release, edition, cloudUrl: cloud.url, files: files.map(f => f.path) }));
await writeFile(join(output, 'Dockerfile'), 'FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY server.mjs asset-manifest.json ./\nCOPY public ./public\nUSER node\nENV NODE_ENV=production\nENV PORT=7860\nEXPOSE 7860\nCMD ["node", "server.mjs"]\n');
await writeFile(join(output, '.dockerignore'), '*\n!Dockerfile\n!server.mjs\n!asset-manifest.json\n!public\n!public/**\n');
await writeFile(join(output, 'README.md'), '# 晨充 · 云端预约与查空位\n\n筛选发行 ' + release + '，版本 ' + edition + '。部署网页、逐用户鉴权接口和仅调用公开 getDeviceInfo 的空位查询，无 Windows 桥接。空位查询按需运行，访客共享30秒缓存。Node.js 22，端口7860。NEPTUNE_PUBLIC_ORIGIN 为本空间独立 HTTPS 域名；NEPTUNE_SUPABASE_SECRET 通过 Secrets 注入。个人版另需 NEPTUNE_PERSONAL_USER_ID。\n\n复用 Supabase 唯一分钟调度与数据库防重，不创建进程内预约定时器。应用会话与调度使用 X-Neptune-Session，不能使用平台管理令牌代替。\n');
console.log(JSON.stringify({ output, release, staticFiles: files.length, edition, runtimeDependencies: 0, credentials: false }));
