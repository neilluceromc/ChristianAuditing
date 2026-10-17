import { describe, expect, it } from "vitest";
import {
  CRIS_BOX_DIP, CRIS_POINTER_IN, boxPlacement, bottomFromTop, clampBottom, dragPosition, nudgeBottom, snapSide,
} from "./cris-placement";

describe("snapSide (spec §4: on release it glides to the nearest side)", () => {
  it("snaps to the side the mascot's centre is nearer", () => {
    expect(snapSide(10, 1440, 116)).toBe("left");
    expect(snapSide(1300, 1440, 116)).toBe("right");
  });
  it("uses the mascot's centre, not its left edge", () => {
    // left 650 + half of 116 = 708 < 720: still the left half.
    expect(snapSide(650, 1440, 116)).toBe("left");
    // left 670 + 58 = 728 > 720: the right half.
    expect(snapSide(670, 1440, 116)).toBe("right");
  });
});

describe("bottomFromTop (the height it was dropped at)", () => {
  it("is the gap under the mascot", () => {
    expect(bottomFromTop(684, 900, 116)).toBe(100);
  });
  it("rounds, and never goes under the saved minimum", () => {
    expect(bottomFromTop(684.4, 900, 116)).toBe(100);
    expect(bottomFromTop(800, 900, 116)).toBe(16);
  });
});

describe("clampBottom (a saved height on a shorter screen)", () => {
  it("keeps a height that fits", () => {
    expect(clampBottom(72, 900, 116)).toBe(72);
  });
  it("pulls a height that would push the mascot off the top back on screen", () => {
    expect(clampBottom(1200, 900, 116)).toBe(900 - 116 - 60);
  });
  it("never goes under the minimum", () => {
    expect(clampBottom(0, 900, 116)).toBe(16);
  });
});

describe("nudgeBottom (arrow keys)", () => {
  it("moves 40 px a press", () => {
    expect(nudgeBottom(72, "up", 900)).toBe(112);
    expect(nudgeBottom(112, "down", 900)).toBe(72);
  });
  it("stops at the bottom and near the top", () => {
    expect(nudgeBottom(40, "down", 900)).toBe(24);
    expect(nudgeBottom(730, "up", 900)).toBe(740);
  });
});

describe("dragPosition (the mascot follows the pointer, kept on screen)", () => {
  const start = { offsetX: 50, offsetY: 40 };
  it("follows the pointer less the grab offset", () => {
    expect(dragPosition({ x: 500, y: 400 }, start, { width: 1440, height: 900 }, 116)).toEqual({ left: 450, top: 360 });
  });
  it("is kept 8 px inside the sides and the bottom, and under the top bar", () => {
    expect(dragPosition({ x: 0, y: 0 }, start, { width: 1440, height: 900 }, 116)).toEqual({ left: 8, top: 60 });
    expect(dragPosition({ x: 5000, y: 5000 }, start, { width: 1440, height: 900 }, 116)).toEqual({ left: 1440 - 116 - 8, top: 900 - 116 - 8 });
  });
});

describe("boxPlacement (spec §4 placement)", () => {
  const base = { side: "right" as const, bottom: 72, height: 900, mascot: 116, big: false };

  it("is above the mascot when it sits in the lower half", () => {
    expect(boxPlacement(base).above).toBe(true);
  });
  it("is below it when it sits in the upper half", () => {
    expect(boxPlacement({ ...base, bottom: 700 }).above).toBe(false);
  });
  it("is above at exactly half way", () => {
    expect(boxPlacement({ ...base, bottom: 450 }).above).toBe(true);
  });

  it("above: its bottom edge dips 24 px into the mascot, aligned 29 px in from the mascot's side", () => {
    const { css } = boxPlacement(base);
    expect(CRIS_BOX_DIP).toBe(24);
    expect(css.bottom).toBe("calc(100% - 24px)");
    expect(css.right).toBe("29px");
    expect(css.top).toBeUndefined();
    expect(css.left).toBeUndefined();
  });
  it("below: its top edge dips 24 px into the mascot", () => {
    const { css } = boxPlacement({ ...base, side: "left", bottom: 700 });
    expect(css.top).toBe("calc(100% - 24px)");
    expect(css.left).toBe("29px");
    expect(css.bottom).toBeUndefined();
    expect(css.right).toBeUndefined();
  });

  it("puts the pointer 21 px in, so its centre (21 + 8) plus the 29 px offset is the mascot's centre", () => {
    expect(CRIS_POINTER_IN).toBe(21);
    expect(29 + CRIS_POINTER_IN + 8).toBe(116 / 2);
  });

  it("caps the height to the room on its side of the mascot, never under 240 px", () => {
    // Above: the screen over the mascot, plus the 24 px dip, less a 16 px margin.
    expect(boxPlacement(base).css.maxHeight).toBe(`${900 - 72 - 116 + 24 - 16}px`);
    // Below: the room under the mascot's top.
    expect(boxPlacement({ ...base, bottom: 700 }).css.maxHeight).toBe(`${700 + 24 - 16}px`);
    expect(boxPlacement({ ...base, height: 300 }).css.maxHeight).toBe("240px");
  });

  it("is 368 × 470, or 368 × 620 when bigger (spec §4: a taller box, never a wider one), narrowing to fit the screen", () => {
    expect(boxPlacement(base).css.width).toBe("min(368px, calc(100vw - 170px))");
    expect(boxPlacement(base).css.height).toBe("470px");
    const big = boxPlacement({ ...base, big: true }).css;
    expect(big.width).toBe(boxPlacement(base).css.width);
    expect(big.height).toBe("620px");
  });

  it("grows out of the mascot's corner", () => {
    expect(boxPlacement(base).css.transformOrigin).toBe("calc(100% - 29px) 100%");
    expect(boxPlacement({ ...base, side: "left", bottom: 700 }).css.transformOrigin).toBe("29px 0");
  });
});
