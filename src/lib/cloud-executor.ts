import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WorkflowState } from './workflow-types';
let clientPromise: Promise<SupabaseClient | null> | undefined;
/** This configuration contains only the public URL/key. Never return an account credential. */
export function cloudClient(): Promise<SupabaseClient | null> {
  return clientPromise ??= fetch('/cloud-config.json', { cache: 'no-store' }).then(async response => {
    if (!response.ok) return null;
    const config: { url: string; publishableKey: string } = await response.json();
    if (!config.url || !config.publishableKey) return null;
    if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(config.url) || !config.publishableKey.startsWith('sb_publishable_')) throw new Error('云端配置不正确。');
    let storage: Storage | undefined;
    if (typeof window !== 'undefined') {
      try {
        storage = window.localStorage;
        const probe = 'neptune-storage-check';
        storage.setItem(probe, '1'); storage.removeItem(probe);
      } catch { throw new Error('浏览器未允许保存网站数据，请允许后重试。身份需要保存在本浏览器中。'); }
    }
    return createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage } });
  }).catch(error => { clientPromise = undefined; throw error; });
}
export async function cloudAction(action: string, payload: Record<string, unknown>, expectedOwner: string): Promise<WorkflowState> {
  const client = await cloudClient();
  if (!client) throw new Error('云端正在接入，暂时不能登记预约。');
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('本浏览器身份尚未连接，请到设置中重试。');
  if (!expectedOwner || data.session.user.id !== expectedOwner) throw new Error('身份已切换，请重新查看当前记录后再操作。');
  const response = await fetch('/api/web/' + action, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    headers: { [process.env.NEXT_PUBLIC_NEPTUNE_AUTH_HEADER === 'x-neptune-session' ? 'X-Neptune-Session' : 'Authorization']: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  let result: { error?: string; state?: WorkflowState };
  try { result = await response.json(); } catch { throw new Error('云端暂未响应，请刷新查看预约记录后再操作。'); }
  if (!response.ok || !result.state) throw new Error(result.error || '云端操作未完成，请刷新核对。');
  return result.state;
}
