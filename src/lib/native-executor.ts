import { z } from "zod";
import type { WorkflowState } from "./workflow-types";

declare global { interface Window { NeptuneNative?: { request(raw: string): void } } }
const safeState = z.object({
  executor: z.object({ kind: z.enum(["none","android","windows","ios"]), connected: z.boolean(), exactAlarm: z.boolean(), notifications: z.boolean(), detail: z.string().max(600) }),
  profile: z.object({ accountBound: z.boolean(), mailConfigured: z.boolean(), recipient: z.string().max(254) }),
  target: z.object({ device: z.string().regex(/^\d{8}$/), port: z.string().regex(/^(0[1-9]|[1-9]\d)$/), areaId: z.number().int().positive().optional() }).nullable(),
  quote: z.object({ device: z.string().regex(/^\d{8}$/), port: z.string().regex(/^(0[1-9]|[1-9]\d)$/), checkedAt: z.iso.datetime(), balanceCents: z.number().int().nonnegative(), businessOpen: z.boolean(), available: z.boolean(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    schemes: z.array(z.object({ id: z.string().max(32), title: z.string().max(80), description: z.string().max(300), maxMinutes: z.number().int().positive(), prepayCents: z.number().int().positive() })).max(30) }).nullable(),
  bookings: z.array(z.object({ id: z.uuid(), device: z.string().regex(/^\d{8}$/), port: z.string().regex(/^(0[1-9]|[1-9]\d)$/), scheduledAt: z.iso.datetime(), createdAt: z.iso.datetime(), schemeTitle: z.string().max(80), maxMinutes: z.number().int().positive(),
    phase: z.enum(["scheduled","waiting","checking","submitting","pending","confirmed","already-charging","cancelled","failed","uncertain","reviewed","rejected","missed","scheduling-failed"]), result: z.string().max(600), mailStatus: z.enum(["queued","sent","failed","uncertain","not-required"]), notificationStatus: z.enum(["queued","shown","failed","not-required"]).optional() })).max(200),
});
export function nativeAvailable() { return typeof window !== "undefined" && typeof window.NeptuneNative?.request === "function"; }
export function nativeQuery(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  if (!nativeAvailable()) return Promise.reject(new Error("请在安卓本机助手中配置和预约。手机网页不能独立后台开电。"));
  return new Promise((resolve,reject) => {
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => { clean(); reject(new Error("本机执行端暂未响应。预约结果可能尚未返回，请刷新记录核对，不要重复提交。")); },65_000);
    const clean = () => { window.clearTimeout(timeout); window.removeEventListener("neptune-native-result",done); };
    const done = (event: Event) => {
      const detail = (event as CustomEvent<{id?: string; error?: string; state?: unknown}>).detail;
      if (detail?.id !== id) return; clean();
      if (detail.error) { reject(new Error(detail.error)); return; }
      resolve(detail.state);
    };
    window.addEventListener("neptune-native-result",done);
    try { window.NeptuneNative!.request(JSON.stringify({id,action,payload})); } catch { clean(); reject(new Error("无法连接本机执行端。")); }
  });
}
export async function nativeAction(action: string, payload: Record<string, unknown> = {}): Promise<WorkflowState> {
  const result=await nativeQuery(action,payload);
  try{return safeState.parse(result);}catch{throw new Error("本机执行端返回格式异常，请重新打开助手。");}
}
