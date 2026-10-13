export type QrTarget = { device: string; port: string; areaId?: number; label?: string };
export type ChargeScheme = { id: string; title: string; description: string; maxMinutes: number; prepayCents: number };
export type TargetQuote = { device: string; port: string; checkedAt: string; balanceCents: number;
  businessOpen: boolean; available: boolean; fingerprint: string; schemes: ChargeScheme[] };
export type BookingPhase = "scheduled" | "waiting" | "checking" | "submitting" | "pending" | "confirmed" |
  "already-charging" | "cancelled" | "failed" | "uncertain" | "reviewed" | "rejected" | "missed" | "scheduling-failed";
export type WorkflowBooking = { id: string; device: string; port: string; scheduledAt: string; createdAt: string;
  schemeTitle: string; maxMinutes: number; phase: BookingPhase; result: string;
  mailStatus: "queued" | "sent" | "failed" | "uncertain" | "not-required";
  notificationStatus?: "queued" | "shown" | "failed" | "not-required" };
export type WorkflowState = { executor: { kind: "none" | "android" | "windows" | "ios" | "cloud"; connected: boolean;
  exactAlarm: boolean; notifications: boolean; detail: string }; profile: { accountBound: boolean;
  mailConfigured: boolean; recipient: string }; target: QrTarget | null; quote: TargetQuote | null;
  bookings: WorkflowBooking[]; legacyGuard?: { until: string; message: string }; error?: string };
export const workflowPhaseNames: Record<BookingPhase, string> = {
  scheduled: "预约已生效", waiting: "等待恢复营业", checking: "核对账号与插座", submitting: "正在发起充电",
  pending: "等待平台确认", confirmed: "已确认启动", "already-charging": "已有本人订单", cancelled: "已取消",
  failed: "未能启动", uncertain: "结果不明，请在微信核对", rejected: "平台拒绝启动", missed: "执行时间已错过",
  "scheduling-failed": "定时登记失败",
  reviewed: "已人工核对，旧请求不重发",
};
export function tomorrowAt(time = "06:00", now = Date.now()) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("时间格式不正确。");
  const tomorrow = new Date(now + 8 * 3600_000 + 24 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${tomorrow}T${time}:00+08:00`).toISOString();
}
export function formatBookingTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}
export const emptyWorkflow = (): WorkflowState => ({
  executor: { kind: "none", connected: false, exactAlarm: false, notifications: false,
    detail: "请先登录晨充，再导入本人付款授权。预约生效后由云端执行。" },
  profile: { accountBound: false, mailConfigured: false, recipient: "" }, target: null, quote: null, bookings: [],
});
