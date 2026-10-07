"use client";
import { useEffect, useState } from "react";
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export default function MobileSupport() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null), [message, setMessage] = useState("");
  const [platform, setPlatform] = useState("手机"), [installed, setInstalled] = useState(false);
  useEffect(() => {
    setPlatform(/Android/i.test(navigator.userAgent) ? "安卓" : /iPhone|iPad/i.test(navigator.userAgent) ? "iPhone" : "手机");
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", capture); window.addEventListener("appinstalled", done);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => setMessage("离线缓存暂不可用，联网时仍可使用。"));
    return () => { window.removeEventListener("beforeinstallprompt", capture); window.removeEventListener("appinstalled", done); };
  }, []);
  async function install() {
    if (!prompt) { setMessage(platform === "iPhone" ? "在 Safari 的分享菜单选择“添加到主屏幕”。请在添加后的入口中创建本机空间。" : "在浏览器菜单选择“安装应用”或“添加到主屏幕”。请在安装后的入口中创建本机空间。"); return; }
    try { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }
    catch { setMessage("请从浏览器菜单添加到主屏幕。"); }
  }
  return <aside className="mobile-support" aria-label="手机使用与本机数据"><div><strong>{installed ? "已在主屏幕中运行" : `${platform}也能放到主屏幕`}</strong><p>本机保存 · 无云同步 · 自动执行待接入</p></div>{!installed && <button type="button" onClick={() => void install()}>添加到主屏幕</button>}{message && <p role="status">{message}</p>}</aside>;
}
