"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import ChargeWorkflow, { type WorkflowTab } from '@/components/charge-workflow';
import Welcome from '@/components/welcome';
import NearbyPanel from '@/components/nearby-panel';
import CloudAccount from '@/components/cloud-account';
import WindowsPanel from '@/components/windows-panel';
import ResponsiveViewport from '@/components/responsive-viewport';
import { cloudAction } from '@/lib/cloud-executor';
import { emptyWorkflow, type QrTarget, type WorkflowState } from '@/lib/workflow-types';
import { parseQrTarget, parseSocketNumber } from '@/lib/qr-target';
import { personalOnly, campusEdition } from '@/lib/edition';
export default function Home() {
  const [activeTab, setActiveTab] = useState<WorkflowTab>('nearby');
  const navigate = useCallback((tab: WorkflowTab) => {
    setActiveTab(tab);
    if (window.location.hash !== `#${tab}`) window.history.pushState(null, '', `#${tab}`);
  }, []);
  useEffect(() => {
    const restore = () => {
      const tab = window.location.hash.slice(1);
      if (['nearby', 'charge', 'records', 'account'].includes(tab)) setActiveTab(tab as WorkflowTab);
      else if (!tab) setActiveTab('nearby');
    };
    restore();
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore); };
  }, []);
  const [state, setState] = useState<WorkflowState>(emptyWorkflow), [busy, setBusy] = useState(false), [signedIn, setSignedIn] = useState<string | null>(null);
  const busyRef = useRef(false);
  const ownerRef = useRef<string | null>(null);
  const draftTarget = useRef<QrTarget | null>(null);
  const onSession = useCallback((value: string | null) => { if (ownerRef.current !== value) { if(ownerRef.current)draftTarget.current=null; ownerRef.current = value; setState({...emptyWorkflow(),target:draftTarget.current}); } setSignedIn(value); }, []);
  useEffect(() => { if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {}); }, []);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true, initializing = true;
    const refresh = () => { if (!initializing && !document.hidden && !busyRef.current) void cloudAction('status',{},signedIn).then(data => { if (alive) setState(data); }).catch(error => { if (alive) setState(s => ({ ...s, executor: { ...s.executor, connected: false }, error: error instanceof Error ? error.message : '云端暂未响应。' })); }); };
    void (async()=>{try{if(draftTarget.current){const result=await cloudAction('setTarget',{target:draftTarget.current},signedIn);if(alive){setState(result);draftTarget.current=null;}}}catch(error){if(alive)setState(s=>({...s,error:error instanceof Error?error.message:'插座选择尚未同步。'}));}finally{initializing=false;if(alive)refresh();}})();
    const timer = window.setInterval(refresh, 15_000); document.addEventListener('visibilitychange', refresh);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [signedIn]);
  async function run(work: () => Promise<void>) {
    if (busyRef.current) throw new Error('正在处理上一项操作，请稍候。');
    busyRef.current = true; setBusy(true); setState(s => ({ ...s, error: undefined }));
    const owner = ownerRef.current;
    try { await work(); } catch (error) { if (ownerRef.current === owner) setState(s => ({ ...s, error: error instanceof Error ? error.message : '操作未完成。' })); throw error; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function applyCloud(action: string, payload: Record<string, unknown>) {
    const owner = ownerRef.current;
    if (!owner) throw new Error('本浏览器身份尚未连接，请到设置中重试。');
    const result = await cloudAction(action, payload, owner);
    if (!owner || ownerRef.current !== owner) throw new Error('身份已切换，请重新查看当前记录。');
    setState(result);
  }
  async function setTarget(target: QrTarget | null) {
    if (signedIn) await applyCloud(target ? 'setTarget' : 'clearTarget', target ? { target } : {});
    else {draftTarget.current=target;setState(s => ({ ...s, target, quote: null }));}
  }
  async function action(name: string, payload: Record<string, unknown>) {
    await run(async () => {
      if (name === 'setTarget') { await setTarget(payload.number ? parseSocketNumber(String(payload.number)) : payload.url ? parseQrTarget(String(payload.url)) : null); return; }
      await applyCloud(name, payload);
    });
  }
  useEffect(() => { const show = () => navigate('nearby'); window.addEventListener('neptune-show-nearby', show); return () => window.removeEventListener('neptune-show-nearby', show); }, [navigate]);
  return <ResponsiveViewport><ChargeWorkflow key={signedIn||'guest'} state={state} busy={busy} onAction={action} activeTab={activeTab} onTabChange={navigate} accountPanel={<CloudAccount onSession={onSession} active={activeTab !== 'nearby'} legacyRestoreAllowed={!busy && state.executor.connected && !state.profile.accountBound && state.bookings.length === 0}/>} nearbyPanel={<NearbyPanel active={activeTab === 'nearby'} busy={busy} target={state.target} onReturn={() => navigate('charge')} onSelect={async number => { await action('setTarget', { number }); }}/> }>
    {!personalOnly && !campusEdition && <WindowsPanel readOnly/>}
  </ChargeWorkflow><Welcome/></ResponsiveViewport>;
}
