"use client";
import { useEffect, useRef, useState } from "react";
import { Moon, Sun, Bell, X } from "lucide-react";
import "./welcome.css";

const SEEN_KEY = "neptune-welcome-v1";
export default function Welcome() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(localStorage.getItem(SEEN_KEY) !== "seen"); } catch { setOpen(true); }
    const show = () => setOpen(true);
    window.addEventListener("neptune-show-welcome", show);
    return () => window.removeEventListener("neptune-show-welcome", show);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  function dismiss() {
    try { localStorage.setItem(SEEN_KEY, "seen"); } catch { /* A blocked preference store does not block use. */ }
    setOpen(false);
  }
  return <dialog ref={dialog} className="cw-welcome" aria-labelledby="cw-welcome-title" onCancel={event => { event.preventDefault(); dismiss(); }}>
    <button type="button" className="cw-welcome-close" aria-label="关闭介绍" onClick={dismiss}><X size={20}/></button>
    <span className="cw-welcome-tag">晨充 · 本机预约助手</span>
    <h2 id="cw-welcome-title">今晚接好，<br/>明早开电。</h2>
    <p className="cw-welcome-lead">晚上停好电动车，想等明早开始充电？把预约提前安排好。</p>
    <ol className="cw-welcome-flow">
      <li><Moon size={20}/><div><strong>今晚安排</strong><span>上传插座二维码，导入本人付款页授权，选择充电方案。</span></div></li>
      <li><Sun size={20}/><div><strong>默认明早 6:00</strong><span>确认车辆已接好，本机助手到点核对并尝试开电；时间可改。</span></div></li>
      <li><Bell size={20}/><div><strong>手机通知结果</strong><span>启动确认、失败或结果不明，都会提醒你查看。</span></div></li>
    </ol>
    <p className="cw-welcome-note">账号与预约留在本机。自动执行需安卓本机助手保持开机联网；手机网页可识别二维码，iPhone 自动执行还未验证。</p>
    <button type="button" className="cw-welcome-start" onClick={dismiss}>开始使用</button>
  </dialog>;
}
