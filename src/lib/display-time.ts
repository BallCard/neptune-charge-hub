import type { Preferences } from "./contracts";
export const phaseNames: Record<string, string> = {
  queued: "正在登记", scheduled: "预约已生效", waiting: "等待恢复营业", checking: "核对账号与插座",
  submitting: "正在发起充电", pending: "等待开电确认", confirmed: "已确认启动",
  "already-charging": "已有本人订单", cancelled: "已取消", failed: "未能启动", expired: "已过执行窗口",
  uncertain: "需要微信核对", rejected: "平台拒绝开电",
};
export const activePhases = ["queued", "scheduled", "waiting", "checking", "submitting", "pending", "uncertain"];
export function dateInShanghai(at = Date.now()) { return new Date(at + 8 * 3600_000).toISOString().slice(0, 10); }
export function formatShanghai(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
export function nextAt(time: string, at = Date.now()) {
  const candidate = Date.parse(`${dateInShanghai(at)}T${time}:00+08:00`);
  return new Date(candidate > at + 60_000 ? candidate : candidate + 24 * 3600_000).toISOString();
}
export function upcomingPlans(preferences: Preferences, at = Date.now()) {
  const plans: string[] = [];
  for (let day = 0; day < 8; day++) {
    const date = dateInShanghai(at + day * 24 * 3600_000);
    const candidate = Date.parse(`${date}T${preferences.defaultTime}:00+08:00`);
    const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();
    if (candidate > at + 60_000 && preferences.weekdays.includes(weekday)) plans.push(new Date(candidate).toISOString());
  }
  return plans.slice(0, 4);
}
