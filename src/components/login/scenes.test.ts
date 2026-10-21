import { describe, expect, it } from "vitest";
import {
  BLOB_FOCUS,
  BLOB_SHAPES,
  DWELL_MS,
  SCENES,
  blobDrop,
  focusOffset,
  moodAt,
  propSide,
  travelSeconds,
} from "./scenes";

describe("SCENES", () => {
  it("runs the six scenes of the day in order", () => {
    expect(SCENES.map((s) => s.id)).toEqual(["scan", "missing", "stamp", "short", "dep", "off"]);
  });
  it("keeps the spec's copy, purchase orders included", () => {
    expect(SCENES[2]!.task).toBe("Approving a purchase order");
    expect(SCENES[2]!.line).toBe("PO-1042 approved. Five headsets for the new hires.");
    expect(SCENES[4]!.line).toBe("Month 7 of 36. Book value ₱58,000.");
  });
  it("has a station and a prop per scene, and a dwell of 6.2 s", () => {
    expect(DWELL_MS).toBe(6200);
    expect(SCENES.map((s) => s.prop)).toEqual(["laptop", null, "paper", null, "paper", "laptop"]);
    expect(SCENES.map((s) => s.station)).toEqual([[60, -6], [-45, -12], [0, 0], [125, 6], [70, -26], [-30, 6]]);
  });
});

describe("travelSeconds", () => {
  it("takes no time to start or to stay put", () => {
    expect(travelSeconds(null, [60, -6])).toBe(0);
    expect(travelSeconds([60, -6], [60, -6])).toBe(0);
  });
  it("runs at 70 units a second, clamped between 1.3 s and 2.4 s", () => {
    expect(travelSeconds([0, 0], [10, 0])).toBe(1.3);
    expect(travelSeconds([-45, -12], [125, 6])).toBe(2.4);
    expect(travelSeconds([0, 0], [140, 0])).toBe(2);
  });
});

describe("moodAt", () => {
  it("plays each mood from its start", () => {
    expect(moodAt(SCENES[0]!, 0)).toBe("search");
    expect(moodAt(SCENES[0]!, 2499)).toBe("search");
    expect(moodAt(SCENES[0]!, 2500)).toBe("talk");
    expect(moodAt(SCENES[1]!, 9000)).toBe("look");
  });
});

describe("focusOffset and propSide", () => {
  it("moves Cris toward the card, less on narrower screens, right of centre on a phone", () => {
    expect(focusOffset(1440)).toBe(120);
    expect(focusOffset(900)).toBe(45);
    expect(focusOffset(375)).toBe(95);
  });
  it("puts a prop on her side nearer the middle of the stage", () => {
    expect(propSide([0, 0])).toBe(1);
    expect(propSide([125, 6])).toBe(-1);
  });
});

describe("blobDrop", () => {
  it("holds the first shape at the start", () => {
    const d = blobDrop(0, 0, 0, 120);
    const [x, y, r] = BLOB_SHAPES[0]![0]!;
    expect(Math.abs(d.x - x)).toBeLessThanOrEqual(4);
    expect(Math.abs(d.y - y)).toBeLessThanOrEqual(4);
    expect(Math.abs(d.r - r)).toBeLessThanOrEqual(r * 0.04 + 1e-9);
  });
  it("has melted into the next shape after hold and morph (5.4 s)", () => {
    const d = blobDrop(1, 5.4, 0, 120);
    const [x, y] = BLOB_SHAPES[1]![1]!;
    expect(Math.abs(d.x - x)).toBeLessThanOrEqual(4);
    expect(Math.abs(d.y - y)).toBeLessThanOrEqual(4);
  });
  it("is the focus blob moved toward the card in focus mode", () => {
    const d = blobDrop(0, 0, 1, 120);
    const [x, y] = BLOB_FOCUS[0]!;
    expect(Math.abs(d.x - (x + 120))).toBeLessThanOrEqual(4);
    expect(Math.abs(d.y - y)).toBeLessThanOrEqual(4);
  });
  it("has nine drops in every shape", () => {
    for (const s of BLOB_SHAPES) expect(s).toHaveLength(9);
    expect(BLOB_FOCUS).toHaveLength(9);
  });
});
