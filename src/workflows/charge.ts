import { sleep } from "workflow";
import { database } from "../lib/database";
import { seal, unseal } from "../lib/crypto";
import { inspectTarget, prepareCharge, submitCharge, verifyCharge, NeptuneError, type AccountConfig, type Target, type PreparedCharge } from "../lib/neptune";

const livePhases = ["queued", "scheduled", "waiting", "checking", "submitting", "pending"];
async function load(id: string) {
  const { data, error } = await database().from("charge_reservations").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Reservation unavailable");
  return data;
}
async function finish(id: string, phase: string, result: string) {
  const allowed = ["failed", "expired", "already-charging"].includes(phase)
    ? ["queued", "scheduled", "waiting", "checking"]
    : ["submitting", "pending"];
  const { error } = await database().from("charge_reservations").update({ phase, result, finished_at: new Date().toISOString() }).eq("id", id).in("phase", allowed);
  if (error) throw new Error("Result persistence failed");
}
function outOfWindow(row: { scheduled_at: string }) {
  const now = Date.now(), due = Date.parse(row.scheduled_at);
  return now < due || now > due + 600_000;
}
async function opening(id: string) {
  "use step";
  console.info("charge.check-opening", { reservationId: id });
  const row = await load(id);
  if (!livePhases.includes(row.phase)) return "done";
  // Already submitted requests may only verify their original result, even after the new-payment window closes.
  if (["submitting", "pending"].includes(row.phase)) return "verify";
  if (!row.workflow_id || !row.watchdog_id) {
    await finish(id, "failed", "调度登记尚未确认，本次不执行。");
    return "done";
  }
  if (outOfWindow(row)) { await finish(id, "expired", "已超过预约执行窗口，本次不启动充电。"); return "done"; }
  if (process.env.CHARGING_ENABLED !== "true") { await finish(id, "failed", "管理员尚未启用云端执行。"); return "done"; }
  const { error } = await database().from("charge_reservations").update({ phase: "waiting", result: "等待充电站恢复营业。" }).eq("id", id).in("phase", ["queued", "scheduled", "waiting"]);
  if (error) throw new Error("State persistence failed");
  const { config, target } = unseal<{ config: AccountConfig; target: Target }>(row.account_cipher, row.user_id);
  try {
    const value = await inspectTarget(config, target);
    return value.businessOpen ? "open" : "wait";
  } catch { return "wait"; }
}
async function sendOnce(id: string) {
  "use step";
  console.info("charge.prepare-once", { reservationId: id });
  const row = await load(id);
  if (["submitting", "pending"].includes(row.phase)) return "verify";
  if (!["scheduled", "waiting", "checking"].includes(row.phase)) return "done";
  if (outOfWindow(row)) { await finish(id, "expired", "提交前已超过预约执行窗口。"); return "done"; }
  if (process.env.CHARGING_ENABLED !== "true") { await finish(id, "failed", "云端执行已停用。"); return "done"; }
  const frozen = unseal<{ config: AccountConfig; target: Target }>(row.account_cipher, row.user_id);
  let prepared: PreparedCharge;
  try { prepared = await prepareCharge(frozen.config, frozen.target, row.max_prepay_cents); }
  catch (error) {
    if (error instanceof NeptuneError && error.code === "already-charging") await finish(id, "already-charging", "目标插座已有本人订单，已跳过重复提交。");
    else await finish(id, "failed", "账号、余额、费率或插座核对未通过，请在微信核对。");
    return "done";
  }
  if (outOfWindow(row)) { await finish(id, "expired", "核对完成时已超过预约执行窗口。"); return "done"; }
  // The durable compare-and-set precedes the only new transaction. A replay cannot submit again.
  const claimed = await database().from("charge_reservations").update({ phase: "submitting",
    result: "已发起一次充电请求，正在核对结果。", submitted_at: new Date().toISOString(),
    transaction_cipher: seal(prepared, row.user_id) }).eq("id", id).in("phase", ["scheduled", "waiting", "checking"]).select("id");
  if (claimed.error) throw new Error("Claim persistence failed");
  if (!claimed.data?.length) return "done";
  if (outOfWindow(row) || process.env.CHARGING_ENABLED !== "true") {
    await finish(id, "uncertain", "提交占用保存后已过执行窗口，本进程未发起付款；请核对后解除锁定。");
    return "done";
  }
  let result;
  try { result = await submitCharge(prepared); }
  catch { return "verify"; }
  if (result.status === "rejected") { await finish(id, "rejected", "平台拒绝开电，请在微信核对。"); return "done"; }
  const saved = await database().from("charge_reservations").update({ phase: "pending", transaction_cipher: seal(prepared, row.user_id) }).eq("id", id).eq("phase", "submitting");
  if (saved.error) throw new Error("Response persistence failed; never resubmit");
  return "verify";
}
async function verify(id: string) {
  "use step";
  console.info("charge.verify-original", { reservationId: id });
  const row = await load(id);
  if (!["submitting", "pending"].includes(row.phase)) return true;
  if (!row.transaction_cipher) { await finish(id, "uncertain", "开电状态缺失，请在微信核对；不会重复提交。"); return true; }
  const prepared = unseal<PreparedCharge>(row.transaction_cipher, row.user_id);
  // If the process stopped after claim, only order reads remain; no original msgflag was persisted.
  prepared.submitted = true;
  const value = await verifyCharge(prepared, prepared.msgflag, prepared.acknowledged);
  const saved = await database().from("charge_reservations").update({ transaction_cipher: seal(prepared, row.user_id) }).eq("id", id).eq("transaction_cipher", row.transaction_cipher).in("phase", ["submitting", "pending"]).select("id");
  if (saved.error) throw new Error("Verification persistence failed");
  if (!saved.data?.length) return false;
  if (value.confirmed) { await finish(id, "confirmed", "平台已确认充电启动，请在微信查看实时订单。"); return true; }
  return false;
}
async function finalUncertain(id: string) {
  "use step";
  await finish(id, "uncertain", "未能确认开电结果。已停止提交，请在微信核对订单。");
}
async function finalFailure(id: string) {
  "use step";
  const row = await load(id);
  await finish(id, ["submitting", "pending"].includes(row.phase) ? "uncertain" : "failed", "云端执行中断，请在微信核对订单；不会自动重新下单。");
}

export async function chargeWorkflow(id: string, scheduledAt: string) {
  "use workflow";
  await sleep(new Date(scheduledAt));
  try {
    let status = await opening(id);
    while (status === "wait") { await sleep("15s"); status = await opening(id); }
    if (status === "done") return;
    if (status === "open") {
      await sleep("30s");
      if (await sendOnce(id) === "done") return;
    }
    for (let attempt = 0; attempt < 15; attempt++) {
      await sleep("6s");
      if (await verify(id)) return;
    }
    await finalUncertain(id);
  } catch { await finalFailure(id); }
}
async function checkMissedExecution(id: string) {
  "use step";
  const row = await load(id);
  if (livePhases.includes(row.phase)) {
    await finish(id, ["submitting", "pending"].includes(row.phase) ? "uncertain" : "failed",
      "备用检查发现执行未完成，请在微信核对订单；本次不会重新提交。");
  }
}
export async function watchdogWorkflow(id: string, at: string) {
  "use workflow";
  await sleep(new Date(at));
  await checkMissedExecution(id);
}
