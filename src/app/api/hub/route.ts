import { authenticate, checkWriteRequest, PublicError } from "@/lib/database";
import { stateFor, updateHub } from "@/lib/hub";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  const message = error instanceof PublicError ? error.message : error instanceof z.ZodError ? "输入格式不正确，请核对各项设置。" : "操作未完成，请检查平台账号、设备状态与连接。";
  return Response.json({ error: message }, { status: error instanceof PublicError ? error.status : 400, headers });
}
export async function GET(request: Request) {
  try { return Response.json(await stateFor(await authenticate(request), new URL(request.url).searchParams.get("live") !== "0"), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    checkWriteRequest(request);
    const user = await authenticate(request);
    const text = await request.text();
    if (text.length > 16_384) throw new PublicError("输入内容过长。", 413);
    const body = z.object({ action: z.string().max(40), payload: z.record(z.string(), z.unknown()) }).parse(JSON.parse(text));
    await updateHub(user, body.action, body.payload);
    return Response.json(await stateFor(user), { headers });
  } catch (error) { return failure(error); }
}
