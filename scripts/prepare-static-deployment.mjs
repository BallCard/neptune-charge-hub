import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), out = join(root, "out");
const files = [];
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if(entry.name.endsWith(".apk.idsig")) continue;
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) throw new Error("Unexpected hidden asset or symlink.");
    const path = prefix + entry.name;
    if (entry.isDirectory()) await walk(join(directory, entry.name), path + "/");
    else { const data = await readFile(join(directory, entry.name)); files.push({ path, data }); }
  }
}
await walk(out);
for (const { path, data } of files) {
  if (!/\.(html|js|css|txt|json|svg|png|webmanifest|apk)$/.test(path) || data.length > 5_000_000) throw new Error("Unexpected static asset: " + path);
  if (/(?:sb_secret_[A-Za-z0-9_-]{16,}|SUPABASE_SERVICE_ROLE_KEY|\/api\/hub|qnvtuuwvloddxvhmppcd|openId=test-local-only)/.test(data.toString("utf8"))) throw new Error("Cloud or test credential marker in asset: " + path);
}
if (!files.some(f => f.path === "index.html") || !files.some(f => f.path === "sw.js")) throw new Error("Build the static app first.");
const hash = createHash("sha256").update("neptune-static-deployment-v3"); for (const { path, data } of files.sort((a,b)=>a.path.localeCompare(b.path))) hash.update(path).update(data);
const stage = join(root, ".local", "static-deployment", hash.digest("hex").slice(0, 12)), output = join(stage, ".vercel", "output");
await mkdir(output, { recursive: true });
for (const {path,data} of files) { const destination=join(output,"static",path); await mkdir(dirname(destination),{recursive:true}); await writeFile(destination,data); }
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
await writeFile(join(output, "config.json"), JSON.stringify({ version: 3, routes: [
  { src: "/(.*)", headers: { "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }, continue: true },
  { src: "/(.*)", methods: ["POST","PUT","PATCH","DELETE"], status: 405 },
  { src: "/sw.js", headers: { "Cache-Control": "no-cache" }, continue: true },
  { src: "/", dest: "/index.html" }, { handle: "filesystem" }, { src: "/.*", dest: "/404.html", status: 404 }
], overrides: { "manifest.webmanifest": { contentType: "application/manifest+json" }, "sw.js": { contentType: "application/javascript" }, "downloads/neptune-local-assistant.apk": { contentType: "application/vnd.android.package-archive" } } }, null, 2));
await writeFile(join(stage, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_PJg7An8MF91H8fBQ3ADsCXRkyfOm", orgId: "team_h2CRAmMCMPNtb3aqnGBNuDVP" }));
console.log(JSON.stringify({ stage, files: files.length, bytes: files.reduce((sum,f)=>sum+f.data.length,0), staticOnly: true, personalData: false }));
