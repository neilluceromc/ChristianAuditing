import { describe, expect, it } from "vitest";
import { cameraX, DWELL_MS, dayPct, fmtClock, SCENES, travelSeconds } from "./scenes";

describe("SCENES", () => {
  it("runs the six scenes in day-log order", () => {
    expect(SCENES.map((s) => fmtClock(s.minute))).toEqual(["08:40", "09:55", "11:20", "13:45", "15:30", "17:05"]);
    expect(SCENES.map((s) => s.id)).toEqual(["scan", "missing", "stamp", "short", "dep", "off"]);
  });
  it("has the spec's copy for the depreciation scene", () => {
    expect(SCENES[4].line).toBe("Month 7 of 36. Book value ₱58,000.");
  });
  it("has six stations, each with a dwell of 6.2 s", () => {
    expect(DWELL_MS).toBe(6200);
    expect(SCENES.map((s) => s.sayAt)).toEqual([2500, 2200, 2600, 2400, 2600, 2500]);
  });
});

describe("travelSeconds", () => {
  it("takes no time to start or to stay put", () => {
    expect(travelSeconds(null, 560)).toBe(0);
    expect(travelSeconds(560, 560)).toBe(0);
  });
  it("is clamped between 1.3 s and 2.4 s", () => {
    expect(travelSeconds(560, 1000)).toBe(1.3);
    expect(travelSeconds(560, 3370)).toBe(2.4);
    expect(travelSeconds(1000, 2850)).toBeCloseTo(1850 / 1100);
  });
});

describe("fmtClock and dayPct", () => {
  it("wraps past midnight", () => expect(fmtClock(1025 + 1440)).toBe("17:05"));
  it("runs the day log from 08:00 to 18:00", () => {
    expect(dayPct(480)).toBe(0);
    expect(dayPct(1080)).toBe(100);
  });
});

describe("cameraX", () => {
  it("centres the focus in the visible part of the room", () => expect(cameraX(700, 1, 960, 1440)).toBe(-220));
  it("never shows past the left end", () => expect(cameraX(0, 1, 960, 1440)).toBe(0));
  it("never shows past the right end", () => expect(cameraX(3900, 1, 960, 1440)).toBe(1440 - 3960));
});
