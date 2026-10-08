import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out"), port = 3086;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".apk": "application/vnd.android.package-archive" };
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", csp); response.setHeader("Cache-Control", "no-cache");
  if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) { response.writeHead(403).end(); return; }
  if (!["GET", "HEAD"].includes(request.method ?? "")) { response.writeHead(405).end(); return; }
  try {
    const path = decodeURIComponent(new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname);
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => part.startsWith("."))) throw new Error("path");
    const candidate = resolve(root, "." + (path.endsWith("/") ? path + "index.html" : path));
    if (!candidate.startsWith(root + sep)) throw new Error("path");
    const actual = await realpath(candidate); if (!actual.startsWith(root + sep)) throw new Error("path");
    const data = await readFile(actual); response.setHeader("Content-Type", types[extname(actual)] ?? "application/octet-stream");
    response.writeHead(200).end(request.method === "HEAD" ? undefined : data);
  } catch { response.writeHead(404).end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`本机静态预览：http://127.0.0.1:${port}；网页仅预览，自动充电请在本机助手中操作。`));
