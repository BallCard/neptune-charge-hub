import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

if (!process.env.npm_execpath) throw Error('Run npm run build:campus.');
const child = spawn(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, NEXT_PUBLIC_NEPTUNE_EDITION: 'campus', NEXT_PUBLIC_NEPTUNE_AUTH_HEADER: 'x-neptune-session' },
});
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
