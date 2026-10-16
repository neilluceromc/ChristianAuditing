import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_TOAST_MS, TOAST_MS, createPausableTimer, toastLifetime } from "./toast-timing";

describe("toastLifetime", () => {
  it("success and neutral toasts leave after 4 s", () => {
    expect(toastLifetime("settled")).toBe(4000);
    expect(toastLifetime("neutral")).toBe(TOAST_MS);
  });
  it("a toast with a button stays 8 s so the button can be reached", () => {
    expect(toastLifetime("settled", true)).toBe(ACTION_TOAST_MS);
    expect(toastLifetime("neutral", true)).toBe(8000);
  });
  it("an error stays until dismissed, button or not", () => {
    expect(toastLifetime("fault")).toBeNull();
    expect(toastLifetime("fault", true)).toBeNull();
  });
});

describe("createPausableTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once when the lifetime runs out", () => {
    const done = vi.fn();
    createPausableTimer(4000, done);
    vi.advanceTimersByTime(3999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("does not run down while paused, and resumes with what was left", () => {
    const done = vi.fn();
    const t = createPausableTimer(4000, done);
    vi.advanceTimersByTime(1500);
    t.pause();
    expect(t.remaining()).toBe(2500);
    vi.advanceTimersByTime(60_000);
    expect(done).not.toHaveBeenCalled();
    t.resume();
    vi.advanceTimersByTime(2499);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("pausing twice or resuming twice changes nothing", () => {
    const done = vi.fn();
    const t = createPausableTimer(1000, done);
    vi.advanceTimersByTime(400);
    t.pause();
    t.pause();
    expect(t.remaining()).toBe(600);
    t.resume();
    t.resume();
    vi.advanceTimersByTime(600);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("cancel stops it for good, even after a resume", () => {
    const done = vi.fn();
    const t = createPausableTimer(1000, done);
    t.cancel();
    t.resume();
    vi.advanceTimersByTime(5000);
    expect(done).not.toHaveBeenCalled();
  });
});
