import { authenticate, checkWriteRequest } from "@/lib/database";
import { database } from "@/lib/database";
import { start } from "workflow/api";
import { diagnosticWorkflow } from "@/workflows/diagnostic";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    checkWriteRequest(request);
    const user = await authenticate(request);
    const result = await database().from("charge_diagnostics").insert({ user_id: user.id }).select("id").single();
    if (result.error || !result.data) throw new Error("未能保存自检。");
    const run = await start(diagnosticWorkflow, [result.data.id]);
    const saved = await database().from("charge_diagnostics").update({ workflow_id: run.runId }).eq("id", result.data.id);
    if (saved.error) throw new Error("调度未能确认保存。");
    return Response.json({ id: result.data.id });
  } catch { return Response.json({ error: "自检尚未完成，请核对登录和云端配置。" }, { status: 400 }); }
}
export async function GET(request: Request) {
  try {
    const user = await authenticate(request);
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const { data, error } = await database().from("charge_diagnostics").select("phase,started_at,finished_at,platform_reachable").eq("id", id).eq("user_id", user.id).single();
    if (error || !data) throw new Error("不存在本人的自检。");
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "未找到本人的自检记录。" }, { status: 400 }); }
}
