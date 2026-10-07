import { createClient } from "@supabase/supabase-js";
import { checkWriteRequest } from "@/lib/database";
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" || !["127.0.0.1", "localhost"].includes(new URL(request.url).hostname)) return new Response(null, { status: 404 });
  try {
    checkWriteRequest(request);
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("已经完成配置，无需重复填写。");
    const body = await request.text();
    if (body.length > 4096) throw new Error("密钥格式不正确。");
    const { key } = JSON.parse(body);
    if (typeof key !== "string" || !/^(sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+)$/.test(key)) throw new Error("请填写Secret或service_role密钥，不能使用公开密钥。");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url || !process.env.ACCOUNT_ENCRYPTION_KEY) throw new Error("项目基础配置尚未保存。");
    const { error } = await createClient(url, key, { auth: { persistSession: false } }).from("charge_accounts").select("user_id").limit(0);
    if (error) throw new Error("密钥验证未通过，请确认来自本次新建项目。");
    const { readFile, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const path = join(process.cwd(), ".env.local");
    const previous = await readFile(path, "utf8");
    const updated = previous.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${key}`);
    if (previous === updated) throw new Error("配置文件缺少对应字段。");
    await writeFile(path, updated, { encoding: "utf8" });
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "配置尚未保存。" }, { status: 400 }); }
}
