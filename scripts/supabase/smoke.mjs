// Cloud staging smoke check (spec §4.6 step 6). Read-only: no browser, no credentials, no secrets.
//
//   node scripts/supabase/smoke.mjs https://<project>.vercel.app
//
// Checks:
//   1. GET  /login                         -> 200 (the app is up and serves its sign-in page)
//   2. POST /api/worker/tick, no header    -> 401 (the worker route refuses a caller without CRON_SECRET)
//
// Prints PASS or FAIL per check and exits 1 if any failed (2 on a bad argument). A network error (the
// server is down, DNS fails) is a FAIL line, never a stack trace. Row counts are compared separately,
// with psql in the laptop's db container.

const TIMEOUT_MS = 20_000;

function parseBase(arg) {
  try {
    const url = new URL(arg);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function describeError(err) {
  const cause = err && err.cause;
  const code = cause && (cause.code || (cause.errors && cause.errors[0] && cause.errors[0].code));
  if (code === "ECONNREFUSED") return "connection refused";
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) return `no answer within ${TIMEOUT_MS / 1000} s`;
  if (code) return `${code}${cause.message ? ` (${cause.message})` : ""}`;
  return (cause && cause.message) || (err && err.message) || String(err);
}

async function check(name, run) {
  try {
    const detail = await run();
    if (detail.ok) {
      console.log(`PASS  ${name} (${detail.note})`);
      return true;
    }
    console.log(`FAIL  ${name} (${detail.note})`);
    return false;
  } catch (err) {
    console.log(`FAIL  ${name} (${describeError(err)})`);
    return false;
  }
}

async function main() {
  const base = parseBase(process.argv[2] ?? "");
  if (!base) {
    console.log("usage: node scripts/supabase/smoke.mjs <appUrl>   e.g. https://<project>.vercel.app");
    process.exit(2);
  }
  console.log(`smoke: ${base}`);

  const results = [
    await check("GET /login is 200", async () => {
      const res = await fetch(`${base}/login`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      return { ok: res.status === 200, note: `got ${res.status}` };
    }),
    await check("POST /api/worker/tick without a secret is 401", async () => {
      const res = await fetch(`${base}/api/worker/tick`, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { ok: res.status === 401, note: `got ${res.status}` };
    }),
  ];

  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `smoke: ${failed} of ${results.length} checks FAILED` : `smoke: all ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.log(`FAIL  smoke (${describeError(err)})`);
  process.exit(1);
});
