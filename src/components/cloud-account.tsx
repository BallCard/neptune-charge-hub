"use client";
import { useEffect, useState } from 'react';
import { cloudClient } from '@/lib/cloud-executor';
import type { Session } from '@supabase/supabase-js';
import './integration.css';
export default function CloudAccount({ onSession }: { onSession: (userId: string | null) => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [identity, setIdentity] = useState(''), [configured, setConfigured] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true, unsubscribe: (() => void) | undefined;
    void cloudClient().then(async client => {
      if (!alive || !client) return;
      setConfigured(true);
      const update = (session: Session | null) => { if (alive) { setIdentity(session?.user.email || ''); setPassword(''); onSession(session?.user.id || null); } };
      const { data } = await client.auth.getSession(); update(data.session);
      if (!alive) return;
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => { update(session); });
      unsubscribe = () => listener.subscription.unsubscribe();
    }).catch(() => { if (alive) setMessage('云端连接暂不可用。'); });
    return () => { alive = false; unsubscribe?.(); };
  }, [onSession]);
  async function authenticate(signUp: boolean) {
    if (pending) return;
    setPending(true); setMessage('');
    try {
      const client = await cloudClient(); if (!client) throw new Error('云端正在接入，暂时不能登录。');
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) throw new Error('请填写邮箱及至少 8 位密码。');
      const result = signUp ? await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin + '/' } }) : await client.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw new Error(signUp ? '注册未完成，请检查邮箱、密码或稍后再试。' : '登录未完成，请检查密码及邮箱确认状态。');
      setPassword(''); if (signUp && !result.data.session) setMessage('请到邮箱确认注册，再回来登录。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '账号操作未完成。'); }
    finally { setPending(false); }
  }
  return <section className="cw-integration cw-cloud-account">
    <header className="cw-integration-heading"><div><h2>{identity ? '晨充账号' : '登录晨充'}</h2><p>{configured ? identity ? '账号已登录' : '登录后同步预约与记录' : '正在连接云端…'}</p></div></header>
    <div className="cw-integration-content">
      {identity ? <><p className="cw-integration-note">{identity}</p><button className="cw-btn-secondary" disabled={pending} onClick={async () => { setPending(true); try { const client = await cloudClient(); const result = await client?.auth.signOut(); if (result?.error) throw new Error('退出未完成，请稍后再试。'); setMessage(''); } catch(error) { setMessage(error instanceof Error ? error.message : '退出未完成。'); } finally { setPending(false); } }}>退出登录</button></> : <>
        <label className="cw-access-label" htmlFor="cloud-email">晨充账号邮箱</label><input id="cloud-email" className="cw-input" type="email" autoComplete="username" placeholder="邮箱" value={email} onChange={event => setEmail(event.target.value)} disabled={!configured || pending}/>
        <label className="cw-access-label" htmlFor="cloud-password">晨充账号密码</label><input id="cloud-password" className="cw-input" type="password" autoComplete="current-password" placeholder="密码（至少 8 位）" value={password} onChange={event => setPassword(event.target.value)} disabled={!configured || pending}/>
        <div className="cw-row cw-mt-8"><button className="cw-btn-primary" disabled={!configured || pending} onClick={() => void authenticate(false)}>{pending ? '处理中…' : '登录'}</button><button className="cw-btn-secondary" disabled={!configured || pending} onClick={() => void authenticate(true)}>注册</button></div>
      </>}
      {message && <p className="cw-integration-warning" role="status">{message}</p>}
      <p className="cw-integration-note">注册需确认邮箱，仅用于账号验证。充电结果在“记录”查看，不发送邮件提醒。</p>
    </div>
  </section>;
}
