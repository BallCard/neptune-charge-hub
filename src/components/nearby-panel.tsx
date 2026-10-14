"use client";
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { MapPin, LocateFixed, RefreshCw, Navigation, X } from 'lucide-react';
import { nearbySchema, navigationUrls, rankedStations, stationDistance, type NearbyState, type Station } from '@/lib/nearby';
import './integration.css';
import type { QrTarget } from '@/lib/workflow-types';
export default function NearbyPanel({active,busy,onSelect,onReturn,target}:{active:boolean;busy:boolean;onSelect:(number:string)=>Promise<void>;onReturn:()=>void;target:QrTarget|null}) {
  const loading=useRef(false);
  const lastTap=useRef<{number:string;at:number}|null>(null);
  const selectingRef=useRef<string|null>(null);
  const [selecting,setSelecting]=useState<string|null>(null);
  function selectSocket(number:string,event:MouseEvent<HTMLButtonElement>) {
    const now=performance.now();
    const pointerClick=event.detail>0 || (event.nativeEvent as PointerEvent).pointerType==='touch';
    const previous=lastTap.current;
    if(pointerClick && previous?.number===number && now-previous.at<=450) {
      lastTap.current=null;
      // Open synchronously in the user gesture, even while the first selection is syncing.
      window.open(`https://www.szlzxn.cn/wechat/wxscan/${number}`,'_blank','noopener,noreferrer');
      return;
    }
    lastTap.current=pointerClick?{number,at:now}:null;
    if(busy || selectingRef.current)return;
    selectingRef.current=number;
    setSelecting(number);
    void onSelect(number).catch(e=>{
      lastTap.current=null;
      setError(e instanceof Error?e.message:'插座未能选择');
    }).finally(()=>{selectingRef.current=null;setSelecting(null);});
  }
  const mapDialog=useRef<HTMLDialogElement>(null);
  const [mapStation,setMapStation]=useState<Station|null>(null);
  useEffect(()=>{if(mapStation)mapDialog.current?.showModal();},[mapStation]);
  const [data,setData]=useState<NearbyState|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[locating,setLocating]=useState(false),[fix,setFix]=useState<[number,number]|null>(null),[query,setQuery]=useState(''),[availableOnly,setAvailableOnly]=useState(false),[tick,setTick]=useState(Date.now());
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
    <header className="cw-integration-heading"><MapPin size={18}/><div><h2>玉泉充电桩</h2><p>{data?<>共 {data.stations.reduce((n,s)=>n+s.total,0)} 口 · <strong>{data.stations.reduce((n,s)=>n+s.free,0)}</strong> 口{stale?'上次空闲':'空闲'}</>:pending?'读取中…':''}</p></div>      <div className="cw-integration-toolbar"><button onClick={locate} disabled={locating}><LocateFixed size={16}/>{locating?'定位中…':fix?'重新定位':'按距离找'}</button><button onClick={()=>window.dispatchEvent(new Event('neptune-refresh-nearby'))} disabled={pending}><RefreshCw size={16}/>{pending?'读取中…':'刷新'}</button></div></header>
    <div className="cw-integration-content">

      <div className="cw-search-row"><label className="cw-access-label" htmlFor="nearby-search">搜索站点、别名或设备号</label><input id="nearby-search" className="cw-integration-input" placeholder="搜索站点或设备" value={query} onChange={event=>setQuery(event.target.value)}/>
      <button className="cw-filter-button" aria-pressed={availableOnly} onClick={()=>setAvailableOnly(!availableOnly)}>{availableOnly?'只看空位':'全部插座'}</button></div>
      <p className="cw-integration-note">{data?`更新于 ${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(data.updated_at))}${stale?' · 数据已过期':''}`:pending?'读取中…':''}</p>
      {(error||data?.last_error)&&<p className="cw-integration-warning" role="status">{error||data?.last_error}</p>}
      {target&&<div className="cw-selected-socket"><span>已选 {target.device}／{target.port}号</span><button onClick={onReturn}>去预约</button></div>}
      <p className="cw-integration-note">单击选中 · 双击打开付款页</p>
      <div className="cw-port-legend"><span>● 空闲</span><span>● 使用中</span><span>● 故障</span><span>○ 未知</span></div>
      <div className="cw-stations">{stations.map(station=>{
        const distance=stationDistance(station,fix);
        return <details key={station.name} className="cw-station" name="nearby-station"><summary><span><strong>{station.name}</strong><small>{fix?`${Math.round(distance)} 米 · 直线估算`:`${station.devices} 台设备`}</small></span><button className="cw-map-button" aria-label={`导航到${station.name}`} onClick={event=>{event.preventDefault();setMapStation(station);}}><Navigation size={15}/>导航</button><span className="cw-free-count">{station.reachable?station.free:'—'}<small>{stale?'上次空位':'空位'}</small></span></summary>
          <div className="cw-station-content">
            {station.devices_detail.map(device=><div key={device.id} className="cw-device"><strong>设备 {device.id}</strong>{!device.reachable?<p className="cw-integration-note">状态读取失败，未计入空位</p>:<><div className="cw-ports" aria-description="单击选中插座，双击打开官方付款页">{device.ports.map((port,index)=><button key={index} className={`cw-port cw-port-${port}`} aria-pressed={target?.device===device.id&&Number(target.port)===index+1} disabled={(busy&&selecting!==device.id+String(index+1).padStart(2,'0'))||port!=='free'||stale} aria-label={`${device.id}设备${index+1}号插座，${{free:'空闲，单击选中，双击打开付款页',used:'使用中',fault:'故障',other:'状态未知'}[port]}`} title={{free:'单击选中，双击打开付款页',used:'使用中',fault:'故障',other:'状态未知'}[port]} onClick={event=>selectSocket(device.id+String(index+1).padStart(2,'0'),event)}>{String(index+1).padStart(2,'0')}<small>{{free:'空闲',used:'占用',fault:'故障',other:'未知'}[port]}</small></button>)}</div></>}</div>)}
          </div></details>;
      })}</div>
      {data&&!stations.length&&<p className="cw-integration-note">暂无匹配站点</p>}
      <p className="cw-integration-note">状态以现场为准。定位仅用于本页距离计算。</p>
    </div>
    <dialog ref={mapDialog} className="cw-map-dialog" aria-labelledby="map-title" onClose={()=>setMapStation(null)}>
      {mapStation&&<><div className="cw-map-heading"><div><h2 id="map-title">{mapStation.name}</h2></div><button aria-label="关闭地图" onClick={()=>mapDialog.current?.close()}><X size={20}/></button></div>

      <p className="cw-integration-note">到达后请核对设备与插座编号。</p>
      <div className="cw-nav-links"><a href={navigationUrls(mapStation).amap} target="_blank" rel="noopener noreferrer"><Navigation size={16}/>高德地图</a><a href={navigationUrls(mapStation).baidu} target="_blank" rel="noopener noreferrer">百度地图</a></div></>}
    </dialog>
  </section>;
}
