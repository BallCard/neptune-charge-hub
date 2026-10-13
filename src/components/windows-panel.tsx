"use client";
import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { z } from 'zod';
import './integration.css';
const windowState=z.object({now:z.string(),next_at:z.string(),target:z.object({device:z.string(),port:z.string(),station:z.string()}).nullable(),booked:z.boolean(),booking_healthy:z.boolean(),can_cancel:z.boolean(),can_reserve:z.boolean(),reservation:z.object({id:z.string(),phase:z.string(),scheduled_at:z.string(),result:z.string().nullable().optional()}).nullable(),live:z.object({connected:z.boolean(),stale:z.boolean(),balance_cents:z.number().nullable().optional(),active_order:z.boolean().optional(),power_watts:z.number().nullable().optional()}),email:z.object({enabled:z.boolean()}),action:z.object({busy:z.boolean(),message:z.string(),success:z.boolean().nullable()}),logs:z.array(z.string()).max(50)});
type WindowsState=z.infer<typeof windowState>;
export default function WindowsPanel({readOnly=false}:{readOnly?:boolean}){
  const [enabled,setEnabled]=useState(false),[state,setState]=useState<WindowsState|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  useEffect(()=>{setEnabled(!!document.querySelector('meta[name="neptune-hub-session"]'));},[]);
  async function request(path:string,body?:Record<string,unknown>){
    const token=document.querySelector<HTMLMetaElement>('meta[name="neptune-hub-session"]')?.content;
    const response=await fetch('/api/windows/'+path,{method:body?'POST':'GET',headers:{'X-Neptune-Hub-Session':token||'',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'Windows 执行器暂不可用');return result;
  }
  useEffect(()=>{
    if(!enabled)return;let alive=true,reading=false;
    const refresh=async()=>{if(document.hidden||reading)return;reading=true;try{const next=windowState.parse(await request('state'));if(alive){setState(next);setError('');}}catch(e){if(alive){setError(e instanceof Error?e.message:'Windows 状态读取失败');setState(null);}}finally{reading=false;}};
    void refresh();const timer=setInterval(refresh,2000);return()=>{alive=false;clearInterval(timer);};
  },[enabled]);
  if(!enabled)return null;
  const date=state?.booked?state.reservation?.scheduled_at:state?.next_at;
  const display=date?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(date)):'明早 06:00';
  async function action(kind:'reserve'|'cancel'){
    if(!state||pending||state.action.busy)return;
    setPending(true);setError('');
    try{await request(kind,kind==='reserve'?{confirmedPlug:true,device:state.target?.device,port:state.target?.port,expectedAt:state.next_at}:{reservationId:state.reservation?.id});const next=windowState.parse(await request('state'));setState(next);}catch(e){setError(e instanceof Error?e.message:'操作未完成，请查看记录');}finally{setPending(false);}
  }
  const fresh=state?.live.connected&&!state?.live.stale;
  return <details className="cw-integration" open={!readOnly}><summary><Monitor size={18}/><strong>此电脑旧预约</strong><span>{readOnly?'保留原任务 · 查看状态':'原任务已接入'}</span></summary><div className="cw-integration-content">
    {state?.target&&<div className="cw-windows-status"><strong className="cw-windows-target">{state.target.station} · {state.target.port}号插座</strong><span>设备 {state.target.device} · {display}</span><span>{state.live.balance_cents==null?'余额待读取':`${fresh?'余额':'上次余额'} ${(state.live.balance_cents/100).toFixed(2)} 元`} · {fresh&&state.live.active_order?'正在充电':'充满自停，最长480分钟'}</span></div>}
    {error&&<p className="cw-integration-warning" role="status">{error}</p>}
    {state?.action.message&&<p className="cw-integration-note">{state.action.message}</p>}
    {fresh&&state?.live.active_order&&<p className="cw-integration-note">当前功率：{state.live.power_watts==null?'待读取':`${state.live.power_watts} W`}，以平台本次读数为准。</p>}
    {state?.reservation?.result&&<p className="cw-integration-note">{state.reservation.result}</p>}
    {state?.booked?<p className="cw-integration-note">{state.booking_healthy?'预约已生效，等待电脑执行。':'预约登记尚未全部确认，请查看原运行记录。'}{readOnly?'此计划未迁移到云端，请勿重复登记。':''}</p>:!readOnly&&<><button className="cw-windows-primary" disabled={!state?.can_reserve||pending||state?.action.busy} onClick={()=>void action('reserve')}>{pending||state?.action.busy?'正在办理…':`已接好，预约 ${display}`}</button><p className="cw-integration-note">点击即确认车辆与充电器已接到上方插座，且会留到预约时间。</p></>}
    {!readOnly&&state?.can_cancel&&<button className="cw-windows-cancel" disabled={pending||state.action.busy} onClick={()=>{if(window.confirm('确定取消此电脑尚未执行的预约？'))void action('cancel');}}>取消电脑预约</button>}
    <footer>电脑需保持登录、联网。旧预约使用原账号与单次任务，结果见最近电脑运行记录。</footer>
    {state&&<details><summary>最近电脑运行记录</summary><ol className="cw-window-logs">{state.logs.slice().reverse().map((line,index)=><li key={index}>{line}</li>)}</ol></details>}
  </div></details>;
}
