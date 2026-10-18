// Phase 43 (spec §4): what the reader and writer scripts share — argument checks, the seed password, think time,
// a per-user cookie jar, and the laptop-safety limits. Plain Node ESM, no dependencies.

/** Laptop safety (spec §4, plan Review Focus #2). */
export const MAX_MINUTES = 8;
export const MAX_USERS = 15;
export const REQUEST_TIMEOUT_MS = 30_000;
export const THINK_MIN_MS = 2_000;
export const THINK_MAX_MS = 6_000;

/**
 * The test accounts' password, read from the environment only. There is deliberately no fallback literal: a load
 * test against staging must use staging's seed password, and the value is never printed or written anywhere.
 */
export function requireSeedPassword(env = process.env) {
  const value = env.SEED_PASSWORD;
  if (!value) {
    throw new Error(
      "SEED_PASSWORD is not set. Set it in this shell to the seed password of the target's test accounts " +
        "(perf01–perf15) and run again. It is read from the environment only and never printed.",
    );
  }
  return value;
}

/** `--base`: an http(s) URL; only its origin is kept. */
export function parseBase(raw) {
  let url;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new Error(`--base must be an http(s) URL such as http://192.168.1.193:3000 (got ${JSON.stringify(raw ?? "")})`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`--base must be an http(s) URL such as http://192.168.1.193:3000 (got ${JSON.stringify(raw)})`);
  }
  return url.origin;
}

/** `--minutes`: default 6, more than 0, at most MAX_MINUTES. */
export function parseMinutes(raw) {
  if (raw === undefined) return 6;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) {
    throw new Error(`--minutes must be a number above 0 and at most ${MAX_MINUTES} (got ${JSON.stringify(raw)})`);
  }
  return minutes;
}

/** A person's pause between two clicks: 2–6 s. */
export function thinkMs(rand = Math.random) {
  return Math.round(THINK_MIN_MS + rand() * (THINK_MAX_MS - THINK_MIN_MS));
}

/** Waits `ms`, or less when `signal` aborts first (the hard stop). Never rejects. */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** `perf03@thebackroomop.com` → `perf03`: the only name the output files carry. */
export const shortName = (email) => email.split("@")[0];

/**
 * One virtual person's cookies: everything the server sets is sent back (the CSRF cookie, the session cookie), plus
 * the cookies the harness sets itself (`br.dept`). Paths and domains are ignored — the harness talks to one origin.
 */
export class CookieJar {
  #cookies = new Map();

  /** Reads every Set-Cookie of a fetch Response's headers; a cookie the server expires is dropped. */
  store(headers) {
    for (const line of headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => {
        const [k, v = ""] = a.split("=");
        const key = k.trim().toLowerCase();
        if (key === "max-age") return Number(v.trim()) <= 0;
        if (key === "expires") return Date.parse(v.trim()) <= Date.now();
        return false;
      });
      if (expired) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  set(name, value) {
    this.#cookies.set(name, value);
  }

  has(pattern) {
    return [...this.#cookies.keys()].some((name) => pattern.test(name));
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/**
 * The writers' server-action timing. Each server-action POST is tagged with its step's label and id when the request
 * STARTS (fix round 1: a label read at finish time is gone once the step has ended), and recorded when it finishes:
 * { action: "server action · <label>", ms, ok, server: true }, ms being the response end (or, without one, the first
 * byte) relative to the request's start.
 *
 * Fix round 2:
 * - `settle(step, ms)` waits (bounded) until the step's server actions have finished or failed, so the writer does not
 *   navigate away while a revalidated RSC response is still streaming;
 * - a request that fails with net::ERR_ABORTED is an error only when its step failed. When the step succeeded it is
 *   recorded as { ok: true, aborted: true, note: "aborted-after-success" }, which the report keeps out of the
 *   timings and the errors. Its outcome is held back until `endStep` says how the step went. Any other network
 *   failure is always an error.
 */
export function serverActionTracker({ user, actions, stopped }) {
  const tags = new WeakMap(); // request → { label, step }
  const inflight = new Map(); // step → Set<request>
  const waiters = new Map(); // step → [resolve]
  const outcomes = new Map(); // step → ok
  const heldBack = new Map(); // step → aborted rows waiting for the step's outcome
  const isServerAction = (req) => req.method() === "POST" && Boolean(req.headers()["next-action"]);

  function take(req) {
    const tag = tags.get(req);
    tags.delete(req);
    return tag;
  }
  function done(req, step) {
    const set = inflight.get(step);
    if (!set) return;
    set.delete(req);
    if (set.size > 0) return;
    inflight.delete(step);
    for (const resolve of waiters.get(step) ?? []) resolve();
    waiters.delete(step);
  }
  /**
   * An abort, once its step's outcome is known: true → aborted-after-success (with the server's first byte when the
   * browser had one, fix round 3); "stopped" → aborted-at-stop, the hard stop cut the step short, so it is neither a
   * success nor an error (fix round 3); false → an error.
   */
  function classify(row, outcome) {
    const { firstByteMs, ...rest } = row;
    if (outcome === true) {
      const aborted = { user: rest.user, action: rest.action, ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success" };
      actions.push(firstByteMs === undefined ? aborted : { ...aborted, firstByteMs });
    } else if (outcome === "stopped") {
      actions.push({ user: rest.user, action: rest.action, ms: 0, ok: true, server: true, aborted: true, note: "aborted-at-stop" });
    } else {
      actions.push({ ...rest, ok: false });
    }
  }

  return {
    /** page.on("request"): `label`/`step` name the step running now, or null outside a step. */
    request(req, label, step) {
      if (!label || step == null || !isServerAction(req)) return;
      tags.set(req, { label, step });
      if (!inflight.has(step)) inflight.set(step, new Set());
      inflight.get(step).add(req);
    },
    /** page.on("requestfinished") */
    async finished(req) {
      const tag = take(req);
      if (!tag) return;
      try {
        const timing = req.timing();
        const ms = timing.responseEnd >= 0 ? timing.responseEnd : timing.responseStart;
        const res = await req.response().catch(() => null);
        if (ms >= 0) {
          actions.push({ user, action: `server action · ${tag.label}`, ms: Math.round(ms), ok: !!res && res.status() < 400, server: true });
        }
      } finally {
        done(req, tag.step);
      }
    },
    /** page.on("requestfailed"): a request torn down by the hard stop is not a measurement. */
    failed(req) {
      const tag = take(req);
      if (!tag) return;
      done(req, tag.step);
      if (stopped()) return;
      const errorText = req.failure()?.errorText ?? "failed";
      const row = { user, action: `server action · ${tag.label}`, ms: 0, ok: false, server: true, error: errorText };
      if (!/ERR_ABORTED/.test(errorText)) return void actions.push(row);
      // Fix round 3: the server's first byte, when the browser got that far before the response was cut off.
      const firstByte = (() => {
        try {
          return req.timing().responseStart;
        } catch {
          return -1;
        }
      })();
      if (firstByte >= 0) row.firstByteMs = Math.round(firstByte);
      if (outcomes.has(tag.step)) return classify(row, outcomes.get(tag.step));
      if (!heldBack.has(tag.step)) heldBack.set(tag.step, []);
      heldBack.get(tag.step).push(row);
    },
    /** Resolves once the step has no server action in flight, or after `timeoutMs`. Never rejects. */
    settle(step, timeoutMs) {
      if (!inflight.has(step)) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        const list = waiters.get(step) ?? [];
        list.push(() => { clearTimeout(timer); resolve(); });
        waiters.set(step, list);
      });
    },
    /**
     * How the step went (true, false, or "stopped" when the hard stop cut it short): releases its held-back aborted
     * rows, and classifies any abort that arrives later.
     */
    endStep(step, ok) {
      outcomes.set(step, ok);
      for (const row of heldBack.get(step) ?? []) classify(row, ok);
      heldBack.delete(step);
    },
  };
}
