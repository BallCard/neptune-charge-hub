import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { publicStatus } from '../modules/nearby/status.mjs';
import { existsSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out"), port = Number(process.env.NEPTUNE_HUB_PORT||3086);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
const hubRoot=resolve(root,'..'),compatRoot=resolve(hubRoot,'../neptune-charge-scheduler');
const legacyRoot=process.env.NEPTUNE_WINDOWS_ROOT?resolve(process.env.NEPTUNE_WINDOWS_ROOT):existsSync(join(compatRoot,'ui_server.py'))?compatRoot:join(hubRoot,'native/windows');
const windowsEnabled=process.platform==='win32'&&process.env.NEPTUNE_ENABLE_WINDOWS!=='0';
const hubToken=randomBytes(32).toString('base64url');
const hubOrigin=`http://127.0.0.1:${port}`;
function sameToken(value){const given=Buffer.from(String(value||'')),expected=Buffer.from(hubToken);return given.length===expected.length&&timingSafeEqual(given,expected);}
function jsonReply(response,status,body){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(body));}
async function windowsRequest(action,body){
  const connection=JSON.parse(await readFile(join(legacyRoot,'.local/ui-connection.json'),'utf8'));
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(connection.url))throw new Error('Invalid local connection');
  const health=await fetch(connection.url+'/health',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());
  if(health.app!=='neptune-charge-ui')throw new Error('Wrong local service');
  const page=await fetch(connection.url+'/',{signal:AbortSignal.timeout(3000)}).then(r=>r.text());
  const token=page.match(/<meta name="neptune-session" content="([A-Za-z0-9_-]+)">/)?.[1];
  if(!token)throw new Error('Missing session');
  const result=await fetch(connection.url+'/api/'+action,{method:body?'POST':'GET',headers:{'X-Neptune-Session':token,...(body?{'Content-Type':'application/json',Origin:connection.url}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000)});
  return {status:result.status,body:await result.json()};
}
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".apk": "application/vnd.android.package-archive" };
const cloud=JSON.parse(await readFile(join(root,'cloud-config.json'),'utf8').catch(()=>'{}'));
if(cloud.url&&!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(cloud.url))throw Error('Invalid cloud endpoint');
const csp = `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${cloud.url||''}; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`;
export const server=createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", csp); response.setHeader("Cache-Control", "no-cache");
  if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) { response.writeHead(403).end(); return; }
  if(request.url==='/health'){jsonReply(response,200,{app:'neptune-charge-hub'});return;}
  if(request.url?.startsWith('/api/web/')){
    const action=request.url.slice('/api/web/'.length);
    if(!cloud.url||!['health','status','refresh','configureAccount','setTarget','clearTarget','inspectTarget','reserve','cancel','reviewUncertain','deviceProbe'].includes(action)){jsonReply(response,404,{error:'云端操作不存在。'});return;}
    if(request.method!==(action==='health'?'GET':'POST')||(request.headers.origin&&request.headers.origin!==hubOrigin)){jsonReply(response,403,{error:'请求来源不匹配。'});return;}
    try{
      const chunks=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;if(bytes>20000)throw Error('Body limit');chunks.push(chunk);}
      const upstream=await fetch('https://neptune-charge-hub.vercel.app/api/web/'+action,{method:request.method,headers:{Origin:hubOrigin,...(request.headers.authorization?{Authorization:request.headers.authorization}:{}),'Content-Type':'application/json'},body:request.method==='POST'?Buffer.concat(chunks):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
      const result=await upstream.json();jsonReply(response,upstream.status,result);
    }catch{jsonReply(response,503,{error:'云端暂未响应，请刷新核对预约记录。'});}return;
  }
  if(request.url==='/api/nearby'){
    if(!['GET','HEAD'].includes(request.method??'')){response.writeHead(405).end();return;}
    try{jsonReply(response,200,await publicStatus());}catch{jsonReply(response,503,{error:'暂时无法读取空位。'});}return;
  }
  if(request.url?.startsWith('/api/windows/')){
    const action=request.url.slice('/api/windows/'.length);
    if(!['state','reserve','cancel'].includes(action)){jsonReply(response,404,{error:'操作不存在。'});return;}
    if(!windowsEnabled||!sameToken(request.headers['x-neptune-hub-session'])){jsonReply(response,403,{error:'请从本机入口重新打开。'});return;}
    const writing=action!=='state';
    if(request.method!==(writing?'POST':'GET')){response.writeHead(405).end();return;}
    if(writing&&(request.headers.origin!==hubOrigin||request.headers['content-type']!=='application/json')){jsonReply(response,403,{error:'请求来源不匹配。'});return;}
    let body;
    if(writing){
      try{let content='';for await(const chunk of request){content+=chunk.toString('utf8');if(Buffer.byteLength(content)>2048)throw new Error('Body too large');}body=JSON.parse(content);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Object required');}
      catch{jsonReply(response,400,{error:'请求内容不正确。'});return;}
    }
    try{const result=await windowsRequest(action,body);jsonReply(response,result.status,result.body);}catch{jsonReply(response,503,{error:'此电脑执行器暂不可用，请重新打开晨充本机入口。'});}return;
  }
  if (!["GET", "HEAD"].includes(request.method ?? "")) { response.writeHead(405).end(); return; }
  try {
    const path = decodeURIComponent(new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname);
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => part.startsWith("."))) throw new Error("path");
    const candidate = resolve(root, "." + (path.endsWith("/") ? path + "index.html" : path));
    if (!candidate.startsWith(root + sep)) throw new Error("path");
    const actual = await realpath(candidate); if (!actual.startsWith(root + sep)) throw new Error("path");
    let data = await readFile(actual); response.setHeader("Content-Type", types[extname(actual)] ?? "application/octet-stream");
    if(windowsEnabled&&actual===join(root,'index.html'))data=Buffer.from(data.toString('utf8').replace('</head>',`<meta name="neptune-hub-session" content="${hubToken}"></head>`));
    response.writeHead(200).end(request.method === "HEAD" ? undefined : data);
  } catch { response.writeHead(404).end("Not found"); }
});
server.listen(port, "127.0.0.1", () => console.log(`晨充统一入口：http://127.0.0.1:${port}；查看不会登记预约或启动充电。`));
