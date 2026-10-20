import { beforeEach, describe, expect, it, vi } from "vitest";

type State = typeof import("./worker-state");
let s: State;

beforeEach(async () => {
  vi.resetModules();
  s = await import("./worker-state");
});

describe("worker-state", () => {
  it("is not ticking until a run starts, and not after it ends", () => {
    expect(s.isTicking()).toBe(false);
    s.setTicking(true);
    expect(s.isTicking()).toBe(true);
    s.setTicking(false);
    expect(s.isTicking()).toBe(false);
  });

  it("stays ticking when the first of two overlapping runs ends", () => {
    s.setTicking(true); // run A starts
    s.setTicking(true); // run B starts while A is still going
    s.setTicking(false); // A ends
    expect(s.isTicking()).toBe(true);
    s.setTicking(false); // B ends
    expect(s.isTicking()).toBe(false);
  });

  it("never goes below zero", () => {
    s.setTicking(false);
    s.setTicking(false);
    expect(s.isTicking()).toBe(false);
    s.setTicking(true);
    expect(s.isTicking()).toBe(true);
    s.setTicking(false);
    expect(s.isTicking()).toBe(false);
  });
});
