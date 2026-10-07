"use client";
import { useState } from "react";
export default function SetupForm({ configured }: { configured: boolean }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setKey(""); setMessage("配置已保存，可以回到聊天继续部署。密钥不会显示在聊天中。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "暂未保存，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return <main className='auth-form' style={{ margin: '10vh auto', padding: '20px' }}><h2>完成云端连接</h2><p>新项目的登录服务与数据库已创建，现在只差这个项目的服务端密钥。</p><p>在 <a href='https://supabase.com/dashboard/project/qnvtuuwvloddxvhmppcd/settings/api-keys' target='_blank' rel='noreferrer'>Supabase 新项目 API Keys</a> 中复制 Secret key（或 Legacy service_role key），粘贴到这里。</p>
    {configured ? <div className='auth-error'>本机已经保存配置，无需重复填写。</div> : <form onSubmit={save}><label htmlFor='setup-key'>本项目 Secret / service_role key</label><input id='setup-key' type='password' autoComplete='off' required value={key} onChange={e => setKey(e.target.value)} spellCheck={false} /><button type='submit' className='auth-submit' disabled={busy}>{busy ? '正在验证…' : '验证并保存到本机'}</button></form>}
    {message && <p className='auth-error' role='status'>{message}</p>}<p className='auth-details'>此入口只在本机开发服务可用。密钥将保存到本项目受 Git 忽略的配置文件，用于服务端访问数据库，不会发送给 Gemini 或放进网页公开代码。</p></main>;
}
