import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access } from "node:fs/promises";

// Vercel CLI 59.20 uses the Windows hostname in its OAuth user-agent header.
// Encode it only in this process; leave the installed CLI and saved auth untouched.
const hostname = os.hostname.bind(os);
os.hostname = () => encodeURIComponent(hostname());
syncBuiltinESMExports();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules", "vercel", "dist", "index.js");
if (!cli) throw new Error("This Windows helper requires the existing Vercel CLI installation.");
await access(cli);
const args = process.argv.slice(2);
if (!args.length) throw new Error("Pass a Vercel CLI command; this helper never chooses a deployment action.");
process.chdir(root);
process.env.NO_UPDATE_NOTIFIER = "1";
process.argv = [process.execPath, cli, ...args];
await import(pathToFileURL(cli).href);
