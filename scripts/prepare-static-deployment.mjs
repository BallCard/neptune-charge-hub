import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), out = join(root, "out");
// The public API uses the shared database reader; charging still requires field verification.
const functionRegions = ['hnd1'];
const files = [];
const { edition } = JSON.parse(await readFile(join(out, 'app-edition.json'), 'utf8'));
if (!['personal', 'shared'].includes(edition)) throw Error('Build the selected app edition first.');
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if(prefix === '' && entry.name === 'downloads') continue;
    if(entry.name.endsWith(".apk.idsig")) continue;
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) throw new Error("Unexpected hidden asset or symlink.");
    const path = prefix + entry.name;
    if (entry.isDirectory()) await walk(join(directory, entry.name), path + "/");
    else { const data = await readFile(join(directory, entry.name)); files.push({ path, data }); }
  }
}
await walk(out);
for (const { path, data } of files) {
  if (!/\.(html|js|css|txt|json|svg|png|webmanifest|wasm|woff2)$/.test(path) || data.length > 5_000_000) throw new Error("Unexpected static asset: " + path);
  if (/(?:sb_secret_[A-Za-z0-9_-]{16,}|SUPABASE_SERVICE_ROLE_KEY|\/api\/hub|qnvtuuwvloddxvhmppcd|openId=test-local-only)/.test(data.toString("utf8"))) throw new Error("Cloud or test credential marker in asset: " + path);
}
if (!files.some(f => f.path === "index.html") || !files.some(f => f.path === "sw.js")) throw new Error("Build the static app first.");
const nearbyBuild=await build({entryPoints:[join(root,'server/nearby-api.mjs')],bundle:true,platform:'node',target:'node22',format:'esm',write:false,logLevel:'silent'});
const nearbyCode=nearbyBuild.outputFiles[0].contents;
const stationMetadata=await readFile(join(root,'public/nearby/stations.json'));
const backend=await build({entryPoints:[join(root,'server/web-api.ts')],bundle:true,platform:'node',target:'node22',format:'esm',write:false,logLevel:'silent',define:{'process.env.NEPTUNE_BUILD_EDITION':JSON.stringify(edition)},banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
const backendCode=backend.outputFiles[0].contents;
const hash = createHash("sha256").update("neptune-web-deployment-v8").update(edition).update(JSON.stringify(functionRegions)).update(nearbyCode).update(stationMetadata).update(backendCode); for (const { path, data } of files.sort((a,b)=>a.path.localeCompare(b.path))) hash.update(path).update(data);
const stage = join(root, ".local", "static-deployment", hash.digest("hex").slice(0, 12)), output = join(stage, ".vercel", "output");
await mkdir(output, { recursive: true });
for (const {path,data} of files) { const destination=join(output,"static",path); await mkdir(dirname(destination),{recursive:true}); await writeFile(destination,data); }
if (edition !== 'personal') {
const nearbyFunction=join(output,'functions/api/nearby.func');
await mkdir(nearbyFunction,{recursive:true});
await writeFile(join(nearbyFunction,'index.mjs'),nearbyCode);
await writeFile(join(nearbyFunction,'stations.json'),stationMetadata);
await writeFile(join(nearbyFunction,'.vc-config.json'),JSON.stringify({runtime:'nodejs22.x',handler:'index.mjs',launcherType:'Nodejs',maxDuration:30,regions:functionRegions}));
}
const webFunction=join(output,'functions/api/web.func');
await mkdir(webFunction,{recursive:true});
await writeFile(join(webFunction,'index.mjs'),backendCode);
await writeFile(join(webFunction,'.vc-config.json'),JSON.stringify({runtime:'nodejs22.x',handler:'index.mjs',launcherType:'Nodejs',maxDuration:60,regions:functionRegions}));
const cloud=JSON.parse(await readFile(join(out,'cloud-config.json'),'utf8'));
if(cloud.url&&!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(cloud.url))throw Error('Invalid cloud endpoint');
const csp = `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${cloud.url||''}; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`;
await writeFile(join(output, "config.json"), JSON.stringify({ version: 3, routes: [
  { src: "/(.*)", headers: { "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }, continue: true },
  ...(cloud.url?[{src:'/api/web/(health|status|refresh|configureAccount|setTarget|clearTarget|inspectTarget|reserve|cancel|reviewUncertain|setPin|clearPin|deviceProbe|tick|operations)$',dest:'/api/web?action=$1'}]:[]),
  { src: "/(.*)", methods: ["POST","PUT","PATCH","DELETE"], status: 405 },
  { src: "/sw.js", headers: { "Cache-Control": "no-cache" }, continue: true },
  { src: "/", dest: "/index.html" }, { handle: "filesystem" }, { src: "/.*", dest: "/404.html", status: 404 }
], overrides: { "vendor/zxing_reader.wasm": { contentType: "application/wasm" }, "manifest.webmanifest": { contentType: "application/manifest+json" }, "sw.js": { contentType: "application/javascript" } } }, null, 2));
await writeFile(join(stage, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_PJg7An8MF91H8fBQ3ADsCXRkyfOm", orgId: "team_h2CRAmMCMPNtb3aqnGBNuDVP" }));
console.log(JSON.stringify({ stage, edition, files: files.length, bytes: files.reduce((sum,f)=>sum+f.data.length,0), functionRegions, publicReadOnlyFunctions:edition==='personal'?0:1, cloudApiConfigured:!!cloud.url, personalData: false }));
