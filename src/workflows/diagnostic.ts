import { sleep } from "workflow";
import { database } from "../lib/database";
async function markStarted(id: string) {
  "use step";
  const { error } = await database().from("charge_diagnostics").update({ phase: "waiting", started_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Diagnostic persistence failed");
}
async function markFinished(id: string) {
  "use step";
  let platformReachable = false;
  try {
    const response = await fetch("https://www.szlzxn.cn/wxn/getDeviceInfo", { method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "devaddress=60359118&areaId=6", signal: AbortSignal.timeout(10_000) });
    const value = await response.json();
    platformReachable = response.status === 200 && value.success === true && value.obj?.devaddress === "60359118";
  } catch { /* A failed read leaves charging untouched. */ }
  const { error } = await database().from("charge_diagnostics").update({ phase: "complete", platform_reachable: platformReachable, finished_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Diagnostic result persistence failed");
}
export async function diagnosticWorkflow(id: string) {
  "use workflow";
  await markStarted(id);
  await sleep("5s");
  await markFinished(id);
}
