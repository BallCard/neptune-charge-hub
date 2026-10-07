import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../src/app/api/hub/route";
import { seal } from "../src/lib/crypto";
import type { AccountConfig } from "../src/lib/neptune";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TARGET_A = "33333333-3333-4333-8333-333333333333";
const TARGET_B = "44444444-4444-4444-8444-444444444444";
const RESERVATION_A = "55555555-5555-4555-8555-555555555555";
const RESERVATION_B = "66666666-6666-4666-8666-666666666666";
const IDEMPOTENCY_KEY = "77777777-7777-4777-8777-777777777777";
const APP_ORIGIN = "https://charge-hub.example.test";
const SUPABASE_ORIGIN = "https://offline-supabase.example.test";
const AUTH_TOKEN = "dummy-user-a-access-token";
const SERVICE_KEY = "dummy-server-service-key";
const prices = { efee: 110, eCharge: 55, serviceCharge: 55, efee_l: 80, eCharge_l: 80, serviceCharge_l: 0 };
const config: AccountConfig = { openId: "private-test-account", employeeId: 123, areaId: 6,
  defaultTarget: { device: "60359118", port: "06" }, prices };
type Row = Record<string, unknown>;
type CapturedRequest = { url: URL; method: string; headers: Headers; body: Row | null; form?: Record<string, string> };

/** Offline HTTP boundary: unexpected hosts fail locally instead of delegating to real fetch. */
class OfflineServices {
  calls: CapturedRequest[] = [];
  anonymous = false;
  rejectAuth = false;
  platformFailureEndpoint?: string;
  platformOrder: Row | null = { devaddress: "60359118", devport: "06", power: 33,
    openId: config.openId, phone: "00000000000", account_cipher: "private-platform-value" };
  beforeMutation?: (request: CapturedRequest) => void;
  accounts: Row[] = [
    { user_id: USER_A, account_hash: "private-account-hash", account_cipher: seal(config, USER_A),
      preferences: { defaultTime: "06:00", weekdays: [1, 2], maxPrepayCents: 200 } },
    { user_id: USER_B, account_hash: "other-account-hash", account_cipher: "other-user-cipher", preferences: {} },
  ];
  targets: Row[] = [
    { id: TARGET_A, user_id: USER_A, label: "自己的充电点", device: "60359118", port: "06", prices },
    { id: TARGET_B, user_id: USER_B, label: "另一位用户的充电点", device: "12345678", port: "02", prices },
  ];
  reservations: Row[] = [
    { id: RESERVATION_A, user_id: USER_A, target_id: TARGET_A, scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
      phase: "scheduled", result: "预约已登记。", created_at: "2026-10-07T01:00:00.000Z", idempotency_key: IDEMPOTENCY_KEY,
      account_cipher: seal({ config, target: { ...config.defaultTarget, prices } }, USER_A),
      transaction_cipher: "private-transaction-cipher", msgflag: "private-request-token" },
    { id: RESERVATION_B, user_id: USER_B, target_id: TARGET_B, scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
      phase: "scheduled", result: "另一位用户的预约", created_at: "2026-10-07T01:00:00.000Z", idempotency_key: "88888888-8888-4888-8888-888888888888",
      account_cipher: "other-private-reservation-cipher", transaction_cipher: "other-private-transaction-cipher" },
  ];

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const bodyText = request.method === "GET" ? "" : await request.clone().text();
    const captured: CapturedRequest = { url: new URL(request.url), method: request.method, headers: request.headers,
      body: bodyText && request.headers.get("content-type")?.includes("application/json") ? JSON.parse(bodyText) as Row : null,
      ...(bodyText && request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") ?
        { form: Object.fromEntries(new URLSearchParams(bodyText)) } : {}) };
    this.calls.push(captured);
    if (captured.url.origin === SUPABASE_ORIGIN && captured.url.pathname === "/auth/v1/user") {
      assert.equal(request.headers.get("authorization"), `Bearer ${AUTH_TOKEN}`);
      if (this.rejectAuth) return Response.json({ message: "invalid dummy token" }, { status: 401 });
      return Response.json({ id: USER_A, aud: "authenticated", role: "authenticated", email: "owner-a@example.test",
        is_anonymous: this.anonymous, app_metadata: {}, user_metadata: {}, created_at: "2026-10-07T01:00:00.000Z" });
    }
    if (captured.url.origin === SUPABASE_ORIGIN && captured.url.pathname.startsWith("/rest/v1/")) {
      assert.equal(request.headers.get("authorization"), `Bearer ${SERVICE_KEY}`);
      assert.equal(request.headers.get("apikey"), SERVICE_KEY);
      const table = captured.url.pathname.slice("/rest/v1/".length);
      const rows = table === "charge_accounts" ? this.accounts : table === "charge_targets" ? this.targets : table === "charge_reservations" ? this.reservations : null;
      assert.ok(rows, `Unexpected offline table ${table}`);
      if (request.method !== "GET") this.beforeMutation?.(captured);
      const matched = rows.filter(row => this.matches(row, captured.url.searchParams));
      if (request.method === "PATCH") {
        assert.ok(captured.body);
        for (const row of matched) Object.assign(row, captured.body);
        return this.restResponse(request, matched, captured.url.searchParams.get("select"));
      }
      if (request.method === "POST" && table === "charge_reservations" && captured.body) {
        const activePhases = ["queued", "scheduled", "waiting", "checking", "submitting", "pending", "uncertain"];
        const conflicts = this.reservations.some(row => activePhases.includes(String(row.phase)) &&
          (row.user_id === captured.body!.user_id || row.account_hash === captured.body!.account_hash ||
            row.device === captured.body!.device && row.port === captured.body!.port));
        assert.ok(conflicts, "Creating fresh reservations is outside the offline API suite");
        return Response.json({ code: "23505", message: "one_active_booking_per_user" }, { status: 409 });
      }
      // Creating a fresh workflow is deliberately outside this suite. Any attempted write fails offline.
      assert.equal(request.method, "GET", "This suite must never insert a booking or start a workflow");
      return this.restResponse(request, matched, captured.url.searchParams.get("select"));
    }
    if (captured.url.origin === "https://www.szlzxn.cn" && request.method === "POST") {
      const endpoint = captured.url.pathname.slice("/wxn/".length);
      const form = new URLSearchParams(bodyText);
      if (endpoint === this.platformFailureEndpoint) throw new Error("offline platform unavailable");
      if (endpoint === "getUserInfo") {
        assert.equal(form.get("openId"), config.openId);
        return Response.json({ success: true, obj: { employeeid: 123, readyaccountmoney: 639, openId: config.openId } });
      }
      if (endpoint === "getMsgs") return Response.json({ success: true, obj: { registrationCz: "1", telphone: "00000000000" } });
      if (endpoint === "getDeviceInfo") return Response.json({ success: true, obj: { ...prices, devaddress: "60359118",
        devtypeid: 40, measure: 1, isuse: 1, countPay: 1, yuan5: 1, ycTime: 480, yk: 200,
        portstatur: "000000000000", isWorkTime: 0, safeCharge: 9 } });
      if (endpoint === "isChargeing") return Response.json({ success: true, obj: this.platformOrder });
      assert.fail(`Forbidden platform mutation ${endpoint}`);
    }
    assert.fail(`Unexpected outbound request blocked: ${captured.url.origin}`);
  };

  private matches(row: Row, parameters: URLSearchParams) {
    for (const [field, filter] of parameters) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(field)) continue;
      if (filter.startsWith("eq.") && String(row[field]) !== filter.slice(3)) return false;
      if (filter.startsWith("in.(") && !filter.slice(4, -1).split(",").includes(String(row[field]))) return false;
      if (filter.startsWith("gt.") && String(row[field]) <= filter.slice(3)) return false;
    }
    return true;
  }
  private restResponse(request: Request, rows: Row[], selected: string | null) {
    const projected = !selected || selected === "*" ? rows : rows.map(row => Object.fromEntries(selected.split(",").map(key => [key, row[key]])));
    if (request.headers.get("accept")?.includes("application/vnd.pgrst.object+json")) {
      return projected.length === 1 ? Response.json(projected[0]) : Response.json({ code: "PGRST116", message: "Expected one row" }, { status: 406 });
    }
    if (request.method !== "GET" && !request.headers.get("prefer")?.includes("return=representation")) return new Response(null, { status: 204 });
    return Response.json(projected);
  }
  get restCalls() { return this.calls.filter(call => call.url.pathname.startsWith("/rest/v1/")); }
  get writes() { return this.restCalls.filter(call => call.method !== "GET"); }
}

async function offline(action: (services: OfflineServices) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const env = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_ORIGIN, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ACCOUNT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), CHARGING_ENABLED: "true" };
  const priorEnv = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  const services = new OfflineServices();
  globalThis.fetch = services.fetch;
  try { await action(services); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
function getRequest(query = "", authenticated = true) {
  return new Request(`${APP_ORIGIN}/api/hub${query}`, { headers: authenticated ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {} });
}
function postRequest(action: string, payload: Row = {}, options: { origin?: string; authenticated?: boolean } = {}) {
  return new Request(`${APP_ORIGIN}/api/hub`, { method: "POST", headers: {
    "Content-Type": "application/json", Origin: options.origin ?? APP_ORIGIN,
    ...(options.authenticated !== false ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
  }, body: JSON.stringify({ action, payload }) });
}
function assertSafeResponse(body: unknown, services: OfflineServices) {
  const json = JSON.stringify(body);
  for (const forbidden of ["account_cipher", "transaction_cipher", "openId", "employeeId", "telphone", "phone",
    "msgflag", "private-test-account", "00000000000", AUTH_TOKEN, SERVICE_KEY, USER_B, TARGET_B, RESERVATION_B,
    ...services.accounts.map(row => String(row.account_cipher)),
    ...services.reservations.flatMap(row => [String(row.account_cipher), String(row.transaction_cipher)]),
    "other-private-reservation-cipher", "private-request-token"]) {
    assert.ok(!json.includes(forbidden), `Sensitive value or another tenant leaked: ${forbidden}`);
  }
}

test("API rejects missing bearer before any backend request", async () => offline(async services => {
  for (const response of [await GET(getRequest("", false)), await POST(postRequest("refresh", {}, { authenticated: false }))]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "请先登录自己的账户。" });
  }
  assert.equal(services.calls.length, 0);
}));

test("API refuses foreign or missing Origin without authenticating or mutating", async () => offline(async services => {
  const wrongOrigin = await POST(postRequest("cancel", { id: RESERVATION_A }, { origin: "https://foreign.example.test" }));
  const missingOriginRequest = postRequest("cancel", { id: RESERVATION_A });
  missingOriginRequest.headers.delete("origin");
  const missingOrigin = await POST(missingOriginRequest);
  assert.equal(wrongOrigin.status, 403);
  assert.equal(missingOrigin.status, 403);
  assert.equal(services.calls.length, 0);
}));

test("API rejects anonymous and invalid authenticated users before reading tenant data", async () => offline(async services => {
  services.anonymous = true;
  assert.equal((await GET(getRequest())).status, 401);
  services.anonymous = false; services.rejectAuth = true;
  assert.equal((await POST(postRequest("refresh"))).status, 401);
  assert.equal(services.restCalls.length, 0);
  assert.equal(services.writes.length, 0);
}));

test("API returns only the caller's selected public state and strips platform account/order details", async () => offline(async services => {
  const response = await GET(getRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.userEmail, "owner-a@example.test");
  assert.equal(body.configured, true);
  assert.deepEqual(body.targets.map((row: Row) => row.id), [TARGET_A]);
  assert.deepEqual(body.reservations.map((row: Row) => row.id), [RESERVATION_A]);
  assert.equal(body.live.powerWatts, 33);
  assert.equal(body.live.activeOrder, true);
  assert.equal(body.live.businessOpen, false);
  assertSafeResponse(body, services);
  assert.ok(services.restCalls.every(call => call.url.searchParams.get("user_id") === `eq.${USER_A}`));
  assert.equal(services.writes.length, 0);
}));

test("active reservation status follows its frozen account after the current binding changes", async () => offline(async services => {
  const replacement = { ...config, openId: "different-current-private-account", employeeId: 456 };
  services.accounts[0].account_cipher = seal(replacement, USER_A);
  services.targets[0].device = "12345678";
  services.targets[0].port = "02";
  const response = await GET(getRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.live.activeOrder, true);
  assert.equal(body.live.balanceCents, 639);
  assert.equal(body.live.powerWatts, 33);
  assertSafeResponse(body, services);
  assert.ok(!JSON.stringify(body).includes(replacement.openId));
  const frozenReads = services.restCalls.filter(call => call.url.searchParams.get("select") === "account_cipher");
  assert.equal(frozenReads.length, 1);
  assert.equal(frozenReads[0].url.searchParams.get("id"), `eq.${RESERVATION_A}`);
  assert.equal(frozenReads[0].url.searchParams.get("user_id"), `eq.${USER_A}`);
  const accountReads = services.calls.filter(call => call.url.pathname.endsWith("getUserInfo"));
  assert.ok(accountReads.every(call => call.form?.openId === config.openId));
  const deviceReads = services.calls.filter(call => call.url.pathname.endsWith("getDeviceInfo"));
  assert.ok(deviceReads.every(call => call.form?.devaddress === config.defaultTarget.device));
}));

test("API cannot cancel another user's reservation even when its UUID is known", async () => offline(async services => {
  const response = await POST(postRequest("cancel", { id: RESERVATION_B, user_id: USER_B }));
  assert.equal(response.status, 400);
  assert.equal(services.reservations[1].phase, "scheduled");
  assert.equal(services.writes.length, 0);
  const lookup = services.restCalls.find(call => call.url.searchParams.get("id") === `eq.${RESERVATION_B}`);
  assert.ok(lookup);
  assert.equal(lookup.url.searchParams.get("user_id"), `eq.${USER_A}`);
  assertSafeResponse(await response.json(), services);
}));

test("API owns both cancel lookup and atomic write; successful cancellation preserves another tenant", async () => offline(async services => {
  const response = await POST(postRequest("cancel", { id: RESERVATION_A }));
  assert.equal(response.status, 200);
  assert.equal(services.reservations[0].phase, "cancelled");
  assert.equal(services.reservations[1].phase, "scheduled");
  const write = services.writes[0];
  assert.equal(services.writes.length, 1);
  assert.equal(write.url.searchParams.get("user_id"), `eq.${USER_A}`);
  assert.equal(write.url.searchParams.get("id"), `eq.${RESERVATION_A}`);
  assert.equal(write.url.searchParams.get("phase"), "in.(queued,scheduled)");
  assert.ok(write.url.searchParams.get("scheduled_at")?.startsWith("gt."));
  assertSafeResponse(await response.json(), services);
}));

test("API cancellation fails when execution claims the reservation between read and write", async () => offline(async services => {
  services.beforeMutation = request => {
    if (request.method === "PATCH" && request.url.pathname.endsWith("charge_reservations")) services.reservations[0].phase = "submitting";
  };
  const response = await POST(postRequest("cancel", { id: RESERVATION_A }));
  assert.equal(response.status, 400);
  assert.equal(services.reservations[0].phase, "submitting");
  assert.match((await response.json()).error, /状态已变化/);
  assert.equal(services.writes.length, 1);
}));

test("API replay of a persisted idempotency key never inserts or invokes a new workflow", async () => offline(async services => {
  const payload = { targetId: TARGET_A, scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    confirmedPlug: true, idempotencyKey: IDEMPOTENCY_KEY };
  for (let replay = 0; replay < 2; replay++) {
    const response = await POST(postRequest("reserve", payload));
    assert.equal(response.status, 200);
    assertSafeResponse(await response.json(), services);
  }
  assert.equal(services.writes.length, 0);
  assert.equal(services.reservations.length, 2);
  const lookups = services.restCalls.filter(call => call.url.searchParams.has("idempotency_key"));
  assert.equal(lookups.length, 2);
  assert.ok(lookups.every(call => call.url.searchParams.get("user_id") === `eq.${USER_A}`));
  assert.ok(services.calls.every(call => !call.url.pathname.includes("workflow") && !call.url.pathname.endsWith("beginCharge")));
}));

test("API also prevents another tenant's target UUID from being used in a fresh reservation", async () => offline(async services => {
  const response = await POST(postRequest("reserve", { targetId: TARGET_B, scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    confirmedPlug: true, idempotencyKey: "99999999-9999-4999-8999-999999999999", user_id: USER_B }));
  assert.equal(response.status, 400);
  assert.equal(services.writes.length, 0);
  const lookup = services.restCalls.find(call => call.url.pathname.endsWith("charge_targets") && call.url.searchParams.get("id") === `eq.${TARGET_B}`);
  assert.ok(lookup);
  assert.equal(lookup.url.searchParams.get("user_id"), `eq.${USER_A}`);
}));

test("API checks request media type and actual body length before applying any action", async () => offline(async services => {
  const wrongType = postRequest("refresh"); wrongType.headers.set("content-type", "text/plain");
  assert.equal((await POST(wrongType)).status, 415);
  assert.equal(services.calls.length, 0);
  const tooLarge = postRequest("savePreferences", { padding: "x".repeat(16_384) });
  const response = await POST(tooLarge);
  assert.equal(response.status, 413);
  assert.equal(services.restCalls.length, 0);
  assert.equal(services.writes.length, 0);
}));

test("uncertain reservations keep account and target settings locked and cannot be cancelled", async () => offline(async services => {
  services.reservations[0].phase = "uncertain";
  for (const [action, payload] of [
    ["importAccount", { url: "unused-by-blocked-import", label: "新充电点" }],
    ["saveTarget", { label: "新充电点", device: "12345678", port: "02" }],
    ["deleteTarget", { id: TARGET_A }],
    ["cancel", { id: RESERVATION_A }],
  ] as [string, Row][]) {
    assert.equal((await POST(postRequest(action, payload))).status, 400);
  }
  assert.equal(services.reservations[0].phase, "uncertain");
  assert.equal(services.writes.length, 0);
  assert.ok(services.restCalls.some(call => call.url.searchParams.get("phase")?.includes("uncertain")));
  assert.ok(services.calls.every(call => call.url.origin === SUPABASE_ORIGIN));
}));

test("uncertain reservation blocks a fresh booking at the database constraint without starting a workflow", async () => offline(async services => {
  services.reservations[0].phase = "uncertain";
  services.platformOrder = null;
  const response = await POST(postRequest("reserve", { targetId: TARGET_A,
    scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), confirmedPlug: true,
    idempotencyKey: "99999999-9999-4999-8999-999999999999" }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /已有待执行预约/);
  assert.equal(services.reservations[0].phase, "uncertain");
  assert.equal(services.reservations.length, 2);
  assert.equal(services.writes.length, 1);
  assert.equal(services.writes[0].method, "POST");
  assert.ok(services.calls.every(call => !call.url.pathname.includes("workflow") && !call.url.pathname.endsWith("beginCharge")));
}));

test("resolving an uncertain result requires explicit review and the caller's reservation ownership", async () => offline(async services => {
  services.reservations[0].phase = "uncertain";
  services.reservations[1].phase = "uncertain";
  assert.equal((await POST(postRequest("resolveUncertain", { id: RESERVATION_A }))).status, 400);
  assert.equal((await POST(postRequest("resolveUncertain", { id: RESERVATION_A, confirmedReviewed: false }))).status, 400);
  const response = await POST(postRequest("resolveUncertain", { id: RESERVATION_B, confirmedReviewed: true, user_id: USER_B }));
  assert.equal(response.status, 400);
  assert.equal(services.writes.length, 0);
  assert.equal(services.reservations[1].phase, "uncertain");
  const lookup = services.restCalls.find(call => call.url.searchParams.get("id") === `eq.${RESERVATION_B}`);
  assert.ok(lookup);
  assert.equal(lookup.url.searchParams.get("user_id"), `eq.${USER_A}`);
  assert.equal(lookup.url.searchParams.get("phase"), "eq.uncertain");
  assert.ok(services.calls.every(call => call.url.origin === SUPABASE_ORIGIN));
}));

test("reviewing an uncertain target order releases the lock by a read-only platform check", async () => offline(async services => {
  services.reservations[0].phase = "uncertain";
  const response = await POST(postRequest("resolveUncertain", { id: RESERVATION_A, confirmedReviewed: true }));
  assert.equal(response.status, 200);
  assert.equal(services.reservations[0].phase, "already-charging");
  assert.equal(services.reservations[1].phase, "scheduled");
  assert.equal(services.writes.length, 1);
  const write = services.writes[0];
  assert.equal(write.url.searchParams.get("id"), `eq.${RESERVATION_A}`);
  assert.equal(write.url.searchParams.get("user_id"), `eq.${USER_A}`);
  assert.equal(write.url.searchParams.get("phase"), "eq.uncertain");
  assertSafeResponse(await response.json(), services);
  assert.ok(services.calls.every(call => !call.url.pathname.endsWith("beginCharge")));
}));

test("reviewing an uncertain reservation with no order releases it as failed without new charge traffic", async () => offline(async services => {
  services.reservations[0].phase = "uncertain";
  services.platformOrder = null;
  const response = await POST(postRequest("resolveUncertain", { id: RESERVATION_A, confirmedReviewed: true }));
  assert.equal(response.status, 200);
  assert.equal(services.reservations[0].phase, "failed");
  assert.equal(services.writes.length, 1);
  assertSafeResponse(await response.json(), services);
  assert.ok(services.calls.every(call => !call.url.pathname.endsWith("beginCharge")));
}));

test("other-socket orders and failed platform reads preserve the uncertain lock", async () => offline(async services => {
  services.reservations[0].phase = "uncertain";
  services.platformOrder = { devaddress: "60359118", devport: "05", power: 33 };
  const occupied = await POST(postRequest("resolveUncertain", { id: RESERVATION_A, confirmedReviewed: true }));
  assert.equal(occupied.status, 400);
  assert.match((await occupied.json()).error, /其他插座订单/);
  services.platformOrder = null;
  services.platformFailureEndpoint = "isChargeing";
  const unreadable = await POST(postRequest("resolveUncertain", { id: RESERVATION_A, confirmedReviewed: true }));
  assert.equal(unreadable.status, 400);
  assert.equal(services.reservations[0].phase, "uncertain");
  assert.equal(services.writes.length, 0);
  assert.ok(services.calls.every(call => !call.url.pathname.endsWith("beginCharge")));
}));
