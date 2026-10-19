import { describe, expect, it } from "vitest";
import { cameraX, clockAt, DWELL_MS, dayPct, fmtClock, roomBubble, SCENES, travelSeconds } from "./scenes";

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

describe("clockAt", () => {
  it("counts from the old time to the new one, easing in and out", () => {
    expect(clockAt(520, 595, 0)).toBe(520);
    expect(clockAt(520, 595, 0.5)).toBe(557.5);
    expect(clockAt(520, 595, 0.25)).toBeLessThan(520 + 75 / 4);
    expect(clockAt(520, 595, 1)).toBe(595);
  });
  it("runs forward past midnight on the loop", () => {
    expect(fmtClock(clockAt(1025, 520, 0.5))).toBe("00:53");
    expect(fmtClock(clockAt(1025, 520, 1))).toBe("08:40");
  });
  it("holds the ends outside 0 to 1", () => {
    expect(clockAt(520, 595, -1)).toBe(520);
    expect(clockAt(520, 595, 2)).toBe(595);
  });
});

describe("roomBubble", () => {
  it("sits at the anchor in screen space, tail near its left end", () => {
    expect(roomBubble({ anchor: [968, 226], align: "left", tx: -100, scale: 0.5, right: 800, width: 200 })).toEqual({
      left: 384,
      top: 113,
      tail: 26,
    });
  });
  it("keeps a right-aligned bubble inside the room's left edge and below the top", () => {
    expect(roomBubble({ anchor: [604, 226], align: "right", tx: 0, scale: 0.25, right: 400, width: 240 })).toEqual({
      left: 252,
      top: 70,
      tail: 99,
    });
  });
  it("never runs under the card, tail still on the bubble", () => {
    expect(roomBubble({ anchor: [2068, 238], align: "left", tx: -1000, scale: 1, right: 1100, width: 300 })).toEqual({
      left: 788,
      top: 238,
      tail: 274,
    });
  });
});
