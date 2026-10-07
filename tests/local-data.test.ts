import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLocalAction, dashboardFor, newLocalData, parseLocalPaymentUrl, publicPlan } from "../src/lib/local-data";
import { createVault, unlockVault, encryptData, validateEnvelope } from "../src/lib/local-vault";
const link = "https://www.szlzxn.cn/wx/indexn.html?openId=test-local-only&employeeId=123&areaid=6&devaddress=1234567806#/pay?socketNumber=06";
const at = Date.parse("2026-10-07T20:00:00+08:00");
test("付款链接只在本机解析，错误域名和重复身份字段被拒绝", () => {
  assert.equal(parseLocalPaymentUrl(link).defaultTarget.port, "06");
  assert.throws(() => parseLocalPaymentUrl(link.replace("www.szlzxn.cn", "example.invalid")));
  assert.throws(() => parseLocalPaymentUrl(link.replace("employeeId=123", "employeeId=123&employeeId=999")));
  assert.throws(() => parseLocalPaymentUrl(link.replace("socketNumber=06", "socketNumber=07")));
});
test("保存和取消计划不发网络请求，不宣称已启用自动充电", () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Unexpected network transmission"); }) as typeof fetch;
  try {
    const imported = applyLocalAction(newLocalData(), "importAccount", { url: link, label: "测试点" }, at);
    const id = crypto.randomUUID(), targetId = imported.targets[0].id;
    const payload = { targetId, scheduledAt: "2026-10-08T06:00:00+08:00", confirmedPlug: true, idempotencyKey: id };
    const saved = applyLocalAction(imported, "reserve", payload, at);
    assert.equal(saved.reservations[0].phase, "planned");
    assert.equal(applyLocalAction(saved, "reserve", payload, at).reservations.length, 1);
    assert.equal(dashboardFor(saved).live, null);
    const plan = JSON.stringify(publicPlan(saved, id));
    assert.equal(plan.includes("test-local-only"), false); assert.equal(plan.includes("employeeId"), false);
    assert.equal(JSON.parse(plan).executable, false);
    assert.throws(() => applyLocalAction(saved, "deleteTarget", { id: targetId }, at));
    assert.equal(applyLocalAction(saved, "cancel", { id }, at).reservations[0].phase, "cancelled");
    assert.equal(applyLocalAction(saved, "refresh", {}, at + 12 * 3600_000).reservations[0].phase, "expired");
  } finally { globalThis.fetch = fetchBefore; }
});
test("本机计划仍要求接好确认、24小时窗口和合理金额", () => {
  const data = applyLocalAction(newLocalData(), "importAccount", { url: link }, at);
  const payload = { targetId: data.targets[0].id, scheduledAt: "2026-10-08T06:00:00+08:00", idempotencyKey: crypto.randomUUID() };
  assert.throws(() => applyLocalAction(data, "reserve", payload, at));
  assert.throws(() => applyLocalAction(data, "reserve", { ...payload, confirmedPlug: true, scheduledAt: "2026-10-09T06:00:00+08:00" }, at));
  assert.throws(() => applyLocalAction(data, "savePreferences", { defaultTime: "06:00", weekdays: [1], maxPrepayCents: 201 }, at));
});
test("账号、设置与记录全部以密文保存；错误密码和密文损坏不能解锁", async () => {
  const created = await createVault("test-password-123");
  const data = applyLocalAction(created.data, "importAccount", { url: link }, at);
  const sealed = await encryptData(created.key, data, created.envelope);
  const raw = JSON.stringify(sealed);
  assert.equal(raw.includes("test-local-only"), false); assert.equal(raw.includes("12345678"), false);
  assert.equal((await unlockVault(sealed, "test-password-123")).data.account?.openId, "test-local-only");
  await assert.rejects(unlockVault(sealed, "incorrect-password"));
  const changed = { ...sealed, cipher: (sealed.cipher[0] === "A" ? "B" : "A") + sealed.cipher.slice(1) };
  await assert.rejects(unlockVault(changed, "test-password-123"));
  assert.throws(() => validateEnvelope({ ...sealed, iterations: 999999999 }));
});
