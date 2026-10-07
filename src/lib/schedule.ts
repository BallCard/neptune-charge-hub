import { z } from "zod";
export const preferencesSchema = z.object({
  defaultTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(v => [...new Set(v)]),
  maxPrepayCents: z.number().int().min(1).max(200),
});
export function validateSchedule(value: string, confirmed: unknown, now = Date.now()) {
  if (confirmed !== true) throw new Error("请先确认车辆和充电器已接好。");
  const at = Date.parse(value);
  if (!Number.isFinite(at) || at < now + 60_000 || at > now + 24 * 3600_000)
    throw new Error("请选择1分钟后至24小时内的预约时间。");
  return new Date(at).toISOString();
}
export function canCancel(phase: string, at: string, now = Date.now()) {
  return ["queued", "scheduled"].includes(phase) && Date.parse(at) > now + 30_000;
}
