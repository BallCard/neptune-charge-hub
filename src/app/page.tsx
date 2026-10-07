"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import ChargeDashboard from "@/components/charge-dashboard";
import type { DashboardState } from "@/lib/contracts";
import { BatteryCharging, Cloud, LockKeyhole } from "lucide-react";

export default function Home() {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && key ? createClient(url, key) : null;
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(Boolean(client));
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState("");
  const reload = useCallback(async (live = true) => {
    const token = (await client?.auth.getSession())?.data.session?.access_token;
    if (!token) return;
    const response = await fetch(`/api/hub?live=${live ? "1" : "0"}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "未能读取状态。");
    setState(previous => live ? data : { ...data, live: previous?.live ?? null, error: previous?.error });
  }, [client]);
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, value) => { setSession(value); setLoading(false); if (!value) setState(null); });
    return () => data.subscription.unsubscribe();
  }, [client]);
  useEffect(() => {
    if (!session) return;
    let stopped = false, running = false, lastLive = 0;
    const update = async () => {
      if (stopped || running || document.visibilityState === "hidden") return;
      running = true;
      const live = Date.now() - lastLive > 30_000;
      if (live) lastLive = Date.now();
      try { await reload(live); if (!stopped) setMessage(""); }
      catch (e) { if (!stopped) setMessage(e instanceof Error ? e.message : "暂时无法读取状态。"); }
      finally { running = false; }
    };
    void update();
    const timer = window.setInterval(update, 5000);
    document.addEventListener("visibilitychange", update);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [session, reload]);
  async function login(event: React.FormEvent) {
    event.preventDefault(); if (!client || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = signup ? await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }) : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signup && !result.data.session) setMessage("请到邮箱确认注册，再回来登录。未收到时请检查垃圾邮件。");
      setPassword("");
    } catch { setMessage(signup ? "注册未完成，请核对邮箱、至少8位密码，或稍后重试。" : "登录未成功，请核对邮箱和密码，以及是否已确认邮箱。"); }
    finally { setBusy(false); }
  }
  async function action(name: string, payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const token = (await client?.auth.getSession())?.data.session?.access_token;
      const response = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: name, payload }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "操作未完成。");
      setState(data);
    } catch (e) { const value = e instanceof Error ? e.message : "操作未完成。"; setMessage(value); throw new Error(value); }
    finally { setBusy(false); }
  }
  if (loading) return <div className="auth-loading">正在读取登录状态…</div>;
  if (session && state) return <ChargeDashboard state={{ ...state, error: message || state.error }} busy={busy} onAction={action} onLogout={() => void client?.auth.signOut()} />;
  return <main className="auth-shell">
    <section className="auth-story"><div><div className="auth-brand"><BatteryCharging size={28} /> 晨充 · Neptune Hub</div><h1>接好就预约，<br />醒来再出发。</h1><p>把下一次充电交给云端。时间、设备与插座由你安排，每个人都有自己的充电空间。</p></div><div className="auth-badge"><Cloud size={16} /> 无需电脑常开　 <LockKeyhole size={16} /> 账号独立保存</div></section>
    <section className="auth-form"><h2>{session ? "正在连接你的空间" : signup ? "创建你的充电空间" : "欢迎回来"}</h2><p>使用自己的邮箱登录，管理自己的尼普顿账号和预约。</p>
      {!client ? <div className="auth-error">云端配置尚未完成。部署管理员需要先配置登录服务、数据库和账号加密密钥，然后即可开放给同学使用。</div> : session ? <><div className="auth-error" role="status">{message || "正在读取预约记录…"}</div><button className="auth-link" onClick={() => void reload().catch(e => setMessage(e.message))}>重新连接</button><button className="auth-link" onClick={() => void client.auth.signOut()}>退出登录</button></> : <form onSubmit={login}>
      <label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
      <label htmlFor="password">密码</label><input id="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="至少8位" />
      <button className="auth-submit" type="submit" disabled={busy}>{busy ? "正在连接…" : signup ? "注册" : "进入我的空间"}</button>
      {message && <div className="auth-error" role="status">{message}</div>}<button type="button" className="auth-link" onClick={() => { setSignup(!signup); setMessage(""); }}>{signup ? "已有账户？登录" : "第一次使用？创建账户"}</button>
      </form>}
      <div className="auth-details">首次绑定需从微信尼普顿付款页复制一次链接，后续无需重复。每次预约都要确认车辆已接好。使用本人余额支付，充满自停最长480分钟；实际充电以微信订单和现场情况为准。</div>
    </section>
  </main>;
}
