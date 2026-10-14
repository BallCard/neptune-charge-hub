import { runJob, type CloudJob, type JobStore } from './runner.ts';

/** One bounded batch; never retry a failed job here. */
export async function dispatchBatch(jobs: CloudJob[], store: JobStore, run = runJob) {
  const results = await Promise.allSettled(jobs.map(job => run(job, store)));
  return { claimed: jobs.length, processed: results.filter(result => result.status === 'fulfilled').length,
    failed: results.filter(result => result.status === 'rejected').length };
}

export function schedulerReady(control: Record<string, { enabled?: boolean; lastTick?: string; failed?: number; oldestDueSeconds?: number }>, now = Date.now()) {
  const scheduler = control.scheduler, dispatch = control.dispatch;
  const age = now - Date.parse(scheduler?.lastTick || '');
  return scheduler?.enabled === true && age >= 0 && age < 180_000 &&
    dispatch?.failed === 0 && typeof dispatch.oldestDueSeconds === 'number' && dispatch.oldestDueSeconds < 120;
}
