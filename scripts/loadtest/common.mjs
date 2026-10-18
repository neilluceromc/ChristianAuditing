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
