import { describe, expect, it } from "vitest";
import { moodFor, resolveColor, type MoodState } from "./cris-mood";

const ready: MoodState = { open: true, busy: null, typing: false, waiting: false, outcome: null, unread: 0 };
const at = (s: Partial<MoodState>) => moodFor({ ...ready, ...s });

describe("resolveColor (spec §5)", () => {
  it("Match theme is Sky blue in light mode and Silver in dark", () => {
    expect(resolveColor("auto", "light")).toBe("sky");
    expect(resolveColor("auto", "dark")).toBe("silver");
  });
  it("a chosen colour stays the same in both themes", () => {
    for (const c of ["gold", "sky", "silver"] as const) {
      expect(resolveColor(c, "light")).toBe(c);
      expect(resolveColor(c, "dark")).toBe(c);
    }
  });
});

describe("moodFor (spec §5 moods table)", () => {
  it("Ready is idle", () => {
    expect(at({})).toBe("idle");
  });
  it("running read tools is searching", () => {
    expect(at({ busy: "tools" })).toBe("search");
  });
  it("waiting for the model is thinking", () => {
    expect(at({ busy: "model" })).toBe("think");
  });
  it("reply text typing out is talking", () => {
    expect(at({ typing: true })).toBe("talk");
  });
  it("waiting for a pick, scan or Confirm is looking", () => {
    expect(at({ waiting: true })).toBe("look");
  });
  it("an error is frustrated", () => {
    expect(at({ outcome: "error" })).toBe("cross");
  });
  it("nothing found, refused, or after Undo is sad", () => {
    expect(at({ outcome: "undone" })).toBe("sad");
    expect(at({ outcome: "empty" })).toBe("sad");
    expect(at({ outcome: "refused" })).toBe("sad");
  });
  it("a new turn in flight beats the last outcome", () => {
    expect(at({ outcome: "error", busy: "model" })).toBe("think");
    expect(at({ outcome: "empty", typing: true })).toBe("talk");
  });
  it("closed with an unread reply is talking", () => {
    expect(at({ open: false, unread: 2 })).toBe("talk");
  });
  it("closed with nothing unread is idle, whatever else is going on", () => {
    expect(at({ open: false })).toBe("idle");
    expect(at({ open: false, outcome: "error" })).toBe("idle");
    expect(at({ open: false, busy: "tools" })).toBe("idle");
  });
});
