import { createClient, type User } from "@supabase/supabase-js";
export class PublicError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function database() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new PublicError("云端连接尚未配置，请先完成部署设置。", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function authenticate(request: Request): Promise<User> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new PublicError("请先登录自己的账户。", 401);
  const { data, error } = await database().auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) throw new PublicError("登录已过期，请重新登录。", 401);
  return data.user;
}
export function checkWriteRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new PublicError("请从本站页面进行操作。", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PublicError("请求格式不正确。", 415);
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) throw new PublicError("输入内容过长。", 413);
}
export function requireData<T>(data: T | null, error: unknown): T {
  if (error || data === null) throw new PublicError("云端数据未能保存，请稍后重试。", 503);
  return data;
}
