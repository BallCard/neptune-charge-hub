import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Use npm's Node entry point to work on Windows without a shell wrapper.
if (!process.env.npm_execpath) throw Error('Run npm run build:personal.');
const child = spawn(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, NEXT_PUBLIC_NEPTUNE_EDITION: 'personal' },
});
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
