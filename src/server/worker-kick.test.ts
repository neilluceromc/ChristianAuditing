import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Cloud staging (spec §4.3): an enqueued job is worked right after the response on Vercel, and nowhere else. */

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/worker/run", () => ({ runTicks: vi.fn(async () => ({ done: 0, budgetHit: false })) }));

import { after } from "next/server";
import { runTicks } from "@/worker/run";
import { kickWorker } from "./worker-kick";
import { setTicking } from "../lib/worker-state";

beforeEach(() => {
  vi.mocked(after).mockReset();
  vi.mocked(runTicks).mockClear();
  setTicking(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setTicking(false);
});

describe("kickWorker", () => {
  it("With no VERCEL, after is not called", () => {
    vi.stubEnv("VERCEL", undefined);
    kickWorker();
    expect(after).not.toHaveBeenCalled();
  });

  it("With VERCEL=1, after is called once", () => {
    vi.stubEnv("VERCEL", "1");
    kickWorker();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("the deferred callback runs one budgeted tick under a kick- worker id", async () => {
    vi.stubEnv("VERCEL", "1");
    kickWorker();
    const callback = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await callback();
    expect(runTicks).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(runTicks).mock.calls[0][0];
    expect(opts.budgetMs).toBe(45_000);
    expect(opts.workerId).toMatch(/^kick-.+/);
  });

  it("With VERCEL=1 and after throwing, nothing escapes", () => {
    vi.stubEnv("VERCEL", "1");
    vi.mocked(after).mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    expect(() => kickWorker()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("With ticking set, after is not called", () => {
    vi.stubEnv("VERCEL", "1");
    setTicking(true);
    kickWorker();
    expect(after).not.toHaveBeenCalled();
  });
});
