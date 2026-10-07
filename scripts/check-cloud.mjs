const args = process.argv.slice(2);
const help = args.includes("--help");
if (help) {
  console.log("Usage: node scripts/check-cloud.mjs https://YOUR-DOMAIN [--diagnostic]\nOptional process env for diagnostic only: NEPTUNE_CHECK_ACCESS_TOKEN. No credentials are printed.\nThe default checks use no account and create no reservation or charging request.");
} else {
  await checkCloud();
}

async function checkCloud() {
  const diagnostic = args.includes("--diagnostic");
  const positional = args.filter(arg => !arg.startsWith("--"));
  if (positional.length !== 1 || args.some(arg => arg.startsWith("--") && arg !== "--diagnostic")) {
    fail("Provide one HTTPS origin, optionally with --diagnostic."); return;
  }
  let origin;
  try {
    const url = new URL(positional[0]);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    origin = url.origin;
  } catch { fail("Use an HTTPS origin without a path, query string, or credentials; localhost HTTP is allowed."); return; }
  const checks = [];
  async function request(path, init = {}) {
    try {
      const response = await fetch(`${origin}${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      let json = null;
      if (response.headers.get("content-type")?.includes("application/json")) json = await response.json();
      return { status: response.status, json };
    } catch { return { status: 0, json: null }; }
  }
  const health = await request("/api/health");
  checks.push({ check: "health", ok: health.status === 200 && health.json?.service === "neptune-charge-hub" && health.json?.configured === true, status: health.status, configured: health.json?.configured === true, chargingEnabled: health.json?.chargingEnabled === true });
  const unauthorized = await request("/api/hub?live=0");
  checks.push({ check: "unauthorized-hub", ok: unauthorized.status === 401, status: unauthorized.status });
  const unauthorizedDiagnostics = await request("/api/diagnostics");
  checks.push({ check: "unauthorized-diagnostics", ok: [400, 401, 403].includes(unauthorizedDiagnostics.status) && typeof unauthorizedDiagnostics.json?.error === "string", status: unauthorizedDiagnostics.status });
  const setup = await request("/api/setup", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: "{}" });
  checks.push({ check: "setup-disabled-in-production", ok: setup.status === 404, status: setup.status });
  if (diagnostic) {
    const token = process.env.NEPTUNE_CHECK_ACCESS_TOKEN;
    if (!token) checks.push({ check: "cloud-readonly-diagnostic", ok: false, reason: "Missing NEPTUNE_CHECK_ACCESS_TOKEN in the current process." });
    else {
      const headers = { Authorization: `Bearer ${token}`, Origin: origin, "Content-Type": "application/json" };
      const created = await request("/api/diagnostics", { method: "POST", headers, body: "{}" });
      let completed = created;
      const id = created.json?.id;
      if (created.status >= 200 && created.status < 300 && typeof id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2_000));
          completed = await request(`/api/diagnostics?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
          if (completed.json?.phase === "complete") break;
        }
      }
      checks.push({ check: "cloud-readonly-diagnostic", ok: completed.status === 200 && completed.json?.phase === "complete" && completed.json?.platform_reachable === true, status: completed.status, phase: completed.json?.phase ?? null, platformReachable: completed.json?.platform_reachable === true });
    }
  }
  const ok = checks.every(check => check.ok);
  console.log(JSON.stringify({ origin, ok, checks }));
  if (!ok) process.exitCode = 1;
}

function fail(error) { console.error(JSON.stringify({ ok: false, error })); process.exitCode = 1; }
