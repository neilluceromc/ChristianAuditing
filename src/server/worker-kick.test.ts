import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Cloud staging (spec §4.3): an enqueued job is worked right after the response on Vercel, and nowhere else. */

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/worker/run", () => ({ runTicks: vi.fn(async () => ({ done: 0, budgetHit: false })) }));

type Mods = {
  after: typeof import("next/server").after;
  runTicks: typeof import("@/worker/run").runTicks;
  kickWorker: typeof import("./worker-kick").kickWorker;
  setTicking: typeof import("../lib/worker-state").setTicking;
};
let m: Mods;

// A fresh module graph per test: worker-kick's "scheduled" flag is module state, and `after` is mocked, so a kick
// registered in one test never runs its callback to clear it.
beforeEach(async () => {
  vi.resetModules();
  m = {
    after: (await import("next/server")).after,
    runTicks: (await import("@/worker/run")).runTicks,
    kickWorker: (await import("./worker-kick")).kickWorker,
    setTicking: (await import("../lib/worker-state")).setTicking,
  };
  // The mock factories' spies outlive resetModules; clear their calls and implementations.
  vi.mocked(m.after).mockReset();
  vi.mocked(m.runTicks).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("kickWorker", () => {
  it("With no VERCEL, after is not called", () => {
    vi.stubEnv("VERCEL", undefined);
    m.kickWorker();
    expect(m.after).not.toHaveBeenCalled();
  });

  it("With VERCEL=1, after is called once", () => {
    vi.stubEnv("VERCEL", "1");
    m.kickWorker();
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it("the deferred callback runs one budgeted tick under a kick- worker id", async () => {
    vi.stubEnv("VERCEL", "1");
    m.kickWorker();
    const callback = vi.mocked(m.after).mock.calls[0][0] as () => Promise<void>;
    await callback();
    expect(m.runTicks).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(m.runTicks).mock.calls[0][0];
    expect(opts.budgetMs).toBe(45_000);
    expect(opts.workerId).toMatch(/^kick-.+/);
  });

  it("With VERCEL=1 and after throwing, nothing escapes", () => {
    vi.stubEnv("VERCEL", "1");
    vi.mocked(m.after).mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    expect(() => m.kickWorker()).not.toThrow();
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it("a kick that threw does not count as scheduled: the next one still registers", () => {
    vi.stubEnv("VERCEL", "1");
    vi.mocked(m.after).mockImplementationOnce(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    m.kickWorker();
    m.kickWorker();
    expect(m.after).toHaveBeenCalledTimes(2);
  });

  it("With ticking set, after is not called", () => {
    vi.stubEnv("VERCEL", "1");
    m.setTicking(true);
    m.kickWorker();
    expect(m.after).not.toHaveBeenCalled();
  });

  it("two kickWorker() calls in a row with VERCEL=1 register only one after()", () => {
    vi.stubEnv("VERCEL", "1");
    m.kickWorker();
    m.kickWorker();
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it("once the scheduled callback has started, the next kick registers again", async () => {
    vi.stubEnv("VERCEL", "1");
    m.kickWorker();
    const callback = vi.mocked(m.after).mock.calls[0][0] as () => Promise<void>;
    await callback();
    m.kickWorker();
    expect(m.after).toHaveBeenCalledTimes(2);
  });
});
