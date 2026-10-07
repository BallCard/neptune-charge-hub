import { z } from "zod";
import type { AccountConfig } from "./neptune";
import { defaultPreferences, type DashboardState } from "./contracts";
import { preferencesSchema, validateSchedule } from "./schedule";

const targetSchema = z.object({ id: z.uuid(), label: z.string().min(1).max(40),
  device: z.string().regex(/^\d{8}$/), port: z.string().regex(/^(0[1-9]|[1-9]\d)$/) }).strict();
const configSchema = z.object({ openId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  employeeId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  areaId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  defaultTarget: z.object({ device: z.string().regex(/^\d{8}$/), port: z.string().regex(/^(0[1-9]|[1-9]\d)$/) }).strict() }).strict();
const reservationSchema = z.object({ id: z.uuid(), target_id: z.uuid(), scheduled_at: z.iso.datetime(),
  created_at: z.iso.datetime(), phase: z.enum(["planned", "cancelled", "expired"]),
  result: z.string().max(300), targetLabel: z.string().max(40), device: z.string().regex(/^\d{8}$/),
  port: z.string().regex(/^(0[1-9]|[1-9]\d)$/), maxPrepayCents: z.number().int().min(1).max(200) }).strict();
export const localDataSchema = z.object({ version: z.literal(1), account: configSchema.nullable(),
  targets: z.array(targetSchema).max(50), preferences: preferencesSchema,
  reservations: z.array(reservationSchema).max(1000) }).strict();
export type LocalData = z.infer<typeof localDataSchema>;
export const newLocalData = (): LocalData => ({ version: 1, account: null, targets: [],
  preferences: structuredClone(defaultPreferences), reservations: [] });

/** Only parses the supplied string on this device. Does not send any request. */
export function parseLocalPaymentUrl(raw: string): AccountConfig {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("请复制微信尼普顿付款页的完整链接。"); }
  if (!["https:", "http:"].includes(url.protocol) || !["szlzxn.cn", "www.szlzxn.cn"].includes(url.hostname) ||
    url.pathname !== "/wx/indexn.html" || url.username || url.password || url.port) throw new Error("链接来源或格式不正确。");
  const once = (query: URLSearchParams, key: string) => {
    const values = query.getAll(key);
    if (values.length !== 1 || !values[0]) throw new Error("链接字段缺失或重复。");
    return values[0];
  };
  const fragment = new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1));
  const device = once(url.searchParams, "devaddress");
  const rawPort = once(fragment, "socketNumber");
  if (!/^\d{1,2}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 99 || !/^\d{10}$/.test(device)) throw new Error("设备或插座号不正确。");
  const port = rawPort.padStart(2, "0");
  if (device.slice(-2) !== port) throw new Error("链接中的设备与插座号不一致。");
  const employeeId = once(url.searchParams, "employeeId"), areaId = once(url.searchParams, "areaid");
  if (!/^\d+$/.test(employeeId) || !/^\d+$/.test(areaId)) throw new Error("链接账号字段不正确。");
  return configSchema.parse({ openId: once(url.searchParams, "openId"), employeeId: Number(employeeId),
    areaId: Number(areaId), defaultTarget: { device: device.slice(0, 8), port } });
}
export function expirePlans(data: LocalData, now = Date.now()): LocalData {
  return { ...data, reservations: data.reservations.map(r => r.phase === "planned" && Date.parse(r.scheduled_at) <= now
    ? { ...r, phase: "expired" as const, result: "计划时间已过；本版本未启用自动执行，没有发起充电。" } : r) };
}
export function dashboardFor(data: LocalData): DashboardState {
  return { userEmail: "本机空间", configured: Boolean(data.account), chargingEnabled: true, storageMode: "browser",
    executionMessage: "个人数据只保存在这台设备。当前可保存计划，尚未启用自动执行；关闭网页后不会自行开电。",
    targets: data.targets, preferences: data.preferences, reservations: data.reservations, live: null };
}
export function applyLocalAction(input: LocalData, action: string, payload: Record<string, unknown>, now = Date.now()): LocalData {
  const data = structuredClone(expirePlans(input, now));
  if (action === "refresh") return data;
  if (action === "importAccount") {
    if (data.reservations.some(r => r.phase === "planned")) throw new Error("请先取消现有计划再更换账号。");
    data.account = configSchema.parse(parseLocalPaymentUrl(String(payload.url ?? "")));
    const target = data.account.defaultTarget;
    const existing = data.targets.find(t => t.device === target.device && t.port === target.port);
    if (!existing) data.targets.push(targetSchema.parse({ id: crypto.randomUUID(), label: String(payload.label || "常用充电点"), ...target }));
  } else if (action === "saveTarget") {
    const target = targetSchema.parse({ id: crypto.randomUUID(), label: String(payload.label ?? "").trim(),
      device: String(payload.device ?? ""), port: String(payload.port ?? "").padStart(2, "0") });
    if (data.targets.some(t => t.device === target.device && t.port === target.port)) throw new Error("这个插座已经保存。");
    data.targets.push(target);
  } else if (action === "deleteTarget") {
    if (data.reservations.some(r => r.target_id === payload.id && r.phase === "planned")) throw new Error("请先取消此插座的计划。");
    data.targets = data.targets.filter(t => t.id !== payload.id);
  } else if (action === "savePreferences") {
    data.preferences = preferencesSchema.parse(payload);
  } else if (action === "reserve") {
    if (!data.account) throw new Error("请先在本机绑定账号。");
    const id = z.uuid().parse(payload.idempotencyKey);
    if (data.reservations.some(r => r.id === id)) return data;
    if (data.reservations.some(r => r.phase === "planned")) throw new Error("已有一个待执行的本机计划，请先取消它。");
    const target = data.targets.find(t => t.id === payload.targetId);
    if (!target) throw new Error("请选择已保存的目标插座。");
    const at = validateSchedule(String(payload.scheduledAt ?? ""), payload.confirmedPlug, now);
    data.reservations.unshift({ id, target_id: target.id, scheduled_at: at, phase: "planned", created_at: new Date(now).toISOString(),
      targetLabel: target.label, device: target.device, port: target.port, maxPrepayCents: data.preferences.maxPrepayCents,
      result: "计划已加密保存在本机；尚未启用定时执行，不会自动开电。" });
  } else if (action === "cancel") {
    const booking = data.reservations.find(r => r.id === payload.id);
    if (!booking || booking.phase !== "planned") throw new Error("没有可取消的本机计划。");
    booking.phase = "cancelled"; booking.result = "本机计划已取消；没有发起充电。";
  } else throw new Error("不支持此操作。");
  return localDataSchema.parse(data);
}
export function publicPlan(data: LocalData, id: unknown) {
  const r = data.reservations.find(item => item.id === id);
  if (!r) throw new Error("计划不存在。");
  return { version: 1, kind: "neptune-local-plan", executable: false, id: r.id, phase: r.phase,
    device: r.device, port: r.port, targetLabel: r.targetLabel, scheduledAt: r.scheduled_at,
    maxPrepayCents: r.maxPrepayCents, note: "仅为本机计划；尚未连接执行器，不包含账号授权。" };
}
