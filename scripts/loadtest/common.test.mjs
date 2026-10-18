import { describe, expect, it } from "vitest";
import {
  CookieJar, MAX_MINUTES, parseBase, parseMinutes, requireSeedPassword, serverActionTracker, thinkMs,
} from "./common.mjs";

describe("requireSeedPassword", () => {
  it("returns SEED_PASSWORD when set", () => {
    expect(requireSeedPassword({ SEED_PASSWORD: "s3cret" })).toBe("s3cret");
  });

  it("refuses with a clear message when unset or empty, and never falls back to a literal", () => {
    for (const env of [{}, { SEED_PASSWORD: "" }]) {
      expect(() => requireSeedPassword(env)).toThrow(/SEED_PASSWORD is not set/);
    }
  });
});

describe("parseBase", () => {
  it("keeps the origin of an http(s) URL", () => {
    expect(parseBase("http://192.168.1.193:3000/")).toBe("http://192.168.1.193:3000");
    expect(parseBase("https://staging.example.test")).toBe("https://staging.example.test");
  });

  it("refuses a missing or non-http value", () => {
    expect(() => parseBase(undefined)).toThrow(/--base/);
    expect(() => parseBase("ftp://host")).toThrow(/--base/);
    expect(() => parseBase("not a url")).toThrow(/--base/);
  });
});

describe("parseMinutes (laptop safety: a full run is 8 minutes at most)", () => {
  it("defaults to 6 and accepts up to the cap", () => {
    expect(parseMinutes(undefined)).toBe(6);
    expect(parseMinutes("0.5")).toBe(0.5);
    expect(parseMinutes(String(MAX_MINUTES))).toBe(MAX_MINUTES);
  });

  it("refuses zero, negatives, garbage and anything over the cap", () => {
    for (const raw of ["0", "-1", "abc", String(MAX_MINUTES + 1)]) expect(() => parseMinutes(raw)).toThrow(/--minutes/);
  });
});

describe("thinkMs", () => {
  it("is 2–6 s", () => {
    expect(thinkMs(() => 0)).toBe(2000);
    expect(thinkMs(() => 0.5)).toBe(4000);
    expect(thinkMs(() => 0.999999)).toBeLessThanOrEqual(6000);
  });
});

describe("serverActionTracker", () => {
  /** A stand-in for a Playwright Request. */
  function fakeRequest({
    method = "POST", action = true, responseEnd = 250, responseStart = 200, status = 200, errorText = "net::ERR_ABORTED",
  } = {}) {
    return {
      method: () => method,
      headers: () => (action ? { "next-action": "abc123", accept: "text/x-component" } : { accept: "text/html" }),
      timing: () => ({ startTime: 0, responseStart, responseEnd }),
      response: async () => ({ status: () => status }),
      failure: () => ({ errorText }),
    };
  }
  function setup(stopped = false) {
    const actions = [];
    const tracker = serverActionTracker({ user: "perf01", actions, stopped: () => stopped });
    return { actions, tracker };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---- fix round 1: the label is taken when the POST starts ----

  it("keeps the step's label even when the response finishes after the step has ended", async () => {
    const { actions, tracker } = setup();
    const req = fakeRequest({ responseEnd: 812.4 });
    tracker.request(req, "assign", 1);
    tracker.endStep(1, true);
    await tracker.finished(req);
    expect(actions).toEqual([{ user: "perf01", action: "server action · assign", ms: 812, ok: true, server: true }]);
  });

  it("ignores page GETs, and POSTs made outside a step", async () => {
    const { actions, tracker } = setup();
    const get = fakeRequest({ method: "GET", action: false });
    tracker.request(get, "assign", 1);
    await tracker.finished(get);
    const stray = fakeRequest();
    tracker.request(stray, null, null);
    await tracker.finished(stray);
    expect(actions).toEqual([]);
  });

  it("records an HTTP error status as not ok", async () => {
    const { actions, tracker } = setup();
    const bad = fakeRequest({ status: 500 });
    tracker.request(bad, "return", 1);
    await tracker.finished(bad);
    expect(actions).toEqual([{ user: "perf01", action: "server action · return", ms: 250, ok: false, server: true }]);
  });

  it("falls back to the first byte when the last byte's time is unavailable, and records nothing after the hard stop", async () => {
    const { actions, tracker } = setup();
    const partial = fakeRequest({ responseEnd: -1, responseStart: 300 });
    tracker.request(partial, "approve", 1);
    await tracker.finished(partial);
    expect(actions[0]).toMatchObject({ action: "server action · approve", ms: 300, ok: true });

    const late = setup(true);
    const req = fakeRequest();
    late.tracker.request(req, "approve", 1);
    late.tracker.failed(req);
    late.tracker.endStep(1, false);
    expect(late.actions).toEqual([]);
  });

  // ---- fix round 2: settle before the step ends; an abort after a successful step is not an error ----

  it("settle waits for the step's in-flight server action to finish", async () => {
    const { actions, tracker } = setup();
    const req = fakeRequest();
    tracker.request(req, "assign", 7);
    let settled = false;
    const waiting = tracker.settle(7, 10_000).then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);
    await tracker.finished(req);
    await waiting;
    expect(settled).toBe(true);
    expect(actions).toHaveLength(1);
  });

  it("settle resolves at once with nothing in flight, and gives up after its bound", async () => {
    const { tracker } = setup();
    await tracker.settle(1, 10_000);
    tracker.request(fakeRequest(), "assign", 2);
    const started = Date.now();
    await tracker.settle(2, 30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("an abort of a successful step's request is recorded as aborted-after-success, not an error (abort first)", async () => {
    const { actions, tracker } = setup();
    const req = fakeRequest();
    tracker.request(req, "triage", 3);
    tracker.failed(req); // the outcome is not known yet: held back
    expect(actions).toEqual([]);
    tracker.endStep(3, true);
    expect(actions).toEqual([
      { user: "perf01", action: "server action · triage", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success" },
    ]);
  });

  it("an abort after the successful step has ended is aborted-after-success too (step first)", () => {
    const { actions, tracker } = setup();
    const req = fakeRequest();
    tracker.request(req, "approve", 4);
    tracker.endStep(4, true);
    tracker.failed(req);
    expect(actions).toEqual([
      { user: "perf01", action: "server action · approve", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success" },
    ]);
  });

  it("an abort of a failed step's request is an error", () => {
    const { actions, tracker } = setup();
    const req = fakeRequest();
    tracker.request(req, "assign", 5);
    tracker.failed(req);
    tracker.endStep(5, false);
    expect(actions).toEqual([
      { user: "perf01", action: "server action · assign", ms: 0, ok: false, server: true, error: "net::ERR_ABORTED" },
    ]);
  });

  it("a failure that is not an abort is an error even when the step succeeded", () => {
    const { actions, tracker } = setup();
    const req = fakeRequest({ errorText: "net::ERR_CONNECTION_RESET" });
    tracker.request(req, "return", 6);
    tracker.endStep(6, true);
    tracker.failed(req);
    expect(actions).toEqual([
      { user: "perf01", action: "server action · return", ms: 0, ok: false, server: true, error: "net::ERR_CONNECTION_RESET" },
    ]);
  });
});

describe("CookieJar", () => {
  const headers = (...cookies) => ({ getSetCookie: () => cookies });

  it("keeps cookies from Set-Cookie and sends them back as one header", () => {
    const jar = new CookieJar();
    jar.store(headers("authjs.csrf-token=abc%7Cdef; Path=/; HttpOnly; SameSite=Lax", "authjs.callback-url=http%3A%2F%2Fh; Path=/"));
    jar.set("br.dept", "it");
    expect(jar.header()).toBe("authjs.csrf-token=abc%7Cdef; authjs.callback-url=http%3A%2F%2Fh; br.dept=it");
    expect(jar.has(/session-token/)).toBe(false);
  });

  it("replaces a cookie by name and drops one the server expires", () => {
    const jar = new CookieJar();
    jar.store(headers("a=1; Path=/", "authjs.session-token=t1; Path=/; HttpOnly"));
    expect(jar.has(/session-token/)).toBe(true);
    jar.store(headers("a=2; Path=/"));
    jar.store(headers("authjs.session-token=; Path=/; Max-Age=0"));
    expect(jar.header()).toBe("a=2");
    jar.store(headers("a=gone; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"));
    expect(jar.header()).toBe("");
  });
});
