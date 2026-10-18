// Phase 43 (spec §4): the load test's writers — real changes through a real browser while the readers run.
//
//   SEED_PASSWORD=… node scripts/loadtest/writers.mjs --base http://192.168.1.193:3000 --minutes 6 --out writers.json
//
// ONE headless Chromium, three contexts:
//   perf01, perf02 (IT)  — open a spare from the Spare list, Assign it to an active scale employee (EMP-1xxx) from
//                          the asset page, Return it ("Back for triage"), then Triage it "Keep as spare" so it goes
//                          back to the pool; IT's lifecycle is direct, so each is a real server action, and the
//                          page's router.refresh() after the toast adds its own request to the load.
//   perf15 (admin)       — open the IT Approvals queue, open a PENDING request, Approve it (2 in 3) or Reject it.
// Each step is recorded as { user, action, ms, ok }; each server-action POST the step makes is also recorded as
// { action: "server action · <step>", ms, ok, server: true } from the browser's network timing. A failure records
// its message (no screenshots) and the loop carries on after a short pause.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import {
  REQUEST_TIMEOUT_MS, parseBase, parseMinutes, requireSeedPassword, serverActionTracker, sleep, thinkMs,
} from "./common.mjs";
import { USERS } from "./scenarios.mjs";

/** Scale-seed asset tags only (BR-xx-1000+): the fixed seed's records stay untouched. */
const SCALE_TAG = /^BR-[A-Z]{2}-1\d{3}$/;
const SCALE_EMPLOYEE = /EMP-1\d{3}/;
const APPROVAL_REF = /^APR-\d+$/;
/** No new assign cycle starts this close to the stop, so a run rarely ends with a spare still assigned. */
const CYCLE_HEADROOM_MS = 45_000;
/** How long an in-flight step may finish after the stop before the browser is closed. */
const STOP_GRACE_MS = 15_000;
const FAILURE_PAUSE_MS = 3_000;
/** Default cap on approve/reject decisions per run: the scale seed leaves about 28 unclaimed PENDING requests. */
const DEFAULT_MAX_DECISIONS = 12;

/** The hard stop: aborting it ends every pause at once, and no new step starts. */
const stopCtl = new AbortController();
/** A pause that the hard stop cuts short. */
const nap = (ms) => sleep(ms, stopCtl.signal);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A step that did not happen (nothing to act on). Not an error. */
class Skip extends Error {}

/** Per-person recording: the steps, plus every server-action POST tagged with the step that made it. */
function recorder({ user, actions, stopped, password }) {
  let phase = null;
  const redact = (text) => String(text).replaceAll(password, "***").replace(/\s+/g, " ").slice(0, 300);
  // Fix round 1: the label is captured when the POST starts, so a response still streaming after the step has
  // ended (its toast showed, `phase` cleared) is still recorded under the right step.
  const tracker = serverActionTracker({ user, actions, stopped });

  return {
    /** Names the step whose server-action POSTs follow (null: don't record them). */
    phase(name) {
      phase = name;
    },
    attach(page) {
      page.on("request", (req) => tracker.request(req, phase));
      page.on("requestfinished", (req) => tracker.finished(req).catch(() => {}));
      page.on("requestfailed", (req) => tracker.failed(req));
    },
    /**
     * Runs one step and records it. `fn` returns { ms?, value? }: `ms` when the step times itself (from the
     * confirming click), else the whole call is timed. A Skip is recorded as skipped; any other failure as an
     * error, followed by a short pause. Returns `value`, or null when the step did not succeed.
     */
    async step(action, fn) {
      const started = performance.now();
      try {
        const r = (await fn()) ?? {};
        actions.push({ user, action, ms: Math.round(r.ms ?? performance.now() - started), ok: true });
        return r.value ?? true;
      } catch (err) {
        if (stopped()) return null; // cut short by the hard stop: not a measurement
        if (err instanceof Skip) {
          actions.push({ user, action, ms: 0, ok: true, skipped: true, reason: err.message });
          return null;
        }
        actions.push({ user, action, ms: Math.round(performance.now() - started), ok: false, error: redact(err?.message ?? err) });
        await nap(FAILURE_PAUSE_MS);
        return null;
      } finally {
        phase = null;
      }
    },
  };
}

/** Navigates and times it to the load event (scripts in, so the page's buttons are live soon after). */
async function open(page, url) {
  const started = performance.now();
  const res = await page.goto(url, { waitUntil: "load" });
  if (!res || res.status() >= 400) throw new Error(`GET ${new URL(page.url()).pathname} answered ${res?.status() ?? "nothing"}`);
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("session lost — landed on /login");
  return { ms: performance.now() - started };
}

/** Clicks a trigger until its dialog shows: a click before hydration does nothing (the e2e suite's openMore rule). */
async function openDialog(trigger, dialog) {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    await trigger.click({ timeout: 5_000 }).catch(() => {});
    try {
      await dialog.waitFor({ state: "visible", timeout: 2_000 });
      return;
    } catch {
      // not hydrated yet — click again
    }
  }
  throw new Error("the dialog did not open");
}

/**
 * Clicks `confirm` and waits for the success toast; a new alert (a refusal banner or an error toast) is a failure
 * with that alert's text. Returns the time from the click to the toast: the server action's round trip plus the
 * toast's render. The page's router.refresh() starts only after the toast, so it is not in this time.
 */
async function confirmAndWait(page, confirm, successText) {
  const alerts = page.getByRole("alert");
  const before = await alerts.count();
  const success = page.getByText(successText).first();
  const started = performance.now();
  await confirm.click();
  const until = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < until) {
    if (await success.isVisible().catch(() => false)) return { ms: performance.now() - started };
    const n = await alerts.count().catch(() => before);
    if (n > before && !(await success.isVisible().catch(() => false))) throw new Error((await alerts.nth(n - 1).innerText().catch(() => "")) || "refused (alert shown)");
    await page.waitForTimeout(100);
  }
  throw new Error(`no confirmation within ${REQUEST_TIMEOUT_MS / 1000} s`);
}

async function signIn(page, user, password) {
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel(/Email/).fill(user.email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: REQUEST_TIMEOUT_MS });
}

/** IT: assign a spare from its asset page, return it for triage, triage it back to the spare pool. */
async function itLoop({ page, rec, rand, stopped, timeLeft, listPage }) {
  while (!stopped()) {
    if (timeLeft() < CYCLE_HEADROOM_MS) {
      await nap(Math.max(0, timeLeft()));
      break;
    }

    // 1. The Spare list: scale-seed spares on this writer's own page (perf01 page 1, perf02 page 2), so the two
    //    writers rarely reach for the same device; page 1 when that page has none.
    const candidates = await rec.step("open spare list", async () => {
      let found = [];
      let timing = null;
      for (const n of [listPage, 1]) {
        timing = await open(page, `/inventory?status=SPARE&page=${n}`);
        found = await page.getByRole("link", { name: SCALE_TAG }).evaluateAll((els) =>
          els.map((a) => ({ tag: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" })));
        found = found.filter((c) => /^\/inventory\/[a-z0-9]+$/.test(c.href));
        if (found.length) break;
      }
      return { ms: timing?.ms, value: found };
    });
    if (stopped()) break;
    if (!candidates || candidates.length === 0) {
      if (candidates) await rec.step("assign", async () => { throw new Skip("no scale-seed spare on the Spare list"); });
      await nap(thinkMs(rand));
      continue;
    }
    await nap(thinkMs(rand));

    // 2. The asset page, and its Assign dialog. A spare with an open approval or an active hold for someone is
    //    passed over for another (up to three tries).
    let picked = null;
    for (let tries = 0; tries < 3 && !picked && !stopped(); tries++) {
      const c = candidates.splice(Math.floor(rand() * candidates.length), 1)[0];
      if (!c) break;
      const opened = await rec.step("open asset", () => open(page, c.href));
      if (!opened) continue;
      const assign = page.getByRole("button", { name: "Assign", exact: true });
      if (!(await assign.isVisible().catch(() => false))) continue;
      const dialog = page.getByRole("dialog", { name: new RegExp(`^Assign ${escapeRe(c.tag)} `) });
      try {
        await openDialog(assign, dialog);
      } catch {
        continue;
      }
      if ((await dialog.getByText(/^Held for /).count()) > 0) {
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click().catch(() => {});
        continue;
      }
      picked = { ...c, dialog };
    }
    if (stopped()) break;
    if (!picked) {
      await rec.step("assign", async () => { throw new Skip("no assignable spare among the candidates"); });
      await nap(thinkMs(rand));
      continue;
    }

    // 3. Assign to an active scale employee found by typing part of an EMP number.
    const assigned = await rec.step("assign", async () => {
      const { tag, dialog } = picked;
      rec.phase("people search");
      // The scale seed numbers its 590 employees EMP-1000…EMP-1589, so "EMP-100"…"EMP-158" each match up to ten
      // (the picker lists ACTIVE people only); a prefix with nobody active is retried with another, twice.
      const options = dialog.getByRole("option", { name: SCALE_EMPLOYEE });
      let found = false;
      for (let attempt = 0; attempt < 3 && !found; attempt++) {
        const digits = String(Math.floor(rand() * 59)).padStart(2, "0");
        await dialog.getByRole("combobox").fill(`EMP-1${digits}`);
        found = await options.first().waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false);
      }
      if (!found) throw new Error("the people picker offered no active EMP-1xxx employee");
      const n = await options.count();
      await options.nth(Math.floor(rand() * Math.min(n, 10))).click();
      rec.phase("assign");
      return confirmAndWait(page, dialog.getByRole("button", { name: "Assign", exact: true }), new RegExp(`${escapeRe(tag)} assigned to`));
    });
    if (!assigned) continue;
    await nap(thinkMs(rand));
    if (stopped()) break;

    // 4. Return it: "Back for triage" (the dialog's default outcome).
    const returned = await rec.step("return", async () => {
      const dialog = page.getByRole("dialog", { name: new RegExp(`^Return ${escapeRe(picked.tag)} `) });
      await openDialog(page.getByRole("button", { name: "Return", exact: true }), dialog);
      rec.phase("return");
      return confirmAndWait(page, dialog.getByRole("button", { name: "Return", exact: true }), new RegExp(`${escapeRe(picked.tag)} returned`));
    });
    if (!returned) continue;
    await nap(thinkMs(rand));
    if (stopped()) break;

    // 5. Triage "Keep as spare": the device is assignable again, so the spare pool is the same size after the run.
    await rec.step("triage", async () => {
      const dialog = page.getByRole("dialog", { name: new RegExp(`^Triage ${escapeRe(picked.tag)} `) });
      await openDialog(page.getByRole("button", { name: "Triage", exact: true }), dialog);
      await dialog.getByLabel("Decision").selectOption("SPARE");
      rec.phase("triage");
      return confirmAndWait(page, dialog.getByRole("button", { name: "Save decision", exact: true }), new RegExp(`${escapeRe(picked.tag)} triaged`));
    });
    await nap(thinkMs(rand));
  }
}

/** Admin: approve (2 in 3) or reject a PENDING request from the IT Approvals queue, up to `maxDecisions`. */
async function approverLoop({ page, rec, rand, stopped, maxDecisions }) {
  let decisions = 0;
  while (!stopped()) {
    const pending = await rec.step("open approvals queue", async () => {
      const timing = await open(page, "/approvals");
      const value = await page.getByRole("row").filter({ hasText: "PENDING" }).getByRole("link", { name: APPROVAL_REF })
        .evaluateAll((els) => els.map((a) => ({ refNo: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" })));
      return { ms: timing.ms, value };
    });
    if (stopped()) break;
    await nap(thinkMs(rand));
    if (!pending) continue;

    if (decisions >= maxDecisions || pending.length === 0) {
      const why = pending.length === 0 ? "no unclaimed PENDING request left" : `decision cap (${maxDecisions}) reached`;
      await rec.step("approve or reject", async () => { throw new Skip(why); });
      // Still a person reading: open one request when there is one, then wait longer before looking again.
      if (pending.length) {
        await rec.step("open approval", () => open(page, pending[Math.floor(rand() * pending.length)].href));
      }
      await nap(thinkMs(rand) * 3);
      continue;
    }

    const target = pending[Math.floor(rand() * pending.length)];
    const opened = await rec.step("open approval", () => open(page, target.href));
    if (!opened) continue;
    await nap(thinkMs(rand));
    if (stopped()) break;

    const approve = rand() < 2 / 3;
    const action = approve ? "approve" : "reject";
    const done = await rec.step(action, async () => {
      if (approve) {
        const button = page.getByRole("button", { name: "Approve", exact: true });
        if (!(await button.isVisible().catch(() => false))) throw new Skip(`${target.refNo} no longer offers Approve`);
        rec.phase("approve");
        return confirmAndWait(page, button, new RegExp(`${escapeRe(target.refNo)} approved`));
      }
      const trigger = page.getByRole("button", { name: "Reject…", exact: true });
      if (!(await trigger.isVisible().catch(() => false))) throw new Skip(`${target.refNo} no longer offers Reject`);
      const dialog = page.getByRole("dialog", { name: `Reject ${target.refNo}?` });
      await openDialog(trigger, dialog);
      await dialog.getByLabel("Reason").fill("Load test (Phase 43): not needed");
      rec.phase("reject");
      return confirmAndWait(page, dialog.getByRole("button", { name: "Reject", exact: true }), new RegExp(`${escapeRe(target.refNo)} rejected`));
    });
    if (done) decisions += 1;
    await nap(thinkMs(rand));
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      minutes: { type: "string" },
      out: { type: "string" },
      "max-decisions": { type: "string" },
    },
  });
  let base, minutes, password, maxDecisions;
  try {
    base = parseBase(values.base);
    minutes = parseMinutes(values.minutes);
    if (!values.out) throw new Error("--out <file.json> is required");
    maxDecisions = values["max-decisions"] === undefined ? DEFAULT_MAX_DECISIONS : Number(values["max-decisions"]);
    if (!Number.isInteger(maxDecisions) || maxDecisions < 0) throw new Error("--max-decisions must be a whole number ≥ 0");
    password = requireSeedPassword();
  } catch (err) {
    console.error(err.message);
    console.error("Usage: node scripts/loadtest/writers.mjs --base <url> --minutes <n ≤ 8> --out <file.json> [--max-decisions <n>]");
    process.exit(2);
  }

  const writers = [
    { user: USERS[0], kind: "it", listPage: 1 },
    { user: USERS[1], kind: "it", listPage: 2 },
    { user: USERS[14], kind: "approver" },
  ];
  const actions = [];
  const startedAt = new Date();
  let interrupted = false;
  const stopped = () => stopCtl.signal.aborted;

  // The one browser this script ever starts.
  const browser = await chromium.launch({ headless: true });
  let closeTimer = null;
  const stop = () => {
    if (stopped()) return;
    stopCtl.abort();
    // In-flight steps get a short grace to finish, then the browser goes and everything still waiting fails fast.
    closeTimer = setTimeout(() => browser.close().catch(() => {}), STOP_GRACE_MS);
  };
  process.once("SIGINT", () => {
    interrupted = true;
    console.log("\n[writers] interrupted — stopping and writing what was measured…");
    stop();
  });

  try {
    const sessions = [];
    for (const w of writers) {
      const context = await browser.newContext({ baseURL: base });
      if (w.kind === "approver") await context.addCookies([{ name: "br.dept", value: "it", url: base }]);
      const page = await context.newPage();
      page.setDefaultTimeout(REQUEST_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(REQUEST_TIMEOUT_MS);
      try {
        await signIn(page, w.user, password);
      } catch (err) {
        if (stopped()) throw new Error("interrupted during sign-in — no load was run");
        throw new Error(`${w.user.name} could not sign in through /login: ${String(err?.message ?? err).replaceAll(password, "***").split("\n")[0]}`);
      }
      const rec = recorder({ user: w.user.name, actions, stopped, password });
      rec.attach(page);
      sessions.push({ ...w, page, rec });
      if (stopped()) break; // Ctrl+C (hooked before the sign-ins) during them: no loop starts
    }

    const endAt = Date.now() + minutes * 60_000;
    const deadline = setTimeout(stop, minutes * 60_000);
    const timeLeft = () => endAt - Date.now();
    const progress = setInterval(() => {
      const steps = actions.filter((a) => !a.server);
      const failed = steps.filter((a) => a.ok === false).length;
      console.log(`[writers] ${((Date.now() - startedAt.getTime()) / 60_000).toFixed(1)} min · ${steps.length} steps · ${failed} failed`);
    }, 30_000);

    console.log(`[writers] running ${sessions.length} people in one browser for ${minutes} min (hard stop)…`);
    await Promise.all(
      sessions.map(async (s, i) => {
        await nap(i * 1_500); // a little stagger
        const rand = Math.random;
        if (s.kind === "it") await itLoop({ page: s.page, rec: s.rec, rand, stopped, timeLeft, listPage: s.listPage });
        else await approverLoop({ page: s.page, rec: s.rec, rand, stopped, maxDecisions });
      }).map((p) => p.catch((err) => {
        if (!stopped()) console.error(`[writers] a loop ended early: ${String(err?.message ?? err).replaceAll(password, "***").split("\n")[0]}`);
      })),
    );
    clearTimeout(deadline);
    clearInterval(progress);
    stop();
  } finally {
    if (closeTimer) clearTimeout(closeTimer);
    await browser.close().catch(() => {});
    const out = {
      kind: "writers", base, minutes, users: writers.length, maxDecisions,
      startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), interrupted, actions,
    };
    await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
    await writeFile(values.out, JSON.stringify(out, null, 2) + "\n", "utf8");
    const steps = actions.filter((a) => !a.server);
    console.log(`[writers] done: ${steps.length} steps (${steps.filter((a) => a.ok === false).length} failed, ${steps.filter((a) => a.skipped).length} skipped) → ${values.out}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[writers] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
