"use client";
import { useEffect, useRef, useState } from 'react';
import { MapPin, LocateFixed, RefreshCw, Navigation } from 'lucide-react';
import { nearbySchema, navigationUrls, rankedStations, stationDistance, type NearbyState } from '@/lib/nearby';
import './integration.css';
import type { QrTarget } from '@/lib/workflow-types';
export default function NearbyPanel({active,busy,onSelect,onReturn,target}:{active:boolean;busy:boolean;onSelect:(number:string)=>Promise<void>;onReturn:()=>void;target:QrTarget|null}) {
  const loading=useRef(false);
  const [data,setData]=useState<NearbyState|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[locating,setLocating]=useState(false),[fix,setFix]=useState<[number,number]|null>(null),[query,setQuery]=useState(''),[availableOnly,setAvailableOnly]=useState(true),[tick,setTick]=useState(Date.now());
  useEffect(()=>{
    if(!active)return;
    let alive=true,timer:ReturnType<typeof setTimeout>;
    const read=async()=>{
      if(document.hidden||loading.current){timer=setTimeout(read,15000);return;}
      loading.current=true;setPending(true);setTick(Date.now());
      try{
        const result=await fetch('/api/nearby',{cache:'no-store',signal:AbortSignal.timeout(30000)}).then(async response=>{if(!response.ok)throw new Error('暂时无法读取空位，请稍后刷新。');return response.json();});
        const parsed=nearbySchema.parse(result);
        if(alive){setData(parsed);setError('');setTick(Date.now());}
      }catch{if(alive)setError('空位读取失败。保留上次数据，请刷新后再判断。');}
      finally{loading.current=false;if(alive){setPending(false);timer=setTimeout(read,20000);}}
    };
    void read();const visible=()=>{if(!document.hidden){clearTimeout(timer);void read();}};window.addEventListener('neptune-refresh-nearby',visible);document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearTimeout(timer);window.removeEventListener('neptune-refresh-nearby',visible);document.removeEventListener('visibilitychange',visible);};
  },[active]);
  const stale=!!data&&(!!error||tick-Date.parse(data.updated_at)>75000);
  const stations=rankedStations(data?.stations||[],fix).filter(s=>(!availableOnly||s.reachable&&s.free>0)&&(!query||[s.name,...s.aliases,...s.devices_detail.map(d=>d.id)].some(text=>text.includes(query.trim()))));
  function locate(){if(!navigator.geolocation){setError('当前浏览器不支持定位。');return;}setLocating(true);navigator.geolocation.getCurrentPosition(position=>{setFix([position.coords.longitude,position.coords.latitude]);setLocating(false);},()=>{setError('没有取得位置。你仍可按站点名查空位。');setLocating(false);},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});}
  return <section id="nearby" className="cw-integration cw-nearby-panel">
    <header className="cw-integration-heading"><MapPin size={18}/><div><h2>玉泉附近空位</h2><p>选一个插座，回到晨充预约</p></div></header>
    <div className="cw-integration-content">
      <div className="cw-integration-toolbar"><button onClick={locate} disabled={locating}><LocateFixed size={16}/>{locating?'定位中…':fix?'重新定位':'按距离找'}</button><button onClick={()=>window.dispatchEvent(new Event('neptune-refresh-nearby'))} disabled={pending}><RefreshCw size={16}/>{pending?'读取中…':'刷新'}</button></div>
      <label className="cw-access-label" htmlFor="nearby-search">搜索站点、别名或设备号</label><input id="nearby-search" className="cw-integration-input" placeholder="搜索站点、别名或设备号" value={query} onChange={event=>setQuery(event.target.value)}/>
      <label className="cw-integration-check"><input type="checkbox" checked={availableOnly} onChange={event=>setAvailableOnly(event.target.checked)}/>只看有空位</label>
      <p className="cw-integration-note">{data?`${data.stations.length} 个站点 · ${data.stations.reduce((n,s)=>n+s.free,0)} 个空位 · ${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(data.updated_at))}${stale?' · 数据已过期':''}`:pending?'正在读取公开设备状态…':'进入栏目后读取实时空位'}</p>
      {(error||data?.last_error)&&<p className="cw-integration-warning" role="status">{error||data?.last_error}</p>}
      {target&&<div className="cw-selected-socket"><span>已选 {target.device}／{target.port}号</span><button onClick={onReturn}>去确认预约</button></div>}
      <div className="cw-stations">{stations.map(station=>{
        const urls=navigationUrls(station),distance=stationDistance(station,fix);
        return <details key={station.name} className="cw-station"><summary><span><strong>{station.name}</strong><small>{fix?`${Math.round(distance)} 米 · 直线估算`:`${station.devices} 台设备`}</small></span><span className="cw-free-count">{station.reachable?station.free:'—'}<small>{stale?'上次空位':'空位'}</small></span></summary>
          <div className="cw-station-content"><div className="cw-nav-links"><a href={urls.amap} target="_blank" rel="noopener noreferrer"><Navigation size={15}/>高德导航</a><a href={urls.baidu} target="_blank" rel="noopener noreferrer">百度导航</a></div>
            {station.devices_detail.map(device=><div key={device.id} className="cw-device"><strong>设备 {device.id}</strong>{!device.reachable?<p className="cw-integration-note">状态读取失败，未计入空位</p>:<><div className="cw-ports">{device.ports.map((port,index)=><button key={index} className={`cw-port cw-port-${port}`} aria-pressed={target?.device===device.id&&Number(target.port)===index+1} disabled={busy||port!=='free'||stale} aria-label={`${device.id}设备${index+1}号插座，${{free:'空闲，选择此插座',used:'使用中',fault:'故障',other:'状态未知'}[port]}`} title={{free:'选择此插座',used:'使用中',fault:'故障',other:'状态未知'}[port]} onClick={async()=>{try{await onSelect(device.id+String(index+1).padStart(2,'0'));}catch(e){setError(e instanceof Error?e.message:'插座未能选择');}}}>{String(index+1).padStart(2,'0')}</button>)}</div>{device.free>0&&!stale&&<details className="cw-payment-entries"><summary>打开官方付款页</summary><p className="cw-integration-note">请在微信内打开对应插座，登录本人账号后复制付款页链接。</p><div className="cw-nav-links">{device.ports.flatMap((port,index)=>port==='free'?[<a key={index} href={`https://www.szlzxn.cn/wechat/wxscan/${device.id}${String(index+1).padStart(2,'0')}`} target="_blank" rel="noopener noreferrer">{String(index+1).padStart(2,'0')}号入口</a>]:[])}</div></details>}</>}</div>)}
          </div></details>;
      })}</div>
      {data&&!stations.length&&<p className="cw-integration-note">当前条件没有匹配站点，可取消“只看有空位”或修改搜索。</p>}
      <p className="cw-integration-note">绿色空闲 · 灰色使用中 · 红色故障。选插座后仍需接好车辆并确认预约。清单可能未覆盖全部玉泉设备；位置只用于本页距离计算，点击导航才交给地图。实际状态以现场为准。</p>
    </div>
  </section>;
}
