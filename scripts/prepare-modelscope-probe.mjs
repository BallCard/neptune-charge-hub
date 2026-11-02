import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = new Map([
  ['server.mjs', await readFile(join(root, 'server/modelscope-probe.mjs'), 'utf8')],
  ['aliyun-readonly-probe.mjs', await readFile(join(root, 'server/aliyun-readonly-probe.mjs'), 'utf8')],
  ['Dockerfile', 'FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY server.mjs aliyun-readonly-probe.mjs ./\nUSER node\nENV NODE_ENV=production\nENV PORT=7860\nEXPOSE 7860\nCMD ["node", "server.mjs"]\n'],
  ['.dockerignore', '*\n!Dockerfile\n!server.mjs\n!aliyun-readonly-probe.mjs\n'],
  ['README.md', '# 晨充 · 国内 HTTPS 只读验证\n\nNode.js 22，监听 7860。GET /health 检查启动；GET /probe 查询固定两台公开设备及未登录 Supabase HTTPS 入口，同实例共用 30 秒缓存。GET /transport 仅报告合成请求头是否到达，不回显值。\n\n无付款身份、数据库服务密钥、订单、预约、开电或定时任务。健康入口可达不能证明实际开电通过。\n'],
]);
const hash = createHash('sha256').update('modelscope-probe-v1');
for (const [name, body] of files) {
  if (/(?:sb_secret_|SUPABASE_SERVICE_ROLE_KEY|\bms-[a-zA-Z0-9]{20,}|openId=|token\.dpapi)/.test(body)) throw Error('Unexpected private marker');
  hash.update(name).update(body);
}
const release = hash.digest('hex').slice(0, 12);
const output = join(root, '.local/modelscope/probe', release);
await mkdir(output, { recursive: true });
for (const [name, body] of files) await writeFile(join(output, name), body);
console.log(JSON.stringify({ output, release, files: [...files.keys()], credentials: false, charging: false }));
