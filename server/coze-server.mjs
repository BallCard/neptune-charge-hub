import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import webApi,{webActions,checkedOrigin} from './web-api.ts';
import sharedNearby from './nearby-api.mjs';
import directNearby from '../modules/nearby/status.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const mime={html:'text/html; charset=utf-8',js:'application/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8',txt:'text/plain; charset=utf-8',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json',wasm:'application/wasm',woff2:'font/woff2'};
/** @param {{directory:string,manifest:{version:number,release:string,cloudUrl:string,files:string[]},api?:import('node:http').RequestListener,nearby?:import('node:http').RequestListener,publicOrigin?:string}} options */
export function createCozeServer({directory,manifest,api=webApi,nearby,publicOrigin='https://xkrd9zr7b8.coze.site'}){
  checkedOrigin(publicOrigin);
  if(manifest?.version!==1||!Array.isArray(manifest.files)||!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(manifest.cloudUrl))throw Error('Invalid public manifest');
  const allowed=new Set(manifest.files.map(path=>{
    if(typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part.startsWith('.'))||!mime[path.split('.').at(-1)])throw Error('Invalid public asset');
    return '/'+path;
  }));
  if(!allowed.has('/index.html')||!allowed.has('/404.html'))throw Error('Incomplete public assets');
  const base=resolve(directory);
  return createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${manifest.cloudUrl}; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`);
    res.setHeader('Cache-Control','no-store');
    try{
      const path=new URL(req.url||'/','http://localhost').pathname;
      if(path==='/api/nearby'){
        const handler=nearby||(process.env.NEPTUNE_SUPABASE_SECRET?sharedNearby:directNearby);
        await handler(req,res);return;
      }
      if(path.startsWith('/api/web/')&&webActions.has(path.slice('/api/web/'.length))){await api(req,res);return;}
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
      if(path==='/health'){
        res.setHeader('Content-Type','application/json; charset=utf-8');
        res.end(req.method==='HEAD'?undefined:JSON.stringify({app:'neptune-charge-web',ready:true,release:manifest.release,cloudConfigured:!!process.env.NEPTUNE_SUPABASE_SECRET}));return;
      }
      let asset;try{asset=decodeURIComponent(path);}catch{res.writeHead(400).end();return;}
      if(asset.endsWith('/'))asset+='index.html';
      const exists=allowed.has(asset);
      const file=resolve(base,'.'+(exists?asset:'/404.html'));
      if(!file.startsWith(base+sep)){res.writeHead(404).end();return;}
      const body=await readFile(file);
      res.statusCode=exists?200:404;
      res.setHeader('Content-Type',mime[file.split('.').at(-1)]);
      res.setHeader('Cache-Control',exists&&asset.startsWith('/_next/static/')?'public, max-age=31536000, immutable':'no-cache');
      res.end(req.method==='HEAD'?undefined:body);
    }catch{
      res.statusCode=503;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(req.method==='HEAD'?undefined:JSON.stringify({error:'服务暂未响应，请稍后刷新核对。'}));
    }
  });
}

async function main(){
  process.env.NEPTUNE_PUBLIC_ORIGIN||='https://xkrd9zr7b8.coze.site';
  const manifest=JSON.parse(await readFile(resolve(root,'asset-manifest.json'),'utf8'));
  const port=Number(process.env.PORT||5000);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid service port');
  const server=createCozeServer({directory:resolve(root,'public'),manifest,publicOrigin:process.env.NEPTUNE_PUBLIC_ORIGIN});
  server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(JSON.stringify({ready:true,app:'neptune-charge-web',release:manifest.release,staticFiles:manifest.files.length})));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{console.error('Service startup failed; verify the screened package and configuration.');process.exitCode=1;});
