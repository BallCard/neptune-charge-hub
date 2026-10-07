/** Server-side adapter. Never send AccountConfig or PreparedCharge to a browser. */
import { createHash } from "node:crypto";

const ORIGIN = "https://www.szlzxn.cn";
const READ_PATHS = new Set(["getDeviceInfo", "getUserInfo", "getMsgs", "isChargeing"]);
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_AMOUNT_CENTS = 10_000_000;
export const PRICE_FIELDS = ["efee", "eCharge", "serviceCharge", "efee_l", "eCharge_l", "serviceCharge_l"] as const;
export type Prices = Record<(typeof PRICE_FIELDS)[number], number>;
export type Target = { device: string; port: string; prices?: Prices };
export type AccountConfig = {
  openId: string;
  employeeId: number;
  areaId: number;
  defaultTarget: Target;
  /** Explicitly accepted rates for the imported device. */
  prices?: Prices;
};
export type AccountSnapshot = { balanceCents: number; phoneBound: boolean; verified: true };
export type LiveSnapshot = {
  connected: true;
  updatedAt: string;
  balanceCents: number;
  prepayCents: number;
  businessOpen: boolean;
  activeOrder: boolean;
  otherOrder: boolean;
  powerWatts: number | null;
  portAvailable: boolean;
};
export type TargetSnapshot = LiveSnapshot & {
  target: { device: string; port: string };
  prices: Prices;
  fullStopMinutes: 480;
};
type Form = Record<string, string | number>;
type JsonObject = Record<string, unknown>;
export type PreparedCharge = {
  version: 1;
  config: AccountConfig;
  target: Target;
  payload: Form;
  prepayCents: number;
  maxPrepayCents: number;
  preparedAt: string;
  /** Caller persists its reservation's submitting state BEFORE invoking submitCharge. */
  submitted: boolean;
  acknowledged: boolean;
  msgflag: string | null;
  verificationDisabled: boolean;
};
export type SubmissionResult = { status: "pending" | "rejected" | "uncertain"; msgflag: string | null; message: string };
export type VerificationResult = {
  confirmed: boolean;
  acknowledged: boolean;
  activeOrder: boolean;
  otherOrder: boolean;
  retryable: boolean;
};

export class NeptuneError extends Error {
  constructor(message: string, readonly code = "invalid") { super(message); this.name = "NeptuneError"; }
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown, label: string, minimum = 0, maximum = MAX_AMOUNT_CENTS): number {
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && !/^\d+$/.test(value))) throw new NeptuneError(`${label}字段异常，停止操作。`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new NeptuneError(`${label}字段异常，停止操作。`);
  return number;
}
function checkedTarget(target: Target): Target {
  if (!target || !/^\d{8}$/.test(target.device) || !/^\d{1,2}$/.test(target.port)) throw new NeptuneError("设备编号或插座号格式不正确。");
  const port = integer(target.port, "插座", 1, 99).toString().padStart(2, "0");
  return { device: target.device, port, ...(target.prices ? { prices: checkedPrices(target.prices) } : {}) };
}
function checkedPrices(value: unknown): Prices {
  if (!object(value)) throw new NeptuneError("尚未保存目标设备的收费标准，请先核对。");
  return Object.fromEntries(PRICE_FIELDS.map(key => [key, integer(value[key], "收费标准")])) as Prices;
}
function checkedConfig(config: AccountConfig): AccountConfig {
  if (!config || typeof config.openId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(config.openId)) throw new NeptuneError("账号信息不完整。");
  return {
    openId: config.openId,
    employeeId: integer(config.employeeId, "账号", 1, Number.MAX_SAFE_INTEGER),
    areaId: integer(config.areaId, "区域", 1, Number.MAX_SAFE_INTEGER),
    defaultTarget: checkedTarget(config.defaultTarget),
    ...(config.prices ? { prices: checkedPrices(config.prices) } : {}),
  };
}

/** Parses locally only; the pasted URL is never fetched. All API traffic uses ORIGIN. */
export function parsePaymentUrl(raw: string): AccountConfig {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new NeptuneError("请使用尼普顿付款页复制出的完整链接。"); }
  if (!["https:", "http:"].includes(url.protocol) || !["www.szlzxn.cn", "szlzxn.cn"].includes(url.hostname) ||
      url.pathname !== "/wx/indexn.html" || url.username || url.password || url.port) {
    throw new NeptuneError("请使用尼普顿付款页复制出的完整链接。");
  }
  const fragment = new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1));
  const one = (query: URLSearchParams, key: string) => {
    const values = query.getAll(key);
    if (values.length !== 1 || !values[0]) throw new NeptuneError("付款页链接不完整或包含重复字段。");
    return values[0];
  };
  const rawDevice = one(url.searchParams, "devaddress");
  const port = integer(one(fragment, "socketNumber"), "插座", 1, 99).toString().padStart(2, "0");
  if (!/^\d{10}$/.test(rawDevice) || rawDevice.slice(-2) !== port) throw new NeptuneError("链接中的设备与插座号不一致。");
  return checkedConfig({ openId: one(url.searchParams, "openId"),
    employeeId: integer(one(url.searchParams, "employeeId"), "账号", 1, Number.MAX_SAFE_INTEGER),
    areaId: integer(one(url.searchParams, "areaid"), "区域", 1, Number.MAX_SAFE_INTEGER),
    defaultTarget: { device: rawDevice.slice(0, -2), port } });
}

export function accountFingerprint(config: AccountConfig): string {
  const checked = checkedConfig(config);
  return createHash("sha256").update(`${checked.openId}:${checked.employeeId}`).digest("hex");
}

async function call(endpoint: string, form: Form, chargePermission = false): Promise<JsonObject> {
  if (!READ_PATHS.has(endpoint) && !(chargePermission && endpoint === "beginCharge")) throw new NeptuneError("只读检查不能提交充电。");
  const url = `${ORIGIN}/wxn/${endpoint}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams(Object.entries(form).map(([key, value]) => [key, String(value)])) });
  } catch { throw new NeptuneError("平台请求失败，请稍后核对。", "network"); }
  if (response.status >= 300 && response.status < 400 || response.redirected || (response.url && response.url !== url)) {
    void response.body?.cancel().catch(() => {});
    throw new NeptuneError("平台接口发生重定向，已停止操作。", "redirect");
  }
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new NeptuneError("平台请求失败，请稍后核对。", "network"); }
  try {
    if (!response.body) throw new Error("missing body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("size limit"); }
      chunks.push(part.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const result: unknown = JSON.parse(text);
    if (!object(result)) throw new Error("object required");
    return result;
  } catch { throw new NeptuneError("平台返回格式发生变化或读取超时，停止操作。", "format"); }
}
function objectResponse(result: JsonObject, label: string): JsonObject {
  if (result.success !== true || !object(result.obj)) throw new NeptuneError(`${label}查询失败，停止操作。`);
  return result.obj;
}
async function activeOrder(config: AccountConfig): Promise<JsonObject | null> {
  const result = await call("isChargeing", { openId: config.openId, areaId: config.areaId });
  if (result.success !== true || result.obj !== null && !object(result.obj)) throw new NeptuneError("本人充电订单查询失败，停止操作。");
  return result.obj as JsonObject | null;
}
function matching(order: JsonObject | null, target: Target): boolean {
  return !!order && String(order.devaddress) === target.device && /^\d{1,2}$/.test(String(order.devport)) && Number(order.devport) === Number(target.port);
}
function matchedIdentity(user: JsonObject, config: AccountConfig): number {
  if (String(user.employeeid) !== String(config.employeeId)) throw new NeptuneError("本人账号核对失败。");
  return integer(user.readyaccountmoney, "余额");
}
async function readAccount(config: AccountConfig): Promise<AccountSnapshot> {
  const [userResult, messageResult] = await Promise.all([
    call("getUserInfo", { openId: config.openId, areaId: config.areaId }),
    call("getMsgs", { employeeid: config.employeeId, areaid: config.areaId }),
  ]);
  const user = objectResponse(userResult, "账户"), messages = objectResponse(messageResult, "实名状态");
  const balanceCents = matchedIdentity(user, config);
  const phoneBound = /^\d{11}$/.test(String(messages.telphone ?? ""));
  if (String(messages.registrationCz) === "1" && !phoneBound) throw new NeptuneError("平台要求先绑定手机号，请在微信完成。");
  return { balanceCents, phoneBound, verified: true };
}
export async function inspectAccount(config: AccountConfig): Promise<AccountSnapshot> {
  return readAccount(checkedConfig(config));
}
function packageChecks(device: JsonObject): void {
  const known = { devtypeid: 40, measure: 1, isuse: 1, countPay: 1, yuan5: 1, ycTime: 480 };
  for (const [key, value] of Object.entries(known)) {
    if (integer(device[key], "套餐") !== value) throw new NeptuneError("设备、付款方式或套餐已改变，需要重新核对。", "package");
  }
  integer(device.safeCharge, "安全充电模式");
}
function deviceChecks(device: JsonObject, target: Target): { prices: Prices; prepayCents: number; portAvailable: boolean; businessOpen: boolean } {
  if (String(device.devaddress) !== target.device) throw new NeptuneError("设备核对失败。");
  packageChecks(device);
  const prices = checkedPrices(device), prepayCents = integer(device.yk, "预扣金额", 1);
  if (typeof device.portstatur !== "string" || !/^[0-9]+$/.test(device.portstatur) || Number(target.port) > device.portstatur.length) throw new NeptuneError("插座号不在设备范围内或状态格式异常。");
  if (![0, 1, "0", "1"].includes(device.isWorkTime as number | string)) throw new NeptuneError("营业状态格式异常。");
  return { prices, prepayCents, portAvailable: device.portstatur[Number(target.port) - 1] === "0", businessOpen: String(device.isWorkTime) === "1" };
}
function safePower(order: JsonObject | null, matched: boolean): number | null {
  if (!matched || !order || !["number", "string"].includes(typeof order.power) || order.power === "") return null;
  const power = Number(order.power);
  return Number.isFinite(power) && power >= 0 && power <= MAX_AMOUNT_CENTS ? power : null;
}
async function readSnapshot(config: AccountConfig, target: Target) {
  const [account, deviceResult, order] = await Promise.all([
    readAccount(config), call("getDeviceInfo", { areaId: config.areaId, devaddress: target.device }), activeOrder(config),
  ]);
  const device = objectResponse(deviceResult, "设备"), details = deviceChecks(device, target), matched = matching(order, target);
  const snapshot: TargetSnapshot = {
    connected: true, updatedAt: new Date().toISOString(), balanceCents: account.balanceCents,
    prepayCents: details.prepayCents, businessOpen: details.businessOpen, portAvailable: details.portAvailable,
    activeOrder: matched, otherOrder: !!order && !matched, powerWatts: safePower(order, matched),
    target: { device: target.device, port: target.port }, prices: details.prices, fullStopMinutes: 480,
  };
  return { snapshot, device };
}
export async function inspectTarget(config: AccountConfig, target: Target): Promise<TargetSnapshot> {
  return (await readSnapshot(checkedConfig(config), checkedTarget(target))).snapshot;
}
export async function readLive(config: AccountConfig, target: Target): Promise<LiveSnapshot> {
  const { snapshot } = await readSnapshot(checkedConfig(config), checkedTarget(target));
  const { target: _target, prices: _prices, fullStopMinutes: _minutes, ...live } = snapshot;
  return live;
}
async function checkedChargeSnapshot(rawConfig: AccountConfig, rawTarget: Target, maxPrepayCents: number) {
  const config = checkedConfig(rawConfig), target = checkedTarget(rawTarget);
  const cap = integer(maxPrepayCents, "预扣上限", 1);
  const expected = checkedPrices(target.prices ?? (target.device === config.defaultTarget.device ? config.prices : undefined));
  const { snapshot, device } = await readSnapshot(config, target);
  if (PRICE_FIELDS.some(key => snapshot.prices[key] !== expected[key])) throw new NeptuneError("收费标准已改变，请重新核对并确认。", "prices");
  if (snapshot.prepayCents > cap) throw new NeptuneError("预扣金额超过设置的上限，停止操作。", "prepay");
  if (snapshot.balanceCents < snapshot.prepayCents) throw new NeptuneError("账户余额不足，请在微信充值。", "balance");
  if (snapshot.activeOrder) throw new NeptuneError("目标插座已有本人的充电订单，不重复提交。", "already-charging");
  if (snapshot.otherOrder) throw new NeptuneError("本人在其他插座已有订单，停止新建充电。", "other-order");
  if (!snapshot.portAvailable) throw new NeptuneError("目标插座已被占用、故障或状态未知，停止操作。", "occupied");
  return { config, target, cap, expected, snapshot, device };
}

/** Reservation preflight is read-only and permits the station to be closed until execution time. */
export async function checkReservation(config: AccountConfig, target: Target, maxPrepayCents: number): Promise<TargetSnapshot> {
  return (await checkedChargeSnapshot(config, target, maxPrepayCents)).snapshot;
}

export async function prepareCharge(rawConfig: AccountConfig, rawTarget: Target, maxPrepayCents: number): Promise<PreparedCharge> {
  const { config, target, cap, expected, snapshot, device } = await checkedChargeSnapshot(rawConfig, rawTarget, maxPrepayCents);
  if (!snapshot.businessOpen) throw new NeptuneError("平台尚未恢复营业，不能启动充电。", "closed");
  return { version: 1, config, target: { ...target, prices: expected }, prepayCents: snapshot.prepayCents,
    maxPrepayCents: cap, preparedAt: new Date().toISOString(), submitted: false, acknowledged: false, msgflag: null, verificationDisabled: false,
    payload: { devaddress: target.device, port: target.port, money: 7, areaId: config.areaId, openId: config.openId,
      beforemoney: snapshot.balanceCents, devtypeid: 40, fullStop: 0, payType: 1, safeOpen: 0,
      safeCharge: integer(device.safeCharge, "安全充电模式"), edtType: 0,
      efee: expected.efee, eCharge: expected.eCharge, serviceCharge: expected.serviceCharge, yuan7: 0 } };
}
function preparedChecks(prepared: PreparedCharge): void {
  if (!prepared || prepared.version !== 1 || !object(prepared.payload)) throw new NeptuneError("充电请求状态异常。");
  const config = checkedConfig(prepared.config), target = checkedTarget(prepared.target), prices = checkedPrices(target.prices);
  const constants: Form = { devaddress: target.device, port: target.port, openId: config.openId, areaId: config.areaId,
    money: 7, devtypeid: 40, fullStop: 0, payType: 1, safeOpen: 0, edtType: 0, yuan7: 0,
    efee: prices.efee, eCharge: prices.eCharge, serviceCharge: prices.serviceCharge };
  if (Object.entries(constants).some(([key, value]) => prepared.payload[key] !== value) ||
      Object.keys(prepared.payload).length !== Object.keys(constants).length + 2 ||
      "msgflag" in prepared.payload) throw new NeptuneError("充电请求参数与已核对的套餐不符。");
  integer(prepared.payload.safeCharge, "安全充电模式");
  const prepay = integer(prepared.prepayCents, "预扣金额", 1), cap = integer(prepared.maxPrepayCents, "预扣上限", 1);
  if (prepay > cap || integer(prepared.payload.beforemoney, "余额") < prepay) throw new NeptuneError("充电金额核对失败。");
  if (typeof prepared.submitted !== "boolean" || typeof prepared.acknowledged !== "boolean" || typeof prepared.verificationDisabled !== "boolean") throw new NeptuneError("充电请求状态异常。");
}

/** Makes exactly one new request. Persist a durable submitting claim first; never retry this function after an uncertain result. */
export async function submitCharge(prepared: PreparedCharge): Promise<SubmissionResult> {
  preparedChecks(prepared);
  if (prepared.submitted) throw new NeptuneError("本次请求已经提交过，不能重新新建充电。", "duplicate");
  const age = Date.now() - Date.parse(prepared.preparedAt);
  if (!Number.isFinite(age) || age < -5_000 || age > 60_000) throw new NeptuneError("提交前核对已过期，请重新只读核对。", "stale");
  prepared.submitted = true;
  let result: JsonObject;
  try { result = await call("beginCharge", prepared.payload, true); }
  catch { return { status: "uncertain", msgflag: null, message: "提交结果不明，请在微信核对；不会重新提交。" }; }
  if (result.success !== true) {
    prepared.verificationDisabled = true;
    return { status: "rejected", msgflag: null, message: "平台拒绝启动，请在微信核对。" };
  }
  const flag = result.obj;
  if (!(typeof flag === "string" && flag.length > 0 && flag.length <= 256 || typeof flag === "number" && Number.isSafeInteger(flag))) {
    return { status: "uncertain", msgflag: null, message: "平台请求标识格式异常，只核对本人订单。" };
  }
  prepared.msgflag = String(flag);
  return { status: "pending", msgflag: prepared.msgflag, message: "请求已发送，正在等待平台确认开电。" };
}

/** One verification round; only the original msgflag is used. No new transaction is ever created. */
export async function verifyCharge(prepared: PreparedCharge, msgflag: string | null, acknowledged = prepared.acknowledged): Promise<VerificationResult> {
  preparedChecks(prepared);
  if (!prepared.submitted) throw new NeptuneError("本次请求尚未提交，不能查询开电。", "unsubmitted");
  if (msgflag !== prepared.msgflag || msgflag !== null && (!msgflag || msgflag.length > 256)) throw new NeptuneError("开电核对必须沿用原请求标识。", "token");
  prepared.acknowledged = prepared.acknowledged || acknowledged === true;
  if (msgflag !== null && !prepared.acknowledged && !prepared.verificationDisabled) {
    try {
      const result = await call("beginCharge", { ...prepared.payload, msgflag }, true);
      if (result.success === true) prepared.acknowledged = true;
      else if (result.msg !== "设备无响应，请稍后再试！") prepared.verificationDisabled = true;
    } catch { /* Continue only with the original token or a read of the user's order. */ }
  }
  let order: JsonObject | null;
  try { order = await activeOrder(prepared.config); }
  catch { return { confirmed: false, acknowledged: prepared.acknowledged, activeOrder: false, otherOrder: false, retryable: true }; }
  const active = matching(order, prepared.target), other = !!order && !active;
  return { confirmed: active && prepared.acknowledged, acknowledged: prepared.acknowledged, activeOrder: active,
    otherOrder: other, retryable: !other && !prepared.verificationDisabled };
}
