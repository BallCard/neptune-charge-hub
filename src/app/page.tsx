"use client";
import { useEffect, useRef, useState } from "react";
import ChargeWorkflow from "@/components/charge-workflow";
import Welcome from "@/components/welcome";
import { emptyWorkflow, type QrTarget, type WorkflowState } from "@/lib/workflow-types";
import { nativeAction, nativeAvailable } from "@/lib/native-executor";
import { parseQrTarget, parseSocketNumber, readQrImage } from "@/lib/qr-target";

export default function Home() {
  const [state,setState] = useState<WorkflowState>(emptyWorkflow), [busy,setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const refresh = () => { if (nativeAvailable() && !busyRef.current) void nativeAction("status").then(data => { if(alive) setState(data); }).catch(e => { if(alive) setState(s => ({...s,error:e instanceof Error?e.message:"本机执行端未响应。"})); }); };
    refresh(); const timer = window.setInterval(refresh,15_000); window.addEventListener("neptune-native-ready",refresh);
    if (process.env.NODE_ENV === "production" && !nativeAvailable() && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
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
      if(name==="setTarget") { await setTarget(payload.number ? parseSocketNumber(String(payload.number)) : payload.url ? parseQrTarget(String(payload.url)) : null); return; }
      if(name==="refresh" && !nativeAvailable()) return;
      setState(await nativeAction(name,payload));
    });
  }
  async function upload(file: File) { await run(async () => { await setTarget(await readQrImage(file)); }); }
  return <><ChargeWorkflow state={state} busy={busy} onAction={action} onQrFile={upload}/><Welcome/></>;
}
