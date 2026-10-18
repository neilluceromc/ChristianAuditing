import { describe, expect, it } from "vitest";
import {
  CRIS_HIT, CRIS_INSET, CRIS_MASCOT, CRIS_MASCOT_PHONE, CRIS_TAB_HEIGHT, boxDip, boxIn, boxPlacement, bottomFromTop, clampBottom,
  dragPosition, nudgeBottom, pointerIn, snapSide, tabBottom,
} from "./cris-placement";

describe("the mascot's size and place (spec §4, updated 2026-10-18)", () => {
  it("is 64 px (56 px on phones), its clickable glass body 44 px, 20 px in from its side", () => {
    expect(CRIS_MASCOT).toBe(64);
    expect(CRIS_MASCOT_PHONE).toBe(56);
    expect(CRIS_HIT).toBe(44);
    expect(CRIS_INSET).toBe(20);
  });
});

describe("snapSide (spec §4: on release it glides to the nearest side)", () => {
  it("snaps to the side the mascot's centre is nearer", () => {
    expect(snapSide(10, 1440, 64)).toBe("left");
    expect(snapSide(1300, 1440, 64)).toBe("right");
  });
  it("uses the mascot's centre, not its left edge", () => {
    // left 680 + half of 64 = 712 < 720: still the left half.
    expect(snapSide(680, 1440, 64)).toBe("left");
    // left 690 + 32 = 722 > 720: the right half.
    expect(snapSide(690, 1440, 64)).toBe("right");
  });
  it("takes the mascot's size: the same left edge snaps differently for a bigger mascot", () => {
    // 680 + 58 = 738 > 720.
    expect(snapSide(680, 1440, 116)).toBe("right");
  });
});

describe("bottomFromTop (the height it was dropped at)", () => {
  it("is the gap under the mascot", () => {
    expect(bottomFromTop(816, 900, 64)).toBe(20);
    expect(bottomFromTop(684, 900, 116)).toBe(100);
  });
  it("rounds, and never goes under the saved minimum", () => {
    expect(bottomFromTop(816.4, 900, 64)).toBe(20);
    expect(bottomFromTop(850, 900, 64)).toBe(16);
  });
});

describe("clampBottom (a saved height on a shorter screen)", () => {
  it("keeps a height that fits", () => {
    expect(clampBottom(20, 900, 64)).toBe(20);
    expect(clampBottom(72, 900, 64)).toBe(72);
  });
  it("pulls a height that would push the mascot off the top back on screen", () => {
    expect(clampBottom(1200, 900, 64)).toBe(900 - 64 - 60);
  });
  it("never goes under the minimum", () => {
    expect(clampBottom(0, 900, 64)).toBe(16);
  });
});

describe("nudgeBottom (arrow keys)", () => {
  it("moves 40 px a press", () => {
    expect(nudgeBottom(20, "up", 900)).toBe(60);
    expect(nudgeBottom(112, "down", 900)).toBe(72);
  });
  it("stops at the saved minimum and near the top", () => {
    expect(nudgeBottom(40, "down", 900)).toBe(16);
    expect(nudgeBottom(20, "down", 900)).toBe(16);
    expect(nudgeBottom(730, "up", 900)).toBe(740);
  });
});

describe("dragPosition (the mascot follows the pointer, kept on screen)", () => {
  const start = { offsetX: 30, offsetY: 30 };
  it("follows the pointer less the grab offset", () => {
    expect(dragPosition({ x: 500, y: 400 }, start, { width: 1440, height: 900 }, 64)).toEqual({ left: 470, top: 370 });
  });
  it("is kept 8 px inside the sides and the bottom, and under the top bar", () => {
    expect(dragPosition({ x: 0, y: 0 }, start, { width: 1440, height: 900 }, 64)).toEqual({ left: 8, top: 60 });
    expect(dragPosition({ x: 5000, y: 5000 }, start, { width: 1440, height: 900 }, 64)).toEqual({ left: 1440 - 64 - 8, top: 900 - 64 - 8 });
  });
});

describe("the box's dip and pointer, from the mascot's size", () => {
  it("dips into the orb's clear margin outside its outer ring: about 10 px for the 64 px mascot", () => {
    expect(boxDip(64)).toBe(10);
    expect(boxDip(116)).toBe(19);
  });
  it("puts the pointer's centre (its offset + 8) over the mascot's centre", () => {
    for (const m of [64, 116]) expect(boxIn(m) + pointerIn(m) + 8).toBe(m / 2);
    expect(boxIn(64)).toBe(3);
    expect(pointerIn(64)).toBe(21);
  });
  it("keeps the pointer at least 21 px in from the box's side, clear of its rounded corner", () => {
    expect(pointerIn(116)).toBe(21);
    expect(boxIn(116)).toBe(29);
  });
  it("never puts the box outside the mascot's side for a small mascot", () => {
    expect(boxIn(40)).toBe(0);
    expect(boxIn(40) + pointerIn(40) + 8).toBe(20);
  });
});

describe("tabBottom (the tucked-away tab sits at the mascot's height)", () => {
  it("centres the 56 px tab on where the mascot was", () => {
    expect(CRIS_TAB_HEIGHT).toBe(56);
    expect(tabBottom(20, 64)).toBe(24);
    expect(tabBottom(300, 64)).toBe(304);
  });
});

describe("boxPlacement (spec §4 placement)", () => {
  const base = { side: "right" as const, bottom: 20, height: 900, mascot: 64, big: false };

  it("is above the mascot when it sits in the lower half", () => {
    expect(boxPlacement(base).above).toBe(true);
  });
  it("is below it when it sits in the upper half", () => {
    expect(boxPlacement({ ...base, bottom: 700 }).above).toBe(false);
  });
  it("is above at exactly half way", () => {
    expect(boxPlacement({ ...base, bottom: 450 }).above).toBe(true);
  });

  it("above: its bottom edge dips 10 px into the mascot, aligned 3 px in from the mascot's side", () => {
    const { css } = boxPlacement(base);
    expect(css.bottom).toBe("calc(100% - 10px)");
    expect(css.right).toBe("3px");
    expect(css.top).toBeUndefined();
    expect(css.left).toBeUndefined();
  });
  it("below: its top edge dips 10 px into the mascot", () => {
    const { css } = boxPlacement({ ...base, side: "left", bottom: 700 });
    expect(css.top).toBe("calc(100% - 10px)");
    expect(css.left).toBe("3px");
    expect(css.bottom).toBeUndefined();
    expect(css.right).toBeUndefined();
  });

  it("hands the pointer's offset to the CSS, so its centre is the mascot's centre", () => {
    expect(boxPlacement(base).css["--cris-pointer-in"]).toBe("21px");
    expect(boxPlacement({ ...base, mascot: 40 }).css["--cris-pointer-in"]).toBe("12px");
  });

  it("caps the height to the room on its side of the mascot, never under 240 px", () => {
    // Above: the screen over the mascot, plus the 10 px dip, less a 16 px margin.
    expect(boxPlacement(base).css.maxHeight).toBe(`${900 - 20 - 64 + 10 - 16}px`);
    // Below: the room under the mascot's top.
    expect(boxPlacement({ ...base, bottom: 700 }).css.maxHeight).toBe(`${700 + 10 - 16}px`);
    expect(boxPlacement({ ...base, height: 300 }).css.maxHeight).toBe("240px");
  });

  it("is 368 × 470, or 368 × 620 when bigger (spec §4: a taller box, never a wider one), narrowing to fit the screen", () => {
    expect(boxPlacement(base).css.width).toBe("min(368px, calc(100vw - 170px))");
    expect(boxPlacement(base).css.height).toBe("470px");
    const big = boxPlacement({ ...base, big: true }).css;
    expect(big.width).toBe(boxPlacement(base).css.width);
    expect(big.height).toBe("620px");
  });

  it("grows out of the mascot (from the pointer, over its centre)", () => {
    expect(boxPlacement(base).css.transformOrigin).toBe("calc(100% - 29px) 100%");
    expect(boxPlacement({ ...base, side: "left", bottom: 700 }).css.transformOrigin).toBe("29px 0");
  });
});
