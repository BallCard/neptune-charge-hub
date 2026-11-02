import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHandler, type AccessPolicy } from '../supabase/functions/_shared/handler';
const url='https://jozlxfxhtpximjcfrhya.supabase.co';
export const webActions=new Set(['health','status','refresh','configureAccount','setTarget','clearTarget','inspectTarget','reserve','cancel','reviewUncertain','deviceProbe','tick','operations']);
export function checkedOrigin(value:string):string {
  const parsed=new URL(value);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.port)throw Error('Invalid public origin');
  return parsed.origin;
}
export function createNodeWebApi(admin:SupabaseClient,publicOrigin:string,extraOrigins:string[]=[],policy:AccessPolicy={}){
  const canonical=checkedOrigin(publicOrigin);
  const origins=new Set([canonical,'http://127.0.0.1:3086','http://localhost:3086',...extraOrigins.map(checkedOrigin)]);
  const handle=createHandler(admin,origins,policy);
  return async function nodeWebApi(req:IncomingMessage,res:ServerResponse){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    const incoming=new URL(req.url||'/',canonical);
    // Vercel's internal rewrite uses /api/web?action=...; a public path remains authoritative.
    const action=(incoming.pathname==='/api/web'?incoming.searchParams.get('action'):incoming.pathname.split('/').at(-1))||'';
    if(!webActions.has(action)){res.writeHead(404).end(JSON.stringify({error:'操作不存在。'}));return;}
    const headers=new Headers();for(const name of ['authorization','content-type','origin']){const v=req.headers[name];if(typeof v==='string')headers.set(name,v);}
    const chunks:Uint8Array[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>20000){res.writeHead(413).end(JSON.stringify({error:'提交内容过长。'}));return;}chunks.push(chunk);}
    const response=await handle(new Request(canonical+'/api/web/'+action,{method:req.method,headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body:Buffer.concat(chunks)}:{})}));
    response.headers.forEach((value,name)=>res.setHeader(name,value));res.writeHead(response.status).end(await response.text());
  }catch{res.writeHead(503).end(JSON.stringify({error:'云端暂未响应，请刷新核对预约记录。'}));}
  };
}
let configured:ReturnType<typeof createNodeWebApi>|undefined;
export default async function webApi(req:IncomingMessage,res:ServerResponse){
  try{
    if(!configured){
      const key=process.env.NEPTUNE_SUPABASE_SECRET;if(!key)throw Error('Server configuration missing');
      const extra=process.env.VERCEL_URL&&/^[a-z0-9-]+\.vercel\.app$/.test(process.env.VERCEL_URL)?['https://'+process.env.VERCEL_URL]:[];
      configured=createNodeWebApi(createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),process.env.NEPTUNE_PUBLIC_ORIGIN||'https://neptune-charge-hub.vercel.app',extra,
        {personalOnly:process.env.NEPTUNE_BUILD_EDITION==='personal',personalUserId:process.env.NEPTUNE_PERSONAL_USER_ID});
    }
    await configured(req,res);
  }catch{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
    res.writeHead(503).end(JSON.stringify({error:'云端暂未响应，请刷新核对预约记录。'}));
  }
}
