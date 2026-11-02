"use client";
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { cloudClient } from '@/lib/cloud-executor';
import { ensureBrowserIdentity, identityStorageKey, rememberIdentity } from '@/lib/browser-identity';
import { personalOnly } from '@/lib/edition';
import './integration.css';

export default function CloudAccount({ onSession, active = true, legacyRestoreAllowed = false }: {
  onSession: (userId: string | null) => void; active?: boolean; legacyRestoreAllowed?: boolean;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0), [acknowledged, setAcknowledged] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const busy = useRef(false);
  useEffect(() => {
    let alive = true, unsubscribe: (() => void) | undefined;
    setPending(true); setMessage('');
    void cloudClient().then(async client => {
      if (!alive) return;
      if (!client) throw new Error('云端暂未配置，请稍后重试。');
      const update = (next: Session | null) => {
        if (!alive) return;
        setSession(next); onSession(next?.user.id || null);
        if (next) rememberIdentity(next);
      };
      const { data: listener } = client.auth.onAuthStateChange((_event, next) => update(next));
      unsubscribe = () => listener.subscription.unsubscribe();
      if (active && !personalOnly) update(await ensureBrowserIdentity(client));
      else {
        const { data, error } = await client.auth.getSession();
        if (error) throw new Error('本浏览器身份暂未恢复，请重试；原预约不会因此取消。');
        update(data.session);
      }
    }).catch(error => {
      if (alive) setMessage(error instanceof Error ? error.message : '浏览器身份暂未连接，请重试。');
    }).finally(() => { if (alive) setPending(false); });
    return () => { alive = false; unsubscribe?.(); };
  }, [onSession, active, retry]);

  async function restoreLegacy() {
    if (busy.current || pending || (session && !legacyRestoreAllowed)) return;
    busy.current = true; setPending(true); setMessage('');
    try {
      const client = await cloudClient(); if (!client) throw new Error('云端暂不可用。');
      const result = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error || !result.data.session) throw new Error('旧账号恢复未完成，请检查邮箱和密码。');
      setPassword(''); setEmail(''); setMessage('已恢复旧账号，原付款授权和预约保持原样。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '恢复未完成，请重试。'); }
    finally { busy.current = false; setPending(false); }
  }

  return <section className="cw-integration cw-cloud-account">
    <header className="cw-integration-heading"><div><h2>{personalOnly ? '本人账号' : '本浏览器身份'}</h2></div></header>
    <div className="cw-integration-content">
      {session ? <>
        <p className="cw-integration-note">{session.user.is_anonymous ? '已自动记住，无需注册或登录。' : '已沿用原有身份，无需重新登录。'}</p>
        <p className="cw-integration-note">付款授权和预约记录仅属于当前身份。预约生效后由云端执行，关闭网页或电脑不影响。</p>
      </> : <>
        <p className="cw-integration-note">{pending ? '正在连接本浏览器身份…' : personalOnly ? '请恢复已有本人账号。' : '首次使用预约时自动记住本浏览器，不需要邮箱、密码或验证码。'}</p>
        {!personalOnly && <button className="cw-btn-secondary" disabled={pending} onClick={() => setRetry(value => value + 1)}>{pending ? '连接中…' : '重试连接'}</button>}
      </>}
      {!personalOnly && <p className="cw-integration-warning">请使用固定浏览器并保留网站数据。清除数据、使用无痕模式或换设备后，无法自动找回原记录；已经生效的云端预约不会自动取消。</p>}
      {message && <p className="cw-integration-warning" role="status">{message}</p>}
      {!session && message && !pending && !personalOnly && <details>
        <summary>原身份无法恢复</summary>
        <p className="cw-integration-note">重新建立身份不能找回或取消原预约。请先在原浏览器查看记录，并在微信核对本人订单，避免重复预约。</p>
        <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>我已核对原预约，了解原预约不会自动取消</label>
        <button disabled={!acknowledged} onClick={() => { localStorage.removeItem(identityStorageKey); setAcknowledged(false); setRetry(value => value + 1); }}>重新建立本浏览器身份</button>
      </details>}
      {(!session || session.user.is_anonymous) && <details open={personalOnly}>
        <summary>恢复旧版邮箱账号</summary>
        <p className="cw-integration-note">仅用于查看旧版账号的原有记录，新用户无需填写。恢复会切换当前身份。</p>
        {session && !legacyRestoreAllowed && <p className="cw-integration-warning">当前身份已有付款授权或记录，暂不能切换，以免丢失访问入口。</p>}
        <label htmlFor="cloud-email">旧账号邮箱</label><input id="cloud-email" className="cw-input" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} disabled={pending}/>
        <label htmlFor="cloud-password">旧账号密码</label><input id="cloud-password" className="cw-input" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={pending}/>
        <button className="cw-btn-secondary" disabled={pending || !email.trim() || !password || (!!session && !legacyRestoreAllowed)} onClick={() => void restoreLegacy()}>恢复旧账号</button>
      </details>}
    </div>
  </section>;
}
