"use strict";
const token = document.querySelector('meta[name="neptune-session"]').content;
const el = id => document.getElementById(id);
let state = null, fetching = false, pendingClick = false, localNotice = "", localNoticeError = false;
const phases = {confirmed:"启动已确认", "already-charging":"已有充电订单", failed:"预约未能执行", rejected:"平台拒绝启动", uncertain:"开电结果待核对", expired:"已错过执行时间", cancelled:"预约已取消", ready:"等待自动执行", submitting:"正在发送充电请求", pending:"正在确认开电"};
const format = (iso, options) => new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai", ...options}).format(new Date(iso));
const dateText = iso => format(iso, {month:"long",day:"numeric"});
const timeText = iso => format(iso, {hour:"2-digit",minute:"2-digit",hour12:false});
const set = (id, text) => { el(id).textContent = text; };
function numberMetric(id, value, suffix, decimals=0) {
  const node = el(id); node.replaceChildren();
  node.append(document.createTextNode(value == null ? "—" : Number(value).toFixed(decimals)));
  const small = document.createElement("small"); small.textContent = ` ${suffix}`; node.append(small);
}
async function call(path, body) {
  const options = {headers:{"X-Neptune-Session":token}, cache:"no-store"};
  if(body !== undefined) {options.method="POST"; options.headers["Content-Type"]="application/json"; options.body=JSON.stringify(body);}
  const response=await fetch(path, options); const result=await response.json();
  if(!response.ok) throw new Error(result.error || "暂时无法读取状态，请重新打开界面。");
  return result;
}
function showNotice(message, error=false) {
  el("notice").hidden=!message; set("notice",message); el("notice").className=`notice${error?" error":""}`;
}
function renderProgress(s) {
  const r=s.reservation, p=s.progress;
  let index=0, failed=false, message="尚未预约。接好车辆后，可以预约下一次早上 6:00。";
  if(r) {
    set("progress-date",`${dateText(r.scheduled_at)} ${timeText(r.scheduled_at)}`);
    if(["confirmed","already-charging"].includes(r.phase)) index=4;
    else if(r.phase==="pending") index=3;
    else if(r.phase==="submitting") index=2;
    else if(r.phase==="ready") {
      index=1;
      if(new Date(s.now)>=new Date(r.scheduled_at)) index=["checking","submitting"].includes(p?.stage)?2:1;
    } else if(r.phase!=="cancelled") {index=r.submitted_at?3:1; failed=true;}
    message=r.result || (new Date(s.now)<new Date(r.scheduled_at)?"预约已登记，等待指定时间自动执行。":p?.message) || "正在准备自动执行。";
    if(r.phase==="cancelled") {index=0; message="本次预约已取消。";}
    if(r.armed && !s.booked) {failed=true; message="预约时间已过，请查看运行记录和微信订单。";}
  } else set("progress-date","暂无预约");
  const labels=["预约就绪","恢复供电","核对并开电","启动确认"];
  const captions=[r?"预约已记录":"尚未预约","营业后等待恢复","账户与插座核对","平台与订单确认"];
  const list=el("timeline");list.replaceChildren();
  labels.forEach((label,i)=>{
    const li=document.createElement("li");
    li.className= i<index ? (failed&&i===index-1?"failed":"done") : (i===index&&r&&!failed?"active":"");
    const dot=document.createElement("span");dot.className="step-dot";dot.textContent=li.className==="done"?"✓":li.className==="failed"?"!":String(i+1);
    const strong=document.createElement("strong");strong.textContent=label;
    const caption=document.createElement("span");caption.textContent=captions[i];
    li.append(dot,strong,caption);list.append(li);
  });
  set("progress-message",message);
}
function render(s) {
  const live=s.live, fresh=live.connected&&!live.stale, r=s.reservation;
  set("updated",`更新于 ${format(s.now,{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})}`);
  set("connection",fresh?"平台已连接":live.error?"连接暂不可用":"连接中");el("connection").className=`badge${fresh?"":live.error?" warn":" neutral"}`;
  let title=r?phases[r.phase]||"准备就绪":"尚未预约", description="接好车辆后，预约下一次早上 6:00。", tone="";
  if(r?.result) description=r.result;
  if(s.booked) {title=phases[r.phase];description=`${dateText(r.scheduled_at)} ${timeText(r.scheduled_at)} 自动执行，只预约这一次。`;tone="pending";}
  if(r&&["failed","rejected","uncertain","expired"].includes(r.phase)) tone="error";
  if(r&&["confirmed","already-charging"].includes(r.phase)) {tone="good";if(fresh&&!live.active_order) title="本次订单已结束";description=fresh&&!live.active_order?"平台当前没有进行中的目标充电订单。":"本次启动已确认，正在更新平台状态。";}
  if(fresh&&live.active_order) {title="正在充电";description="平台有本人的目标插座订单，充满后自动停止。";tone="good";}
  if(live.other_order&&fresh) {title="其他插座有进行中的订单";description="请先在微信核对，当前暂停新预约。";tone="pending";}
  if(!s.target) {title="需要配置账号";description="首次使用，请先运行项目中的 setup-account.cmd。";}
  if(r?.armed&&!s.booked) {title="预约时间已过";description="未记录到完成的执行结果，请在微信核对订单。";tone="error";}
  set("current-title",title);set("current-description",description);el("status-dot").className=`status-dot ${tone}`;
  if(s.target) {set("station",s.target.station);set("target-text",`设备 ${s.target.device} · 插座 ${s.target.port}`);set("port",s.target.port);}
  numberMetric("power",fresh&&live.active_order?live.power_watts:null,"W");
  set("power-note",live.updated_at?`平台数据 ${timeText(live.updated_at)}${fresh?"":" · 待刷新"}`:"等待平台数据");
  numberMetric("balance",live.balance_cents==null?null:live.balance_cents/100,"元",2);
  set("balance-label",fresh?"账户余额":"上次读取的余额");
  set("prepay",live.prepay_cents==null?"最多 2 元":`${(live.prepay_cents/100).toFixed(2)} 元`);
  const at=s.booked?r.scheduled_at:s.next_at;
  set("booking-day",`${dateText(at)} · ${format(at,{weekday:"long"})}`);
  set("booking-badge",s.booked?(s.booking_healthy?"已预约":"需要检查"):"未预约");el("booking-badge").className=`badge${s.booked?(s.booking_healthy?"":" warn"):" neutral"}`;
  const busy=s.action.busy||pendingClick;
  el("reserve").disabled=busy||!s.can_reserve;
  set("reserve",busy?"正在办理…":s.booked?"预约已登记":!s.target?"请先配置账号":!fresh?"等待平台连接":live.other_order?"请先核对已有订单":"已接好，预约 06:00");
  el("cancel").hidden=!s.can_cancel;el("cancel").disabled=busy;
  set("booking-hint",s.booked?"这次预约会自动执行。执行前可以取消；开始充电后请在微信结束订单。":`点击即确认车辆与充电器已接好，并会留在 ${s.target?.port||"目标"} 号插座直到预约时间。`);
  set("mail-recipient",s.email.enabled?s.email.recipient:"暂未启用邮件提醒");el("mail-dot").style.background=s.email.enabled?"#219363":"#b1bab3";
  let note=localNotice||s.action.message, error=localNotice?localNoticeError:s.action.success===false;
  if(s.booked&&!s.booking_healthy&&!busy) {note="预约文件已保存，但电脑任务尚未全部确认。请查看记录，取消后重新预约。";error=true;}
  else if(s.task_error&&!note) {note=s.task_error;error=true;}
  else if(live.error&&!note) {note=live.error;error=true;}
  showNotice(note,error);
  renderProgress(s);updateCountdown();
  const logs=el("logs");logs.replaceChildren();
  (s.logs.length?s.logs.slice().reverse():["还没有运行记录。"]).forEach(line=>{
    const li=document.createElement("li");const match=line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(.+)$/);
    if(match) {const time=document.createElement("time");time.textContent=match[1];li.append(time,document.createTextNode(match[2]));}else li.textContent=line;
    logs.append(li);
  });
}
function updateCountdown() {
  if(!state) return;
  if(!state.booked) {set("countdown","营业开始后自动检查并启动");return;}
  const milliseconds=new Date(state.reservation.scheduled_at)-Date.now();
  if(milliseconds<=0) {set("countdown","已到执行时间，进度会自动更新");return;}
  const minutes=Math.floor(milliseconds/60000), hours=Math.floor(minutes/60);
  set("countdown",`距离执行还有 ${hours?`${hours} 小时 `:""}${minutes%60} 分钟`);
}
async function refresh() {
  if(fetching||document.hidden) return;fetching=true;
  try {state=await call("/api/state");render(state);}catch(error) {showNotice(`${error.message} 已登记的预约由电脑任务独立执行。`,true);set("connection","界面连接中断");el("reserve").disabled=true;}
  finally {fetching=false;}
}
async function action(kind) {
  if(!state||pendingClick||state.action.busy) return;
  pendingClick=true;localNotice="";render(state);
  const body=kind==="reserve"?{confirmedPlug:true,device:state.target.device,port:state.target.port,expectedAt:state.next_at}:{reservationId:state.reservation.id};
  try {await call(`/api/${kind}`,body);}catch(error) {localNotice=error.message;localNoticeError=true;}
  finally {pendingClick=false;await refresh();}
}
el("reserve").addEventListener("click",()=>action("reserve"));
el("cancel").addEventListener("click",()=>action("cancel"));
el("refresh").addEventListener("click",async()=>{localNotice="";try {await call("/api/refresh",{});await refresh();}catch(error){showNotice(error.message,true);}});
document.addEventListener("visibilitychange",()=>{if(!document.hidden) refresh();});
setInterval(refresh,2000);setInterval(updateCountdown,1000);refresh();
