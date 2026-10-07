import type { User } from "@supabase/supabase-js";
import { database, PublicError, requireData } from "./database";
import { seal, unseal, fingerprint } from "./crypto";
import { defaultPreferences, type DashboardState } from "./contracts";
import { canCancel, preferencesSchema, validateSchedule } from "./schedule";
import { inspectAccount, inspectTarget, parsePaymentUrl, readLive, type AccountConfig } from "./neptune";
import { z } from "zod";

const activePhases = ["queued", "scheduled", "waiting", "checking", "submitting", "pending", "uncertain"];
export const chargingEnabled = () => process.env.CHARGING_ENABLED === "true";
async function account(userId: string) {
  const { data, error } = await database().from("charge_accounts").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new PublicError("云端数据库尚未就绪。", 503);
  return data;
}
async function requireNoActive(userId: string) {
  const { data, error } = await database().from("charge_reservations").select("id").eq("user_id", userId).in("phase", activePhases).limit(1);
  if (error) throw new PublicError("未能核对预约状态。", 503);
  if (data?.length) throw new PublicError("请先取消或等待当前预约结束，再修改账号或目标。");
}
export async function stateFor(user: User, includeLive = true): Promise<DashboardState> {
  const db = database();
  const a = await account(user.id);
  const [targetsResult, reservationsResult] = await Promise.all([
    db.from("charge_targets").select("id,label,device,port").eq("user_id", user.id).order("label"),
    db.from("charge_reservations").select("id,target_id,scheduled_at,phase,result,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const targets = requireData(targetsResult.data, targetsResult.error);
  const reservations = requireData(reservationsResult.data, reservationsResult.error);
  let live: DashboardState["live"] = null;
  let error: string | undefined;
  if (includeLive && a && targets.length) {
    try {
      const current = reservations.find(r => activePhases.includes(r.phase));
      let config = unseal<AccountConfig>(a.account_cipher, user.id);
      let target = targets.find(t => t.id === current?.target_id) ?? targets[0];
      if (current) {
        const frozen = await db.from("charge_reservations").select("account_cipher").eq("id", current.id).eq("user_id", user.id).single();
        if (frozen.error || !frozen.data) throw new Error("Active snapshot unavailable");
        const snapshot = unseal<{ config: AccountConfig; target: typeof target }>(frozen.data.account_cipher, user.id);
        config = snapshot.config;
        target = snapshot.target;
      }
      const value = await readLive(config, target);
      live = value;
    } catch { error = "平台状态暂时读取失败，请稍后刷新；预约记录仍已保存。"; }
  }
  return { userEmail: user.email ?? "", configured: Boolean(a), chargingEnabled: chargingEnabled(),
    targets, reservations, preferences: a?.preferences ?? defaultPreferences, live, error };
}
export async function updateHub(user: User, action: string, payload: Record<string, unknown>) {
  const db = database();
  if (action === "refresh") return;
  if (action === "importAccount") {
    await requireNoActive(user.id);
    const input = z.object({ url: z.string().max(8000), label: z.string().trim().min(1).max(40).default("常用充电点") }).parse(payload);
    const cfg = parsePaymentUrl(input.url);
    await inspectAccount(cfg);
    const target = await inspectTarget(cfg, cfg.defaultTarget);
    cfg.prices = target.prices;
    const result = await db.from("charge_accounts").upsert({ user_id: user.id,
      account_hash: fingerprint(cfg.openId), account_cipher: seal(cfg, user.id) }, { onConflict: "user_id" });
    if (result.error) throw new PublicError("绑定失败，该尼普顿账号可能已绑定另一位使用者。");
    const saved = await db.from("charge_targets").upsert({ user_id: user.id, label: input.label,
      ...cfg.defaultTarget, prices: target.prices }, { onConflict: "user_id,device,port" });
    if (saved.error) throw new PublicError("账号已保存，但设备尚未保存，请在设置中添加设备。");
    return;
  }
  const a = await account(user.id);
  if (!a) throw new PublicError("请先绑定自己的尼普顿账号。");
  if (action === "savePreferences") {
    const preferences = preferencesSchema.parse(payload);
    const { error } = await db.from("charge_accounts").update({ preferences }).eq("user_id", user.id);
    if (error) throw new PublicError("偏好未能保存。", 503);
    return;
  }
  if (action === "saveTarget") {
    await requireNoActive(user.id);
    const input = z.object({ label: z.string().trim().min(1).max(40), device: z.string().regex(/^\d{8}$/), port: z.string().regex(/^\d{1,2}$/) }).parse(payload);
    input.port = input.port.padStart(2, "0");
    const cfg = unseal<AccountConfig>(a.account_cipher, user.id);
    const value = await inspectTarget(cfg, input);
    const { error } = await db.from("charge_targets").upsert({ ...input, user_id: user.id, prices: value.prices }, { onConflict: "user_id,device,port" });
    if (error) throw new PublicError("目标未能保存。", 503);
    return;
  }
  if (action === "deleteTarget") {
    await requireNoActive(user.id);
    const id = z.string().uuid().parse(payload.id);
    const { error } = await db.from("charge_targets").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw new PublicError("有历史预约的设备需要保留，以便核对记录。");
    return;
  }
  if (action === "cancel") {
    const id = z.string().uuid().parse(payload.id);
    const { data, error } = await db.from("charge_reservations").select("phase,scheduled_at").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (error || !data || !canCancel(data.phase, data.scheduled_at)) throw new PublicError("预约已开始执行或不存在，请在微信核对。");
    const changed = await db.from("charge_reservations").update({ phase: "cancelled", result: "本人已取消预约。", finished_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", user.id).in("phase", ["queued", "scheduled"]).gt("scheduled_at", new Date(Date.now() + 30_000).toISOString()).select("id");
    if (changed.error || !changed.data?.length) throw new PublicError("执行状态已变化，未能取消；请刷新并核对订单。");
    return;
  }
  if (action === "resolveUncertain") {
    const input = z.object({ id: z.string().uuid(), confirmedReviewed: z.literal(true) }).parse(payload);
    const row = await db.from("charge_reservations").select("account_cipher").eq("id", input.id).eq("user_id", user.id).eq("phase", "uncertain").single();
    if (row.error || !row.data) throw new PublicError("没有本人的待核对预约。");
    const frozen = unseal<{ config: AccountConfig; target: { device: string; port: string } }>(row.data.account_cipher, user.id);
    const live = await readLive(frozen.config, frozen.target);
    if (live.otherOrder) throw new PublicError("本人还有其他插座订单，请先在微信核对并结束后再操作。");
    const saved = await db.from("charge_reservations").update({ phase: live.activeOrder ? "already-charging" : "failed",
      result: live.activeOrder ? "本人已在微信核对，平台当前有目标订单。" : "本人已在微信核对，平台当前没有进行中的订单。", finished_at: new Date().toISOString() })
      .eq("id", input.id).eq("user_id", user.id).eq("phase", "uncertain");
    if (saved.error) throw new PublicError("核对结果尚未保存，请稍后重试。", 503);
    return;
  }
  if (action === "reserve") {
    if (!chargingEnabled()) throw new PublicError("云端执行尚未启用，当前可以绑定账号和保存偏好。", 503);
    const input = z.object({ targetId: z.string().uuid(), scheduledAt: z.string().max(80), confirmedPlug: z.literal(true), idempotencyKey: z.string().uuid() }).parse(payload);
    const scheduledAt = validateSchedule(input.scheduledAt, input.confirmedPlug);
    const duplicate = await db.from("charge_reservations").select("id,phase").eq("user_id", user.id).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (duplicate.error) throw new PublicError("未能核对预约状态。", 503);
    if (duplicate.data) return;
    const { data: target, error } = await db.from("charge_targets").select("*").eq("id", input.targetId).eq("user_id", user.id).single();
    if (error || !target) throw new PublicError("目标不存在，请重新选择。");
    const cfg = unseal<AccountConfig>(a.account_cipher, user.id);
    const { checkReservation } = await import("./neptune");
    await checkReservation(cfg, target, a.preferences.maxPrepayCents);
    const inserted = await db.from("charge_reservations").insert({ user_id: user.id, target_id: target.id,
      account_hash: a.account_hash, device: target.device, port: target.port,
      account_cipher: seal({ config: cfg, target }, user.id), max_prepay_cents: a.preferences.maxPrepayCents,
      scheduled_at: scheduledAt, idempotency_key: input.idempotencyKey }).select("id").single();
    if (inserted.error || !inserted.data) throw new PublicError("已有待执行预约，或该插座已有其他预约。请刷新核对。");
    const id = inserted.data.id;
    try {
      const { start } = await import("workflow/api");
      const { chargeWorkflow, watchdogWorkflow } = await import("../workflows/charge");
      const run = await start(chargeWorkflow, [id, scheduledAt]);
      const watchdog = await start(watchdogWorkflow, [id, new Date(Date.parse(scheduledAt) + 15 * 60_000).toISOString()]);
      const saved = await db.from("charge_reservations").update({ workflow_id: run.runId, watchdog_id: watchdog.runId, phase: "scheduled" }).eq("id", id).eq("phase", "queued");
      if (saved.error) throw new Error("registration persistence failed");
    } catch {
      const changed = await db.from("charge_reservations").update({ phase: "failed", result: "云端调度未能确认登记，请重新预约。", finished_at: new Date().toISOString() }).eq("id", id).eq("phase", "queued");
      if (changed.error) throw new PublicError("调度结果不明，请刷新核对后再操作。", 503);
      throw new PublicError("云端调度登记未能确认，请刷新预约记录。", 503);
    }
    return;
  }
  throw new PublicError("暂不支持该操作。");
}
