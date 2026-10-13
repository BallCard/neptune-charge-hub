import { NeptuneError, prepareWebCharge, submitCharge, verifyCharge, inspectOwnOrder,
  type AccountConfig, type Target, type PreparedCharge } from '../../../src/lib/neptune.ts';
export type FrozenPlan = { config: AccountConfig; target: Target; schemeId: string; fingerprint: string; maxPrepayCents: number };
export type CloudJob = { id: string; phase: string; lease_token: string; scheduled_at: string; window_ends_at: string;
  start_consumed_at: string | null; snapshot_cipher: string; request_cipher: string | null };
export interface JobStore {
  decrypt(value: string): Promise<unknown>;
  consume(job: CloudJob, prepared: PreparedCharge): Promise<boolean>;
  finish(job: CloudJob, phase: string, message: string, prepared: PreparedCharge | null, due: string | null): Promise<void>;
}
export const livePlatform = { prepare: prepareWebCharge, submit: submitCharge, verify: verifyCharge, order: inspectOwnOrder };
export type ChargePlatform = typeof livePlatform;
/** Persist the consume marker before the only new request. A lost commit response must never reach submit. */
export async function runJob(job: CloudJob, store: JobStore, platform: ChargePlatform = livePlatform, clock = Date.now) {
  let plan: FrozenPlan;
  try { plan = await store.decrypt(job.snapshot_cipher) as FrozenPlan; }
  catch { await store.finish(job, job.start_consumed_at ? 'uncertain' : 'failed', '冻结配置读取失败，未重发开电。', null, null); return; }
  const finish = (phase: string, message: string, prepared: PreparedCharge | null = null, after?: number) =>
    store.finish(job, phase, message, prepared, after === undefined ? null : new Date(clock() + after).toISOString());
  if (job.start_consumed_at) {
    let prepared: PreparedCharge;
    try {
      if (!job.request_cipher) throw new Error('missing original request');
      prepared = await store.decrypt(job.request_cipher) as PreparedCharge;
      prepared.submitted = true;
    } catch { await finish('uncertain', '原请求记录不完整，请在微信核对；不会重新开电。'); return; }
    if (job.phase === 'submitting') {
      await finish('uncertain', '上次提交发生中断，请在微信核对；不会重新开电。', prepared, 15 * 60_000); return;
    }
    if (job.phase === 'confirmed') {
      try { const order = await platform.order(plan.config, plan.target);
        await finish('confirmed', order.matched ? `已确认启动；十五分钟后核对：${order.powerWatts === null ? '功率待读取' : `当前功率${order.powerWatts}W`}。` : '已确认启动；十五分钟后未查到本插座的当前本人订单，请在微信核对。', prepared);
      } catch { await finish('confirmed', '已确认启动；十五分钟后的订单查询未完成，请在微信核对。', prepared); }
      return;
    }
    try {
      const result = await platform.verify(prepared, prepared.msgflag, prepared.acknowledged);
      if (result.confirmed) { await finish('confirmed', '原请求与本人订单均已确认启动。', prepared, job.phase === 'uncertain' ? undefined : 15 * 60_000); return; }
      const expired = clock() - Date.parse(job.start_consumed_at) >= 2 * 60_000;
      if (job.phase === 'uncertain') { await finish('uncertain', '追加核对仍未同时确认原请求与本人订单，请在微信查明；旧请求不重发。', prepared); return; }
      if (expired || !result.retryable) { await finish('uncertain', '开电结果未能确认，请在微信核对；不会重新开电。', prepared, 15 * 60_000); return; }
      await finish('pending', '正在核对原请求与本人订单。', prepared, 60_000);
    } catch { await finish('uncertain', '原请求核对未完成，请在微信查明；不会重新开电。', prepared, 15 * 60_000); }
    return;
  }
  if (clock() > Date.parse(job.window_ends_at)) { await finish('missed', '超过十分钟执行窗口，未提交开电。'); return; }
  let prepared: PreparedCharge;
  try { prepared = await platform.prepare(plan.config, plan.target, plan.schemeId, plan.fingerprint, plan.maxPrepayCents); }
  catch (error) {
    if (error instanceof NeptuneError && ['closed', 'network'].includes(error.code) && clock() + 60_000 <= Date.parse(job.window_ends_at)) {
      await finish('waiting', error.code === 'closed' ? '平台尚未营业，窗口内继续核对。' : '平台只读查询未完成，窗口内继续核对。', null, 60_000); return;
    }
    if (error instanceof NeptuneError && error.code === 'occupied') {
      try { if ((await platform.order(plan.config, plan.target)).matched) { await finish('already-charging', '已有本插座的本人订单，没有提交新请求。'); return; } } catch { /* Do not create any new transaction. */ }
    }
    await finish('failed', error instanceof NeptuneError ? error.message : '执行前核对未完成，未发起开电。'); return;
  }
  // If this throws after a committed update, recovery sees start_consumed_at and never submits again.
  if (!await store.consume(job, prepared)) return;
  const result = await platform.submit(prepared);
  await finish(result.status, result.message, prepared, result.status === 'pending' ? 60_000 : result.status === 'uncertain' ? 15 * 60_000 : undefined);
}
