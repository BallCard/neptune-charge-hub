import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { parsePaymentUrl, accountFingerprint, inspectWebTarget, checkWebReservation, inspectOwnOrder, probePublicDevice, NeptuneError,
  type AccountConfig, type Target, type WebQuote } from '../../../src/lib/neptune.ts';
import { type CloudJob, type JobStore } from './runner.ts';
import { dispatchBatch, schedulerReady } from './dispatch.ts';
const targetSchema=z.object({device:z.string().regex(/^\d{8}$/),port:z.string().regex(/^(0[1-9]|[1-9]\d)$/),areaId:z.number().int().positive().optional()});
const publicBookingFields='id,device,port,scheduled_at,created_at,scheme_title,max_minutes,phase,result';
class ApiError extends Error { constructor(message:string,readonly status=400,readonly retryAfter?:number){super(message);} }
type Profile={config:AccountConfig|null;target:Target|null;quote:WebQuote|null;accountHash:string|null;pinSet:boolean};
export type AccessPolicy = { personalOnly?: boolean; personalUserId?: string };
export type HandlerDeps = { checkReservation?: typeof checkWebReservation };
export function createHandler(admin:SupabaseClient, origins:Set<string>, policy:AccessPolicy = {}, deps:HandlerDeps = {}) {
  const checkReservation = deps.checkReservation ?? checkWebReservation;
  // Validate server-owned configuration; never choose the first caller or trust user_metadata.
  const validPersonalOwner = !!policy.personalUserId && z.uuid().safeParse(policy.personalUserId).success;
  async function rpc(name:string,args:Record<string,unknown>={}) {
    const {data,error}=await admin.rpc(name,args);
    if(error){
      if(error.message.includes('capacity_busy'))throw new ApiError('这个时间段预约较多，请选择其他时段。',409);
      const messages:Record<string,string>={active_plan:'已有待执行或结果不明的预约，暂不能更换授权。',legacy_plan:'已有电脑旧预约，请选择更晚的云端时间。',invalid_time:'请选择至少一分钟后、48小时内的时间。',account_changed:'授权发生变化，请重新核对。',quote_changed:'方案发生变化，请重新核对。',idempotency_conflict:'预约标识与已登记计划不一致，请刷新核对。',pin_required:'预约口令不正确或未填写，请重新输入。',pin_mismatch:'预约口令不正确，请重新输入。',invalid_pin:'预约口令需为6位数字。',not_bound:'请先导入本人付款授权。'};
      if(error.code==='23505')throw new ApiError('已有相同账号的预约或绑定，请刷新核对。',409);
      for(const [code,message] of Object.entries(messages))if(error.message.includes(code))throw new ApiError(message,409);
      throw new ApiError('云端记录暂未完成，请刷新核对后再操作。',503);
    }
    return data;
  }
  const profile=async(user:string):Promise<Profile>=>await rpc('web_profile',{p_user:user})||{config:null,target:null,quote:null,accountHash:null,pinSet:false};
  async function control() {
    const {data,error}=await admin.from('web_control').select('key,value');
    if(error)throw new ApiError('云端运行状态暂不可用。',503);
    return Object.fromEntries((data||[]).map(row=>[row.key,row.value]));
  }
  // Coalesce concurrent public probes only; never cache admission/dispatch controls.
  let pendingHealth:Promise<boolean>|undefined;
  function healthReady() {
    return pendingHealth ??= control().then(c=>schedulerReady(c)).finally(()=>{pendingHealth=undefined;});
  }
  async function state(user:string,targetOverride?:Target|null) {
    const [p,c,bookings]=await Promise.all([profile(user),control(),admin.from('web_reservations').select(publicBookingFields).eq('user_id',user).order('created_at',{ascending:false}).limit(100)]);
    if(bookings.error)throw new ApiError('预约记录暂不可用。',503);
    const ready=schedulerReady(c);
    const activeGuard=c.legacy_guard&&Date.parse(c.legacy_guard.until)>Date.now()?c.legacy_guard:undefined;
    return {executor:{kind:'cloud',connected:true,exactAlarm:ready,notifications:false,detail:ready?'云端按分钟检查；可能延迟，超出十分钟窗口则停止。':'云端执行尚未就绪、延迟或状态异常，暂不能预约。'},
      profile:{accountBound:!!p.config,mailConfigured:false,recipient:'',pinSet:p.pinSet===true},target:targetOverride===undefined?p.target:targetOverride,quote:p.quote,
      ...(activeGuard?{legacyGuard:activeGuard}:{}),bookings:(bookings.data||[]).map(b=>({id:b.id,device:b.device,port:b.port,scheduledAt:b.scheduled_at,createdAt:b.created_at,
        schemeTitle:b.scheme_title,maxMinutes:b.max_minutes,phase:b.phase,result:b.result,mailStatus:'not-required',notificationStatus:'not-required'}))};
  }
  const store:JobStore={
    decrypt:value=>rpc('web_decrypt',{p_cipher:value}),
    consume:(job,prepared)=>rpc('web_consume',{p_id:job.id,p_lease:job.lease_token,p_prepared:prepared}),
    async finish(job,phase,message,prepared,due){if(!await rpc('web_finish',{p_id:job.id,p_lease:job.lease_token,p_phase:phase,p_result:message,p_prepared:prepared,p_due:due}))throw new ApiError('执行状态写入未确认。',503);},
  };
  function response(status:number,body:unknown,origin:string|null){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(origin&&origins.has(origin)?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})}});}
  return async(req:Request):Promise<Response>=>{
    const origin=req.headers.get('Origin'), action=new URL(req.url).pathname.split('/').filter(Boolean).at(-1);
    try{
      if(origin&&!origins.has(origin))throw new ApiError('请求来源不匹配。',403);
      if(policy.personalOnly && !validPersonalOwner)throw new ApiError('个人预约尚未配置完成，暂不能使用。',503);
      if(req.method==='OPTIONS')return new Response(null,{status:204,headers:origin&&origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,GET,OPTIONS',Vary:'Origin'}:{}});
      if(action==='health'&&req.method==='GET'){const ready=await healthReady();return response(ready?200:503,{app:'neptune-charge-web',schemaReady:true,schedulerReady:ready,personalOnly:!!policy.personalOnly},origin);}
      if(req.method!=='POST')throw new ApiError('此操作只支持提交。',405);
      const bearer=req.headers.get('Authorization')?.match(/^Bearer ([^\s]{16,8192})$/)?.[1];
      if(!bearer)throw new ApiError('本浏览器身份尚未连接，请到设置中重试。',401);
      if(action==='tick'||action==='operations'){
        if(!await rpc('web_cron_authorized',{p_secret:bearer}))throw new ApiError('调度验证未通过。',401);
        if(action==='operations')return response(200,await rpc('web_operations'),origin);
        const c=await control();
        if(c.scheduler?.enabled!==true)return response(200,{processed:0,disabled:true},origin);
        const jobs:CloudJob[]=await rpc('web_claim_due',{p_limit:2});
        const report=await dispatchBatch(jobs,store);
        await rpc('web_dispatch_report',{p_claimed:report.claimed,p_processed:report.processed,p_failed:report.failed});
        return response(report.failed?503:200,report,origin);
      }
      // Fresh server validation; never authorize from local session storage, user_metadata or a body user_id.
      const {data,error}=await admin.auth.getUser(bearer);
      if(error||!data.user||(!data.user.is_anonymous&&!data.user.email_confirmed_at))throw new ApiError('浏览器身份已失效，或旧账号邮箱尚未确认，请到设置中核对。',401);
      const user=data.user.id;
      if(policy.personalOnly && user!==policy.personalUserId)throw new ApiError('此预约服务仅供本人使用。',403);
      let sessionId:string;try{const encoded=bearer.split('.')[1];sessionId=JSON.parse(atob(encoded.replaceAll('-','+').replaceAll('_','/'))).session_id;z.uuid().parse(sessionId);}catch{throw new ApiError('登录会话无效，请重新登录。',401);}
      if(!await rpc('web_session_active',{p_user:user,p_session:sessionId}))throw new ApiError('浏览器会话已结束，请到设置中核对；原预约不会因此取消。',401);
      const bucket=action==='status'||action==='refresh'?'read':action==='cancel'||action==='reviewUncertain'?'safety':action==='reserve'?'reserve':action==='setPin'||action==='clearPin'?'pin':'upstream';
      const retry=await rpc('web_rate_limit',{p_user:user,p_bucket:bucket});
      if(!Number.isSafeInteger(retry)||retry<0||retry>60)throw new ApiError('请求限额暂不可核对，请稍后重试。',503);
      if(retry>0)throw new ApiError('操作过于频繁，请稍后重试；取消和结果核对使用独立限额。',429,retry);
      let raw='';const reader=req.body?.getReader(),decoder=new TextDecoder();if(reader)while(true){const part=await reader.read();if(part.done)break;raw+=decoder.decode(part.value,{stream:true});if(raw.length>16384){await reader.cancel();throw new ApiError('提交内容过长。');}}raw+=decoder.decode();
      let payload:Record<string,unknown>;try{payload=JSON.parse(raw||'{}');if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error();}catch{throw new ApiError('提交格式不正确。');}
      if(action==='status'||action==='refresh')return response(200,{state:await state(user)},origin);
      if(action==='deviceProbe')return response(200,await probePublicDevice(targetSchema.parse(payload.target)),origin);
      if(action==='configureAccount'){
        const config=parsePaymentUrl(z.string().max(8192).parse(payload.url));
        const target=payload.target?targetSchema.parse(payload.target):config.defaultTarget;
        const checked=await inspectWebTarget(config,target);config.prices=checked.target.prices;
        await rpc('web_bind',{p_user:user,p_config:config,p_hash:accountFingerprint(config),p_target:checked.target,p_quote:checked.quote});
      }else if(action==='setTarget'||action==='clearTarget'){
        const p=await profile(user), target=action==='clearTarget'?null:targetSchema.parse(payload.target);
        const checked=p.config&&target?await inspectWebTarget(p.config,target):null;
        await rpc('web_target',{p_user:user,p_target:checked?.target||target,p_quote:checked?.quote||null});
      }else if(action==='inspectTarget'){
        const p=await profile(user);if(!p.config||!p.target)throw new ApiError('请先导入付款授权并选择插座。');
        const checked=await inspectWebTarget(p.config,p.target);
        await rpc('web_target',{p_user:user,p_target:checked.target,p_quote:checked.quote});
      }else if(action==='reserve'){
        const input=z.object({idempotencyKey:z.uuid(),confirmedPlug:z.literal(true),target:targetSchema,schemeId:z.string().max(32),quoteFingerprint:z.string().regex(/^[a-f0-9]{64}$/),scheduledAt:z.iso.datetime(),maxPrepayCents:z.number().int().min(1).max(1000),pin:z.string().regex(/^\d{6}$/).optional()}).parse(payload);
        const c=await control();if(!schedulerReady(c))throw new ApiError('云端执行延迟或状态异常，暂不能登记，请稍后重试。',503);
        const p=await profile(user);if(!p.config||!p.quote||!p.target||p.target.device!==input.target.device||p.target.port!==input.target.port||p.quote.fingerprint!==input.quoteFingerprint)throw new ApiError('目标或方案发生变化，请重新核对。',409);
        if(p.pinSet&&!input.pin)throw new ApiError('本浏览器已设置预约口令，请先输入6位口令。',409);
        // Cheap check first: a wrong PIN never triggers a platform read or a new plan.
        if(p.pinSet&&await rpc('web_verify_pin',{p_user:user,p_pin:input.pin})!==true)throw new ApiError('预约口令不正确，请重新输入。',409);
        const checked=await checkReservation(p.config,p.target,input.schemeId,input.quoteFingerprint,input.maxPrepayCents);
        await rpc('web_reserve',{p_user:user,p_id:input.idempotencyKey,p_scheduled:input.scheduledAt,p_target:checked.target,p_scheme:checked.selected,p_cap:input.maxPrepayCents,p_pin:input.pin??null,
          p_snapshot:{config:p.config,target:checked.target,schemeId:input.schemeId,fingerprint:input.quoteFingerprint,maxPrepayCents:input.maxPrepayCents}});
      }else if(action==='cancel'){
        if(!await rpc('web_cancel',{p_user:user,p_id:z.uuid().parse(payload.id)}))throw new ApiError('取消未生效：预约已进入开电提交或已结束，请刷新核对。',409);
      }else if(action==='reviewUncertain'){
        const input=z.object({id:z.uuid(),confirmedReview:z.literal(true)}).parse(payload);
        const {data:booking,error:readError}=await admin.from('web_reservations').select('snapshot_cipher,phase').eq('id',input.id).eq('user_id',user).maybeSingle();
        if(readError||!booking||booking.phase!=='uncertain')throw new ApiError('待核对记录不存在。',404);
        const snapshot=await rpc('web_decrypt',{p_cipher:booking.snapshot_cipher});
        if((await inspectOwnOrder(snapshot.config,snapshot.target)).any)throw new ApiError('平台仍有本人当前订单，请在微信核对，暂不能解除。',409);
        if(!await rpc('web_review',{p_user:user,p_id:input.id}))throw new ApiError('核对仍在进行，请稍后刷新。',409);
      }else if(action==='setPin'){
        const input=z.object({pin:z.string().regex(/^\d{6}$/),currentPin:z.string().regex(/^\d{6}$/).optional()}).parse(payload);
        await rpc('web_set_pin',{p_user:user,p_pin:input.pin,p_current:input.currentPin??null});
      }else if(action==='clearPin'){
        const input=z.object({pin:z.string().regex(/^\d{6}$/)}).parse(payload);
        await rpc('web_clear_pin',{p_user:user,p_pin:input.pin});
      }else throw new ApiError('此操作不存在。',404);
      return response(200,{state:await state(user)},origin);
    }catch(error){
      if(error instanceof ApiError){const result=response(error.status,{error:error.message},origin);if(error.retryAfter)result.headers.set('Retry-After',String(error.retryAfter));return result;}
      if(error instanceof NeptuneError)return response(400,{error:error.message},origin);
      if(error instanceof z.ZodError)return response(400,{error:'输入内容不正确，请核对后再提交。'},origin);
      return response(503,{error:'云端暂未响应，请刷新核对预约记录；不会自动重复新建开电。'},origin);
    }
  };
}
