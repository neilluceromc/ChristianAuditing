// Phase 43 (spec §4): the load test's readers — 15 virtual people reading pages over plain HTTP.
//
//   SEED_PASSWORD=… node scripts/loadtest/run.mjs --base http://192.168.1.193:3000 --minutes 6 --out readers.json
//
// Each person signs in as their own test account (perf01–perf15) through the NextAuth credentials callback, keeps
// their own cookies, and follows their role's weighted scenario (scenarios.mjs) with 2–6 s of think time between
// page GETs. Every request is recorded as { user, route, ms, status } with ids normalised out of the route.
// Laptop safety: at most 15 people, one request in flight per person, 30 s per request, a hard stop at --minutes
// (max 8). Run it alone against staging — see README.md.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  CookieJar, MAX_USERS, REQUEST_TIMEOUT_MS, THINK_MAX_MS, parseBase, parseMinutes, requireSeedPassword, sleep, thinkMs,
} from "./common.mjs";
import { SCENARIOS, USERS, extractIds, pickWeighted, resolveStep, routeLabel } from "./scenarios.mjs";

const POOL_CAP = 200;

/** Signs one person in; their jar then holds the session cookie. Throws a message that never contains the password. */
async function signIn(base, user, password, jar, stop) {
  const signal = () => AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), stop]);
  const csrfRes = await fetch(`${base}/api/auth/csrf`, {
    headers: { cookie: jar.header() },
    signal: signal(),
  });
  jar.store(csrfRes.headers);
  if (!csrfRes.ok) throw new Error(`${user.name}: GET /api/auth/csrf answered ${csrfRes.status}`);
  const { csrfToken } = await csrfRes.json();

  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ email: user.email, password, csrfToken, callbackUrl: `${base}/` }),
    redirect: "manual",
    signal: signal(),
  });
  jar.store(res.headers);
  await res.arrayBuffer();
  const location = res.headers.get("location") ?? "";
  const where = location ? new URL(location, base) : null;
  if (res.status >= 400 || where?.searchParams.has("error") || !jar.has(/session-token/)) {
    const hint = where ? ` → ${where.pathname}${where.search}` : "";
    throw new Error(`${user.name} could not sign in (HTTP ${res.status}${hint}). Is SEED_PASSWORD staging's seed password, and has the scale seed run?`);
  }

  // The session must open a page, not bounce to /login.
  const check = await fetch(`${base}/`, {
    headers: { cookie: jar.header() },
    redirect: "manual",
    signal: signal(),
  });
  jar.store(check.headers);
  await check.arrayBuffer();
  if (check.status !== 200) throw new Error(`${user.name} signed in but GET / answered ${check.status} ${check.headers.get("location") ?? ""}`);
}

/** Adds newly found record ids to a person's pools, keeping the newest POOL_CAP per kind. */
function mergePools(pools, found) {
  for (const [kind, ids] of Object.entries(found)) {
    if (ids.length === 0) continue;
    const next = [...new Set([...(pools[kind] ?? []), ...ids])];
    pools[kind] = next.slice(-POOL_CAP);
  }
}

/** One virtual person: sign-in already done; reads until the stop signal. */
async function person({ base, user, jar, stop, requests, rand }) {
  const pools = {};

  async function get(url, dept) {
    const route = routeLabel(url, dept);
    const started = performance.now();
    try {
      const res = await fetch(base + url, {
        headers: { cookie: jar.header(), accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), stop]),
      });
      jar.store(res.headers);
      const body = await res.text();
      const row = { user: user.name, route, ms: Math.round(performance.now() - started), status: res.status };
      if (res.status >= 300 && res.status < 400) {
        const to = new URL(res.headers.get("location") ?? "/", base).pathname;
        row.error = to.startsWith("/login") ? "redirected to /login — session lost" : `redirected to ${to}`;
      } else if (!res.ok) row.error = `HTTP ${res.status}`;
      else mergePools(pools, extractIds(body));
      requests.push(row);
    } catch (err) {
      if (stop.aborted) return; // the hard stop cut it short: not a measurement
      const timedOut = err?.name === "TimeoutError";
      requests.push({
        user: user.name, route, ms: Math.round(performance.now() - started), status: 0,
        error: timedOut ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} s` : String(err?.cause?.code ?? err?.message ?? err),
      });
    }
  }

  // Spread the first clicks over one think time, so 15 people don't all start in the same second.
  await sleep(rand() * THINK_MAX_MS, stop);
  while (!stop.aborted) {
    const step = pickWeighted(SCENARIOS[user.role], rand);
    const dept = step.dept ?? user.dept;
    jar.set("br.dept", dept);
    let next = resolveStep(step, pools, rand);
    if (next.need) {
      // A record step with nothing to open yet: read its list first, as a person would.
      await get(next.need, dept);
      await sleep(thinkMs(rand), stop);
      if (stop.aborted) break;
      next = resolveStep(step, pools, rand);
      if (next.need) continue; // the list had no records of this kind
    }
    await get(next.url, dept);
    await sleep(thinkMs(rand), stop);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      minutes: { type: "string" },
      out: { type: "string" },
      users: { type: "string" },
    },
  });
  let base, minutes, count, password;
  try {
    base = parseBase(values.base);
    minutes = parseMinutes(values.minutes);
    if (!values.out) throw new Error("--out <file.json> is required");
    count = values.users === undefined ? MAX_USERS : Number(values.users);
    if (!Number.isInteger(count) || count < 1 || count > MAX_USERS) throw new Error(`--users must be 1–${MAX_USERS}`);
    password = requireSeedPassword();
  } catch (err) {
    console.error(err.message);
    console.error("Usage: node scripts/loadtest/run.mjs --base <url> --minutes <n ≤ 8> --out <file.json> [--users <1–15>]");
    process.exit(2);
  }

  // Ctrl+C is hooked before the sign-ins: during them it stops at once with nothing written (no load has run);
  // during the load it stops every person and writes what was measured.
  const controller = new AbortController();
  let interrupted = false;
  process.once("SIGINT", () => {
    interrupted = true;
    console.log("\n[readers] interrupted — stopping…");
    controller.abort();
  });
  const quitDuringSignIn = () => {
    console.error("[readers] interrupted during sign-in — no load was run, nothing written.");
    process.exit(130);
  };

  const people = USERS.slice(0, count).map((user) => ({ user, jar: new CookieJar() }));
  console.log(`[readers] signing in ${people.length} people at ${base}…`);
  for (const p of people) {
    try {
      await signIn(base, p.user, password, p.jar, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) quitDuringSignIn();
      console.error(`[readers] ${String(err?.message ?? err).replaceAll(password, "***")}`);
      process.exit(1);
    }
  }
  if (controller.signal.aborted) quitDuringSignIn();

  const requests = [];
  const startedAt = new Date();
  const deadline = setTimeout(() => controller.abort(), minutes * 60_000);
  const progress = setInterval(() => {
    const errors = requests.filter((r) => r.error).length;
    const elapsed = ((Date.now() - startedAt.getTime()) / 60_000).toFixed(1);
    console.log(`[readers] ${elapsed} min · ${requests.length} requests · ${errors} errors`);
  }, 30_000);

  console.log(`[readers] running ${people.length} people for ${minutes} min (hard stop)…`);
  const running = Promise.all(
    people.map((p) => person({ base, user: p.user, jar: p.jar, stop: controller.signal, requests, rand: Math.random })),
  );
  await running;
  clearTimeout(deadline);
  clearInterval(progress);

  const out = {
    kind: "readers", base, minutes, users: people.length,
    startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), interrupted, requests,
  };
  await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
  await writeFile(values.out, JSON.stringify(out, null, 2) + "\n", "utf8");
  const errors = requests.filter((r) => r.error).length;
  console.log(`[readers] done: ${requests.length} requests, ${errors} errors → ${values.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
