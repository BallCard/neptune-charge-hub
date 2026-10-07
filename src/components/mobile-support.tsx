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
    if (process.env.NODE_ENV === "production" && !window.NeptuneNative && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => setMessage("离线缓存暂不可用，联网时仍可使用。"));
    return () => { window.removeEventListener("beforeinstallprompt", capture); window.removeEventListener("appinstalled", done); };
  }, []);
  async function install() {
    if (!prompt) { setMessage(platform === "iPhone" ? "在 Safari 的分享菜单选择“添加到主屏幕”。这个入口不能自行后台开电，iPhone 执行入口尚待验证。" : "在浏览器菜单选择“安装应用”或“添加到主屏幕”。自动预约请下载安卓本机助手。"); return; }
    try { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }
    catch { setMessage("请从浏览器菜单添加到主屏幕。"); }
  }
  return <aside className="mobile-support" aria-label="手机使用与本机数据"><div><strong>{installed ? "网页入口已在主屏幕" : `${platform}也能放到主屏幕`}</strong><p>二维码在本机解析。自动开电由本机助手执行；iPhone 执行入口仍待验证。</p></div>{!installed && <button type="button" onClick={() => void install()}>添加网页到主屏幕</button>}{message && <p role="status">{message}</p>}</aside>;
}
