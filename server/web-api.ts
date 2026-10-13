import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createHandler } from '../supabase/functions/_shared/handler';
const url='https://jozlxfxhtpximjcfrhya.supabase.co';
let handle: ReturnType<typeof createHandler> | undefined;
const actions=new Set(['health','status','refresh','configureAccount','setTarget','clearTarget','inspectTarget','reserve','cancel','reviewUncertain','deviceProbe','tick']);
export default async function webApi(req:IncomingMessage,res:ServerResponse){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    const incoming=new URL(req.url||'/', 'https://neptune-charge-hub.vercel.app');
    const action=incoming.searchParams.get('action')||incoming.pathname.split('/').at(-1)||'';
    if(!actions.has(action)){res.writeHead(404).end(JSON.stringify({error:'操作不存在。'}));return;}
    if(!handle){
      const key=process.env.NEPTUNE_SUPABASE_SECRET;if(!key)throw Error('Server configuration missing');
      const origins=new Set(['https://neptune-charge-hub.vercel.app','http://127.0.0.1:3086','http://localhost:3086']);
      if(process.env.VERCEL_URL&&/^[a-z0-9-]+\.vercel\.app$/.test(process.env.VERCEL_URL))origins.add('https://'+process.env.VERCEL_URL);
      handle=createHandler(createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),origins);
    }
    const headers=new Headers();for(const name of ['authorization','content-type','origin']){const v=req.headers[name];if(typeof v==='string')headers.set(name,v);}
    const chunks:Uint8Array[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>20000){res.writeHead(413).end(JSON.stringify({error:'提交内容过长。'}));return;}chunks.push(chunk);}
    const response=await handle(new Request('https://neptune-charge-hub.vercel.app/api/web/'+action,{method:req.method,headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body:Buffer.concat(chunks)}:{})}));
    response.headers.forEach((value,name)=>res.setHeader(name,value));res.writeHead(response.status).end(await response.text());
  }catch{res.writeHead(503).end(JSON.stringify({error:'云端暂未响应，请刷新核对预约记录。'}));}
}
