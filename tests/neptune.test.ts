import assert from "node:assert/strict";
import test from "node:test";
import {
  checkReservation, inspectAccount, inspectTarget, parsePaymentUrl, prepareCharge, readLive, submitCharge, verifyCharge,
  PRICE_FIELDS, inspectWebTarget, checkWebReservation, prepareWebCharge, type AccountConfig, type PreparedCharge, type Prices,
} from "../src/lib/neptune";

const prices: Prices = { efee: 110, eCharge: 55, serviceCharge: 55, efee_l: 80, eCharge_l: 80, serviceCharge_l: 0 };
const config: AccountConfig = { openId: "synthetic-account", employeeId: 123, areaId: 6,
  defaultTarget: { device: "60359118", port: "06" }, prices };
const target = { ...config.defaultTarget, prices };
const paymentUrl = "https://www.szlzxn.cn/wx/indexn.html?devaddress=6035911806&openId=synthetic-account&employeeId=123&areaid=6#/pay?socketNumber=6";
type Call = { endpoint: string; data: Record<string, string>; init: RequestInit };

class FakePlatform {
  calls: Call[] = [];
  device: Record<string, unknown> = { ...prices, devaddress: "60359118", devtypeid: 40, measure: 1,
    isuse: 1, countPay: 1, yuan5: 1, ycTime: 480, yk: 200, portstatur: "000000000000", isWorkTime: 1, safeCharge: 9 };
  user: Record<string, unknown> = { employeeid: 123, readyaccountmoney: 639, openId: "synthetic-account" };
  messages: Record<string, unknown> = { registrationCz: "1", telphone: "00000000000" };
  order: Record<string, unknown> | null = null;
  scenario = "success";
  override?: (call: Call) => Response | Promise<Response> | undefined;
  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(typeof input, "string");
    assert.ok(String(input).startsWith("https://www.szlzxn.cn/wxn/"));
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    const endpoint = new URL(String(input)).pathname.split("/").at(-1)!;
    const call: Call = { endpoint, data: Object.fromEntries(new URLSearchParams(String(init?.body))), init: init! };
    this.calls.push(call);
    const overridden = await this.override?.(call);
    if (overridden) return overridden;
    let body: unknown;
    if (endpoint === "getDeviceInfo") body = { success: true, obj: this.device };
    else if (endpoint === "getUserInfo") body = { success: true, obj: this.user };
    else if (endpoint === "getMsgs") body = { success: true, obj: this.messages };
    else if (endpoint === "isChargeing") body = { success: true, obj: this.order };
    else if (endpoint === "beginCharge") {
      if (!("msgflag" in call.data)) {
        this.order = { devaddress: call.data.devaddress, devport: call.data.port, power: 33,
          private_account: "synthetic-account", telphone: "00000000000" };
        if (this.scenario === "lost-response") throw new Error("synthetic-account private network error");
        if (this.scenario === "rejected") { this.order = null; body = { success: false, msg: "synthetic-account 00000000000" }; }
        else if (this.scenario === "bad-token") body = { success: true, obj: { unsafe: true } };
        else body = { success: true, obj: "same-request-token" };
      } else {
        assert.equal(call.data.msgflag, "same-request-token");
        body = this.scenario === "no-ack" ? { success: false, msg: "设备无响应，请稍后再试！" } :
          this.scenario === "ack-rejected" ? { success: false, msg: "设备离线" } : { success: true, obj: true };
      }
    } else throw new Error("Unexpected endpoint");
    return Response.json(body);
  };
  get submissions() { return this.calls.filter(call => call.endpoint === "beginCharge" && !("msgflag" in call.data)); }
  get confirmations() { return this.calls.filter(call => call.endpoint === "beginCharge" && "msgflag" in call.data); }
}
async function withPlatform(action: (platform: FakePlatform) => Promise<void>) {
  const original = globalThis.fetch;
  const platform = new FakePlatform();
  globalThis.fetch = platform.fetch;
  try { await action(platform); } finally { globalThis.fetch = original; }
}
const prepare = () => prepareCharge(config, target, 200);

test("payment link parsing is local, verifies identity fields and socket, and permits only official hosts", () => {
  const parsed = parsePaymentUrl(paymentUrl);
  assert.deepEqual(parsed, { openId: "synthetic-account", employeeId: 123, areaId: 6, defaultTarget: { device: "60359118", port: "06" } });
  assert.deepEqual(parsePaymentUrl(paymentUrl.replace("https://www.", "http://")), parsed);
  for (const bad of [paymentUrl.replace("www.szlzxn.cn", "www.szlzxn.cn.example.com"),
    paymentUrl.replace("https:", "file:"), paymentUrl.replace("/wx/indexn.html", "/wx/other.html"),
    paymentUrl.replace("www.szlzxn.cn", "user:password@www.szlzxn.cn"), paymentUrl.replace("www.szlzxn.cn", "www.szlzxn.cn:8443"),
    paymentUrl.replace("socketNumber=6", "socketNumber=5"), paymentUrl.replace("socketNumber=6", "socketNumber=0"),
    paymentUrl.replace("employeeId=123", "employeeId=0"), paymentUrl.replace("employeeId=123", "employeeId=123&employeeId=124"),
    paymentUrl.replace("openId=synthetic-account", "openId="), paymentUrl.replace("openId=synthetic-account", "openId=bad%0Avalue"),
    paymentUrl.replace("6035911806", "60359118"), paymentUrl.replace("socketNumber=6", "socketNumber=6&socketNumber=6")]) {
    assert.throws(() => parsePaymentUrl(bad));
  }
});

test("account checks match the employee identity and enforce required phone binding without exposing them", async () => withPlatform(async api => {
  assert.deepEqual(await inspectAccount(config), { balanceCents: 639, phoneBound: true, verified: true });
  api.user.employeeid = 124;
  await assert.rejects(inspectAccount(config), /本人账号/);
  api.user.employeeid = 123;
  api.messages.telphone = "123";
  await assert.rejects(inspectAccount(config), /绑定手机号/);
  api.messages.registrationCz = "0";
  assert.equal((await inspectAccount(config)).phoneBound, false);
}));

test("reads use only the four whitelisted paths and return a safe live snapshot", async () => withPlatform(async api => {
  api.order = { devaddress: target.device, devport: "6", power: "33.5", openId: config.openId, telphone: api.messages.telphone };
  const live = await readLive(config, target);
  assert.equal(live.activeOrder, true);
  assert.equal(live.powerWatts, 33.5);
  assert.equal(live.balanceCents, 639);
  const json = JSON.stringify(live);
  assert.ok(!json.includes("synthetic-account") && !json.includes("00000000000") && !json.includes("employeeId"));
  assert.equal(api.calls.length, 4);
  assert.ok(api.calls.every(call => ["getDeviceInfo", "getUserInfo", "getMsgs", "isChargeing"].includes(call.endpoint)));
  assert.equal(api.submissions.length, 0);
  api.order.power = "not-a-number";
  assert.equal((await readLive(config, target)).powerWatts, null);
}));

test("custom devices and ports still require the actual device identity and accepted rates", async () => withPlatform(async api => {
  const custom = { device: "12345678", port: "2", prices };
  api.device.devaddress = custom.device;
  const inspected = await inspectTarget(config, custom);
  assert.deepEqual(inspected.target, { device: custom.device, port: "02" });
  assert.equal(inspected.fullStopMinutes, 480);
  assert.deepEqual(inspected.prices, prices);
  assert.equal((await prepareCharge(config, custom, 200)).payload.port, "02");
  await assert.rejects(prepareCharge(config, { device: custom.device, port: "2" }, 200), /收费标准/);
  api.device.devaddress = "wrong";
  await assert.rejects(inspectTarget(config, custom), /设备核对/);
}));

test("occupied, unknown, other-order, and existing target orders cannot create a transaction", async () => withPlatform(async api => {
  for (const occupied of ["000001000000", "000009000000"]) {
    api.device.portstatur = occupied;
    await assert.rejects(prepare(), /占用、故障或状态未知/);
  }
  api.device.portstatur = "000000000000";
  api.order = { devaddress: target.device, devport: "05" };
  await assert.rejects(prepare(), /其他插座/);
  api.order = { devaddress: target.device, devport: "06" };
  api.device.portstatur = "000001000000";
  assert.equal((await readLive(config, target)).activeOrder, true);
  await assert.rejects(prepare(), /不重复提交/);
  assert.equal(api.submissions.length, 0);
}));

test("all six rates are compared; missing accepted rates cannot be silently initialized", async () => withPlatform(async api => {
  for (const field of PRICE_FIELDS) {
    api.device[field] = prices[field] + 1;
    await assert.rejects(prepare(), /收费标准已改变/);
    api.device[field] = prices[field];
  }
  const imported = parsePaymentUrl(paymentUrl);
  await assert.rejects(prepareCharge(imported, imported.defaultTarget, 200), /收费标准/);
  assert.equal(api.submissions.length, 0);
}));

test("the verified 480 minute metered balance package is fixed, not guessed", async () => withPlatform(async api => {
  for (const key of ["devtypeid", "measure", "isuse", "countPay", "yuan5", "ycTime"]) {
    const original = api.device[key]; api.device[key] = Number(original) + 1;
    await assert.rejects(prepare(), /套餐已改变/);
    api.device[key] = original;
  }
  api.device.safeCharge = undefined;
  await assert.rejects(prepare(), /安全充电模式/);
  api.device.safeCharge = 9; api.device.isWorkTime = 0;
  await assert.rejects(prepare(), /尚未恢复营业/);
  assert.equal(api.submissions.length, 0);
}));

test("evening reservation preflight accepts closed hours but execution still cannot prepare or submit", async () => withPlatform(async api => {
  api.device.isWorkTime = "0";
  const preflight = await checkReservation(config, target, 200);
  assert.equal(preflight.businessOpen, false);
  assert.equal(preflight.prepayCents, 200);
  assert.ok(!("payload" in preflight) && !("config" in preflight));
  assert.ok(!JSON.stringify(preflight).includes("synthetic-account"));
  await assert.rejects(prepare(), /尚未恢复营业/);
  assert.equal(api.submissions.length, 0);
  api.device.isWorkTime = 1;
  const prepared = await prepare();
  assert.equal((await submitCharge(prepared)).status, "pending");
  assert.equal(api.submissions.length, 1);
}));

test("closed-hours preflight still rejects changed rates, occupancy, low balance and excessive prepay", async () => withPlatform(async api => {
  api.device.isWorkTime = 0;
  api.device.efee = 120;
  await assert.rejects(checkReservation(config, target, 200), /收费标准已改变/);
  api.device.efee = prices.efee; api.device.portstatur = "000001000000";
  await assert.rejects(checkReservation(config, target, 200), /占用、故障或状态未知/);
  api.device.portstatur = "000000000000"; api.user.readyaccountmoney = 199;
  await assert.rejects(checkReservation(config, target, 200), /余额不足/);
  api.user.readyaccountmoney = 639; api.device.yk = 201;
  await assert.rejects(checkReservation(config, target, 200), /预扣金额超过/);
  assert.equal(api.submissions.length, 0);
}));

test("prepay cap is customizable but invalid amounts and insufficient balance fail closed", async () => withPlatform(async api => {
  api.device.yk = 300;
  await assert.rejects(prepare(), /预扣金额超过/);
  const prepared = await prepareCharge(config, target, 400);
  assert.equal(prepared.prepayCents, 300);
  assert.equal(prepared.maxPrepayCents, 400);
  api.user.readyaccountmoney = 299;
  await assert.rejects(prepareCharge(config, target, 400), /余额不足/);
  api.user.readyaccountmoney = 639;
  for (const bad of [true, null, "", "200.1", -1, 0, 200.1, "0xC8", 10_000_001]) {
    api.device.yk = bad;
    await assert.rejects(prepareCharge(config, target, 400));
  }
  api.device.yk = 200;
  for (const bad of [0, -1, 2.5, Number.NaN]) await assert.rejects(prepareCharge(config, target, bad));
  api.device.portstatur = "000";
  await assert.rejects(prepare(), /设备范围/);
}));

test("submit sends the exact verified payload once and restored state cannot submit again", async () => withPlatform(async api => {
  const prepared = await prepare();
  const submitted = await submitCharge(prepared);
  assert.equal(submitted.status, "pending");
  assert.equal(submitted.msgflag, "same-request-token");
  assert.deepEqual(api.submissions[0].data, { devaddress: "60359118", port: "06", money: "7", areaId: "6",
    openId: "synthetic-account", beforemoney: "639", devtypeid: "40", fullStop: "0", payType: "1",
    safeOpen: "0", safeCharge: "9", edtType: "0", efee: "110", eCharge: "55", serviceCharge: "55", yuan7: "0" });
  const recovered: PreparedCharge = JSON.parse(JSON.stringify(prepared));
  await assert.rejects(submitCharge(recovered), /已经提交/);
  const verified = await verifyCharge(recovered, submitted.msgflag);
  assert.equal(verified.confirmed, true);
  assert.equal(verified.acknowledged, true);
  assert.equal(api.submissions.length, 1);
  assert.equal(api.confirmations.length, 1);
  await verifyCharge(recovered, submitted.msgflag);
  assert.equal(api.confirmations.length, 1);
}));

test("lost responses consume the request and cannot claim success without platform acknowledgment", async () => withPlatform(async api => {
  api.scenario = "lost-response";
  const prepared = await prepare();
  const result = await submitCharge(prepared);
  assert.equal(result.status, "uncertain");
  assert.equal(result.msgflag, null);
  assert.ok(!JSON.stringify(result).includes("synthetic-account"));
  for (let round = 0; round < 3; round++) {
    const verified = await verifyCharge(prepared, null);
    assert.equal(verified.activeOrder, true);
    assert.equal(verified.confirmed, false);
    await assert.rejects(submitCharge(prepared), /已经提交/);
  }
  assert.equal(api.submissions.length, 1);
  assert.equal(api.confirmations.length, 0);
}));

test("only the original msgflag is reused; matching order alone is insufficient", async () => withPlatform(async api => {
  api.scenario = "no-ack";
  const prepared = await prepare();
  const submitted = await submitCharge(prepared);
  const calls = api.calls.length;
  await assert.rejects(verifyCharge(prepared, "new-token"), /原请求标识/);
  assert.equal(api.calls.length, calls);
  for (let round = 0; round < 3; round++) assert.equal((await verifyCharge(prepared, submitted.msgflag)).confirmed, false);
  assert.equal(api.submissions.length, 1);
  assert.ok(api.confirmations.every(call => call.data.msgflag === "same-request-token"));
}));

test("persisted acknowledgment survives a failed order read and suppresses additional confirmations", async () => withPlatform(async api => {
  const prepared = await prepare(), submitted = await submitCharge(prepared);
  api.override = call => call.endpoint === "isChargeing" ? new Response("offline", { status: 503 }) : undefined;
  const first = await verifyCharge(prepared, submitted.msgflag);
  assert.equal(first.acknowledged, true);
  assert.equal(first.confirmed, false);
  const recovered: PreparedCharge = JSON.parse(JSON.stringify(prepared));
  recovered.acknowledged = false;
  api.override = undefined;
  assert.equal((await verifyCharge(recovered, submitted.msgflag, first.acknowledged)).confirmed, true);
  assert.equal(api.confirmations.length, 1);
  assert.equal(api.submissions.length, 1);
}));

test("explicit rejection and malformed tokens never become a second transaction", async () => withPlatform(async api => {
  api.scenario = "rejected";
  const rejected = await prepare(), result = await submitCharge(rejected);
  assert.equal(result.status, "rejected");
  assert.ok(!JSON.stringify(result).includes("synthetic-account") && !JSON.stringify(result).includes("00000000000"));
  await assert.rejects(submitCharge(rejected));
  await verifyCharge(rejected, null);
  assert.equal(api.confirmations.length, 0);
  api.scenario = "bad-token";
  const bad = await prepare(), badResult = await submitCharge(bad);
  assert.equal(badResult.status, "uncertain");
  assert.equal((await verifyCharge(bad, null)).confirmed, false);
  await assert.rejects(submitCharge(bad));
  api.order = null;
  api.scenario = "ack-rejected";
  const pending = await prepare(), pendingResult = await submitCharge(pending);
  await verifyCharge(pending, pendingResult.msgflag);
  await verifyCharge(pending, pendingResult.msgflag);
  assert.equal(api.confirmations.length, 1);
  assert.equal(api.submissions.length, 3);
}));

test("redirects are rejected without following them, and failed submission is never retried", async () => withPlatform(async api => {
  api.override = call => call.endpoint === "getDeviceInfo" ? new Response(null, { status: 302, headers: { Location: "https://example.com/private" } }) : undefined;
  await assert.rejects(inspectTarget(config, target), /重定向/);
  api.override = undefined;
  const prepared = await prepare();
  api.override = call => call.endpoint === "beginCharge" ? new Response(null, { status: 307, headers: { Location: "https://example.com/private" } }) : undefined;
  assert.equal((await submitCharge(prepared)).status, "uncertain");
  await assert.rejects(submitCharge(prepared));
  assert.equal(api.submissions.length, 1);
}));

test("unexpected response objects, oversized bodies and mismatched device identity stop safely", async () => withPlatform(async api => {
  for (const body of ["[]", "null", "broken-json", "x".repeat(1_000_001)]) {
    api.override = call => call.endpoint === "getUserInfo" ? new Response(body) : undefined;
    await assert.rejects(inspectAccount(config), /格式/);
  }
  api.override = call => call.endpoint === "isChargeing" ? Response.json({ success: true, obj: "unexpected" }) : undefined;
  await assert.rejects(readLive(config, target), /订单查询失败/);
  api.override = undefined;
  api.device.devaddress = "12345678";
  await assert.rejects(prepare(), /设备核对/);
  assert.equal(api.submissions.length, 0);
}));

test("stale, altered and not-yet-submitted requests cannot send charge traffic", async () => withPlatform(async api => {
  const prepared = await prepare();
  await assert.rejects(verifyCharge(prepared, null), /尚未提交/);
  prepared.preparedAt = new Date(Date.now() - 61_000).toISOString();
  await assert.rejects(submitCharge(prepared), /过期/);
  prepared.preparedAt = new Date().toISOString();
  prepared.payload.money = 5;
  await assert.rejects(submitCharge(prepared), /参数/);
  prepared.payload.money = 7;
  prepared.payload.extraField = 1;
  await assert.rejects(submitCharge(prepared), /参数/);
  assert.equal(api.submissions.length, 0);
}));

test('web catalog preserves actual full-stop duration and verified timed choices with a single new request', async () => withPlatform(async api => {
  api.device.ycTime = 240; api.device.yuan11 = 1;
  const live = await inspectWebTarget(config, target);
  assert.deepEqual(live.quote.schemes.map(s => s.id), ['full-stop','minutes-60','minutes-120','minutes-240']);
  const frozen = await checkWebReservation(config, live.target, 'minutes-120', live.quote.fingerprint, 200);
  assert.equal(frozen.selected.maxMinutes, 120);
  const prepared = await prepareWebCharge(config, live.target, 'minutes-120', live.quote.fingerprint, 200);
  await submitCharge(prepared); await verifyCharge(prepared, prepared.msgflag);
  assert.equal(api.submissions.length, 1); assert.equal(api.submissions[0].data.yuan7, '120');
  assert.equal(api.confirmations[0].data.yuan7, '120');
  await assert.rejects(submitCharge(structuredClone(prepared)), /已经提交/);
}));
test('web preflight permits closed hours but detects pricing, protection and scheme changes before submission', async () => withPlatform(async api => {
  api.device.yuan11 = 1; api.device.isWorkTime = 0;
  const live = await inspectWebTarget(config, target);
  await checkWebReservation(config, live.target, 'full-stop', live.quote.fingerprint, 200);
  await assert.rejects(prepareWebCharge(config, live.target, 'full-stop', live.quote.fingerprint, 200), /尚未恢复/);
  api.device.isWorkTime = 1; api.device.safeCharge = 10;
  await assert.rejects(prepareWebCharge(config, live.target, 'full-stop', live.quote.fingerprint, 200), /收费标准已改变/);
  api.device.safeCharge = 9; api.device.yuan11 = 0;
  await assert.rejects(prepareWebCharge(config, live.target, 'minutes-120', live.quote.fingerprint, 200), /收费标准已改变/);
  assert.equal(api.submissions.length, 0);
}));
