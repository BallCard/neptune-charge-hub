"use client";
import { useEffect, useRef, useState } from "react";
import ChargeWorkflow from "@/components/charge-workflow";
import MobileSupport from "@/components/mobile-support";
import { emptyWorkflow, type QrTarget, type WorkflowState } from "@/lib/workflow-types";
import { nativeAction, nativeAvailable } from "@/lib/native-executor";
import { parseQrTarget, readQrImage } from "@/lib/qr-target";
import "@/components/workflow-base.css";

export default function Home() {
  const [state,setState] = useState<WorkflowState>(emptyWorkflow), [busy,setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const refresh = () => { if (nativeAvailable() && !busyRef.current) void nativeAction("status").then(data => { if(alive) setState(data); }).catch(e => { if(alive) setState(s => ({...s,error:e instanceof Error?e.message:"本机执行端未响应。"})); }); };
    refresh(); const timer = window.setInterval(refresh,15_000); window.addEventListener("neptune-native-ready",refresh);
    return () => { alive=false; window.clearInterval(timer); window.removeEventListener("neptune-native-ready",refresh); };
  },[]);
  async function run(work: () => Promise<void>) {
    if (busyRef.current) throw new Error("正在处理上一项操作，请稍候。");
    busyRef.current=true; setBusy(true); setState(s => ({...s,error:undefined}));
    try { await work(); } catch(e) { setState(s => ({...s,error:e instanceof Error?e.message:"操作未完成。"})); throw e; }
    finally { busyRef.current=false; setBusy(false); }
  }
  async function setTarget(target: QrTarget | null) {
    if (nativeAvailable()) {
      if (target) setState(await nativeAction("setTarget",{target}));
      else setState(await nativeAction("clearTarget"));
    } else setState(s => ({...s,target,quote:null}));
  }
  async function action(name: string,payload: Record<string,unknown>) {
    await run(async () => {
      if(name==="setTarget") { await setTarget(payload.url ? parseQrTarget(String(payload.url)) : null); return; }
      if(name==="refresh" && !nativeAvailable()) return;
      setState(await nativeAction(name,payload));
    });
  }
  async function upload(file: File) { await run(async () => { await setTarget(await readQrImage(file)); }); }
  return <><ChargeWorkflow state={state} busy={busy} onAction={action} onQrFile={upload}/>
    {state.executor.connected ? <footer className="workflow-footer"><button disabled={busy} onClick={() => void action("restoreBackup",{}).catch(() => {})}>恢复配置备份</button><p>本机助手独立执行预约。网页版与助手的本机空间互不自动同步。</p></footer> : <MobileSupport/>}</>;
}
