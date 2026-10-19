import { describe, expect, it } from "vitest";
import { bubbleMaxWidth, cardShift, centredCardLeft, focusBubble, focusPoint, roomPoint, type FocusLayout } from "./focus-layout";

// A 1440 × 900 desktop: the 392 px card sits at right: max(32px, 5vw) = 72 px, so its left edge is at 976.
const desktop: FocusLayout = {
  narrow: false,
  heroWidth: 1440,
  heroHeight: 900,
  cardWidth: 392,
  cardLeft: 976,
  scene: { left: 0, top: 0, width: 1440, height: 900 },
};
// Just above the breakpoint: the centred card's left edge is at 284.
const smallDesktop: FocusLayout = {
  ...desktop,
  heroWidth: 960,
  heroHeight: 700,
  cardLeft: 960 - 72 - 392,
  scene: { left: 0, top: 0, width: 960, height: 700 },
};
// A 390 px phone: the banner is clamp(260px, 62vw, 360px) = 260 px tall, full-bleed at the top.
const phone: FocusLayout = {
  narrow: true,
  heroWidth: 390,
  heroHeight: 1400,
  cardWidth: 358,
  cardLeft: 16,
  scene: { left: 0, top: 0, width: 390, height: 260 },
};

describe("centredCardLeft and cardShift", () => {
  it("centres the card in the hero on desktop", () => {
    expect(centredCardLeft(desktop)).toBe(524);
    expect(cardShift(desktop)).toBe(524 - 976);
  });
  it("leaves the card where it is on narrow screens", () => {
    expect(cardShift(phone)).toBe(0);
  });
});

describe("focusPoint", () => {
  it("puts Cris 170 px left of the centred card at 54% of the hero height, scale 1.3 (desktop)", () => {
    expect(focusPoint(desktop)).toEqual({ x: 354, y: 486, scale: 1.3 });
  });
  it("keeps Cris at least 154 px from the left edge", () => {
    expect(focusPoint(smallDesktop)).toEqual({ x: 154, y: 378, scale: 1.3 });
  });
  it("puts Cris at 28% across and halfway down the banner, scaled to its height (narrow)", () => {
    const p = focusPoint(phone);
    expect(p.x).toBeCloseTo(109.2);
    expect(p.y).toBe(130);
    expect(p.scale).toBeCloseTo(260 / 280);
  });
  it("never grows Cris past full size on a tall banner", () => {
    expect(focusPoint({ ...phone, heroWidth: 600, scene: { left: 0, top: 0, width: 600, height: 360 } }).scale).toBe(1);
  });
  it("is measured from the banner's position in the hero", () => {
    const p = focusPoint({ ...phone, scene: { left: 0, top: 40, width: 390, height: 260 } });
    expect(p.y).toBe(170);
  });
});

describe("roomPoint", () => {
  it("moves the room Cris's scene point into hero pixels", () => {
    const l = { ...phone, scene: { left: 0, top: 40, width: 390, height: 260 } };
    expect(roomPoint({ x: 100, y: 120, scale: 0.4 }, l)).toEqual({ x: 100, y: 160, scale: 0.4 });
  });
});

describe("bubbleMaxWidth", () => {
  it("is at most 300 and stays 36 px short of the centred card (desktop)", () => {
    expect(bubbleMaxWidth(focusPoint(desktop), desktop)).toBe(300);
    expect(bubbleMaxWidth(focusPoint(smallDesktop), smallDesktop)).toBe(248);
  });
  it("is never under 180 on desktop", () => {
    const tight = { ...smallDesktop, heroWidth: 700, cardLeft: 236 };
    expect(bubbleMaxWidth(focusPoint(tight), tight)).toBe(180);
  });
  it("fills the room to Cris's right, 12 px from the edge, at least 140 (narrow)", () => {
    const p = focusPoint(phone);
    expect(bubbleMaxWidth(p, phone)).toBeCloseTo(390 - (p.x + 100 * p.scale + 14) - 12);
    const tiny = { ...phone, heroWidth: 320, scene: { left: 0, top: 0, width: 320, height: 260 } };
    expect(bubbleMaxWidth(focusPoint(tiny), tiny)).toBe(140);
  });
});

describe("focusBubble", () => {
  it("sits above Cris, its bottom 10 px over Cris's top, tail pointing at Cris (desktop)", () => {
    const b = focusBubble(focusPoint(desktop), desktop, 240);
    // left = min(354 − 0.35·240, 524 − 24 − 240) = min(270, 260)
    expect(b).toEqual({ left: 260, top: 486 - 130 - 10, maxWidth: 300, side: false, tail: 354 - 260 - 6 });
  });
  it("keeps its right edge 24 px left of the centred card", () => {
    const b = focusBubble(focusPoint(smallDesktop), smallDesktop, 248);
    expect(b.left).toBe(12);
    expect(b.left + 248).toBeLessThanOrEqual(centredCardLeft(smallDesktop) - 24);
    expect(b.tail).toBe(154 - 12 - 6);
  });
  it("keeps the tail on the bubble", () => {
    expect(focusBubble({ x: 20, y: 400, scale: 1.3 }, desktop, 200).tail).toBe(16);
    expect(focusBubble({ x: 340, y: 400, scale: 1.3 }, { ...desktop, heroWidth: 900 }, 100).tail).toBe(70);
  });
  it("sits to Cris's right, vertically centred, tail on the left (narrow)", () => {
    const p = focusPoint(phone);
    const b = focusBubble(p, phone, 160);
    expect(b.side).toBe(true);
    expect(b.left).toBeCloseTo(p.x + 100 * p.scale + 14);
    expect(b.top).toBe(130);
    expect(b.maxWidth).toBe(bubbleMaxWidth(p, phone));
  });
});
