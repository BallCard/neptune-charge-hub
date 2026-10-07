"use client";
import { useEffect, useRef, useState } from "react";
import { BatteryCharging, LockKeyhole, ShieldCheck } from "lucide-react";
import ChargeDashboard from "@/components/charge-dashboard";
import MobileSupport from "@/components/mobile-support";
import { applyLocalAction, dashboardFor, expirePlans, publicPlan } from "@/lib/local-data";
import { createVault, encryptData, readEnvelope, storeEnvelope, unlockVault, type Envelope, type UnlockedVault } from "@/lib/local-vault";

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export default function Home() {
  const [loading, setLoading] = useState(true), [stored, setStored] = useState<Envelope | null>(null);
  const [vault, setVault] = useState<UnlockedVault | null>(null), [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(""), [repeat, setRepeat] = useState("");
  const [message, setMessage] = useState(""), busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    void readEnvelope().then(e => { if (active) setStored(e); }).catch(() => { if (active) setMessage("本机存储不可用。请在新版浏览器的普通模式下打开此页面。"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  function lock() { setVault(null); setPassword(""); setRepeat(""); setMessage(""); }
  useEffect(() => {
    if (!vault) return;
    let hiddenAt = 0;
    let timer = window.setTimeout(lock, 5 * 60_000);
    const touched = () => { window.clearTimeout(timer); timer = window.setTimeout(lock, 5 * 60_000); };
    const visible = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= 5 * 60_000) lock();
    };
    document.addEventListener("pointerdown", touched); document.addEventListener("keydown", touched); document.addEventListener("visibilitychange", visible);
    return () => { window.clearTimeout(timer); document.removeEventListener("pointerdown", touched); document.removeEventListener("keydown", touched); document.removeEventListener("visibilitychange", visible); };
  }, [vault]);
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage("");
    try { await work(); } catch (e) { setMessage(e instanceof Error ? e.name === "ZodError" ? "输入字段格式不正确，请核对设备、插座和设置。" : e.message : "操作未完成。"); throw e; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function open(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const saved = await readEnvelope();
      if (saved) { const unlocked = await unlockVault(saved, password); setVault({ ...unlocked, data: expirePlans(unlocked.data) }); setStored(saved); }
      else {
        if (password !== repeat) throw new Error("两次输入的本机密码不一致。");
        const created = await createVault(password); await storeEnvelope(created.envelope, null);
        setStored(created.envelope); setVault(created);
        void navigator.storage?.persist?.().catch(() => false);
      }
      setPassword(""); setRepeat("");
    }).catch(() => {});
  }
  async function action(name: string, payload: Record<string, unknown>) {
    await run(async () => {
      if (!vault) throw new Error("请先解锁本机数据。");
      if (name === "exportBackup") { const saved = await readEnvelope(); if (!saved) throw new Error("本机数据已不存在，请先确认当前浏览器空间。"); download("neptune-encrypted-backup.json", saved); setMessage("加密备份已准备下载；请保留本机密码。"); return; }
      if (name === "exportPlan") { download("neptune-local-plan.json", publicPlan(vault.data, payload.id)); setMessage("计划已导出，不含账号授权；它尚不能自动执行。"); return; }
      const data = applyLocalAction(vault.data, name, payload), envelope = await encryptData(vault.key, data, vault.envelope);
      await storeEnvelope(envelope, vault.envelope); setStored(envelope); setVault({ key: vault.key, data, envelope });
    });
  }
  async function restore(file: File) {
    await run(async () => {
      if (file.size > 2_000_000) throw new Error("备份文件过大。");
      if (await readEnvelope()) throw new Error("当前设备已有本机空间。请在空的浏览器空间恢复备份，避免覆盖数据。");
      const unlocked = await unlockVault(JSON.parse(await file.text()), password);
      await storeEnvelope(unlocked.envelope, null); setStored(unlocked.envelope); setVault({ ...unlocked, data: expirePlans(unlocked.data) });
      setPassword(""); setRepeat("");
    }).catch(() => {});
  }
  if (loading) return <div className="auth-loading">正在读取本机空间…</div>;
  if (vault) return <ChargeDashboard state={{ ...dashboardFor(expirePlans(vault.data)), error: message }} busy={busy} onAction={action} onLogout={lock} />;
  return <><main className="auth-shell">
    <section className="auth-story"><div><div className="auth-brand"><BatteryCharging size={28} /> 晨充 · Neptune Hub</div><h1>安排在手边，<br />数据留身边。</h1><p>把常用插座和下一次充电计划留在自己的手机。安卓和 iPhone 都能使用，同学各自管理自己的空间。</p></div><div className="auth-badge"><ShieldCheck size={16} /> 本机加密保存　<LockKeyhole size={16} /> 无需注册邮箱</div></section>
    <section className="auth-form"><h2>{stored ? "解锁本机空间" : "创建本机空间"}</h2><p>密码只用于这台设备上的数据加密，不会发送给网站。请妥善保存密码和加密备份。</p>
      <form onSubmit={open}>
        <label htmlFor="vault-password">本机密码</label><input id="vault-password" type="password" autoComplete={stored ? "current-password" : "new-password"} minLength={8} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} placeholder="至少8个字符" disabled={busy} />
        {!stored && <><label htmlFor="vault-repeat">再次输入密码</label><input id="vault-repeat" type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={repeat} onChange={e => setRepeat(e.target.value)} disabled={busy} /></>}
        <button type="submit" className="auth-submit" disabled={busy}>{busy ? "正在处理本机数据…" : stored ? "解锁" : "创建并进入"}</button>
        {!stored && <><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void restore(file); e.target.value = ""; }} /><button type="button" className="auth-link" disabled={busy || password.length < 8} onClick={() => fileRef.current?.click()}>使用上面的密码恢复加密备份</button></>}
        {message && <div className="auth-error" role="status">{message}</div>}
      </form>
      <div className="auth-details">当前版本保存充电计划，尚未启用手机定时执行。清除浏览器数据、换浏览器或换手机不会自动同步，请先导出加密备份。密码遗失无法由网站找回。闲置5分钟后自动锁定。</div>
    </section>
  </main><MobileSupport /></>;
}
