import type { Session, SupabaseClient } from '@supabase/supabase-js';

export const identityStorageKey = 'neptune-browser-identity-v1';
const identityLock = 'neptune-browser-identity-create';
let initializing: Promise<Session> | undefined;

/** This marker prevents silently replacing a lost identity; it never authorizes requests. */
export function rememberIdentity(session: Session) {
  if (typeof window !== 'undefined') window.localStorage.setItem(identityStorageKey, session.user.id);
}

export function ensureBrowserIdentity(client: SupabaseClient): Promise<Session> {
  if (initializing) return initializing;
  const restore = async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error('本浏览器身份暂未恢复，请重试；原预约不会因此取消。');
    if (data.session) { rememberIdentity(data.session); return data.session; }
    if (typeof window !== 'undefined' && window.localStorage.getItem(identityStorageKey)) {
      throw new Error('本浏览器身份已失效，不能自动找回原记录。已生效预约仍会执行，请先在微信核对；旧邮箱账号可在下方恢复。');
    }
    const result = await client.auth.signInAnonymously();
    if (result.error || !result.data.session) {
      throw new Error(result.error?.status === 429
        ? '当前网络创建身份较多，请稍后重试；端口查看仍可使用。'
        : '暂未建立浏览器身份，请稍后重试；端口查看仍可使用。');
    }
    rememberIdentity(result.data.session);
    return result.data.session;
  };
  // Separate from the SDK session lock: serialize first visits across tabs as well as React mounts.
  initializing = (typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(identityLock, restore)
    : restore()).finally(() => { initializing = undefined; });
  return initializing;
}
