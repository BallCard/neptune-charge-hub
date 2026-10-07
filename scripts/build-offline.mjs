import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
async function walk(directory, prefix = "") {
  const paths = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (item.isDirectory()) paths.push(...await walk(join(directory, item.name), relative + "/"));
    else if (/\.(?:js|css|png|svg|webmanifest)$/.test(item.name) || relative === "index.html") paths.push("/" + relative);
  }
  return paths;
}
const paths = (await walk(root)).sort(), hash = createHash("sha256");
for (const path of paths) hash.update(await readFile(join(root, path.slice(1))));
const name = "neptune-static-" + hash.digest("hex").slice(0, 16);
const script = `const CACHE=${JSON.stringify(name)}, ASSETS=${JSON.stringify(paths)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('neptune-static-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  if(url.pathname!=='/'&&url.pathname!=='/index.html')return;
  event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(cache=>cache.match('/index.html'))));return;
 }
 if(!ASSETS.includes(url.pathname))return;
 event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname)).then(cached=>cached||fetch(request)));
});\n`;
await writeFile(join(root, "sw.js"), script, "utf8");
console.log(JSON.stringify({ offlineAssets: paths.length, cache: name, containsUserData: false }));
