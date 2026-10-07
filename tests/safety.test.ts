import { test } from "node:test";
import assert from "node:assert/strict";
import { seal, unseal } from "../src/lib/crypto";
import { validateSchedule, canCancel, preferencesSchema } from "../src/lib/schedule";
process.env.ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
test("账号密文绑定所有者，不能跨用户读取", () => {
  const cipher = seal({ account: "test-only" }, "owner-a");
  assert.equal(cipher.includes("test-only"), false);
  assert.deepEqual(unseal(cipher, "owner-a"), { account: "test-only" });
  assert.throws(() => unseal(cipher, "owner-b"));
});
test("修改密文会被认证标签拒绝", () => {
  const value = seal({ account: "test-only" }, "owner-a").split(".");
  const body = Buffer.from(value[3], "base64"); body[0] ^= 1; value[3] = body.toString("base64");
  assert.throws(() => unseal(value.join("."), "owner-a"));
});
test("预约必须接好确认且在24小时以内", () => {
  const now = Date.parse("2026-10-07T12:00:00+08:00");
  assert.equal(validateSchedule("2026-10-08T06:00:00+08:00", true, now), "2026-10-07T22:00:00.000Z");
  assert.throws(() => validateSchedule("2026-10-08T06:00:00+08:00", false, now));
  assert.throws(() => validateSchedule("2026-10-09T06:00:00+08:00", true, now));
  assert.throws(() => validateSchedule("2026-10-07T11:00:00+08:00", true, now));
});
test("开始执行后不能取消，临近30秒也不能取消", () => {
  const now = Date.now(), later = new Date(now + 60_000).toISOString();
  assert.equal(canCancel("scheduled", later, now), true);
  assert.equal(canCancel("submitting", later, now), false);
  assert.equal(canCancel("scheduled", new Date(now + 20_000).toISOString(), now), false);
});
test("偏好去重且预扣上限不得超过2元", () => {
  assert.deepEqual(preferencesSchema.parse({ defaultTime: "06:15", weekdays: [1, 1, 2], maxPrepayCents: 200 }).weekdays, [1, 2]);
  assert.throws(() => preferencesSchema.parse({ defaultTime: "25:00", weekdays: [1], maxPrepayCents: 200 }));
  assert.throws(() => preferencesSchema.parse({ defaultTime: "06:00", weekdays: [], maxPrepayCents: 201 }));
});
