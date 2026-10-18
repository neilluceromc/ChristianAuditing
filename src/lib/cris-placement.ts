import { CRIS_BOTTOM_MAX, CRIS_BOTTOM_MIN } from "./cris-prefs";

/*
 * Spec §4, "Where Cris lives": where the mascot sits and where its chat box hangs off it. Pure, so the geometry
 * is tested here and the widget only reads the numbers. Ported from the CrisPage mockup's place() and drag handlers.
 *
 * One dock holds the box, the hint and the mascot; the mascot is pinned at the dock's top-left, so everything below
 * is measured from the mascot.
 */

export type CrisSide = "left" | "right";

/**
 * Settings' "Put Cris back in the corner" dispatches this window event (`detail: { side, bottom }`) after its save;
 * the widget moves at once instead of waiting for the next page load.
 */
export const CRIS_RESET_POSITION_EVENT = "cris:reset-position";

/**
 * The mascot's visual size on wide screens: the orb, rings and glow (spec §4, 64 px since 2026-10-18, owner's request;
 * it was 116). cris-widget.css keeps the same numbers as --cris-size.
 */
export const CRIS_MASCOT = 64;
/** The mascot's size on phones (under 640 px), where it is fixed bottom-right. */
export const CRIS_MASCOT_PHONE = 56;
/** The clickable glass body: a centred circle this wide. The rings and glow outside it pass clicks through. */
export const CRIS_HIT = 44;
/** How far the dock sits from its side of the screen (spec: "about 20 px from the side"). */
export const CRIS_INSET = 20;
/** The tucked-away tab: a slim button on the screen's edge (22 × 56). */
export const CRIS_TAB_HEIGHT = 56;
/** Dragging keeps the mascot under the top bar and this far inside the other edges. */
const DRAG_TOP = 60;
const DRAG_EDGE = 8;
/** Arrow keys move the mascot this far a press, between these limits. */
const NUDGE = 40;
const NUDGE_FLOOR = CRIS_BOTTOM_MIN;
const NUDGE_CEILING_GAP = 160;
const BOX_MIN_HEIGHT = 240;
const BOX_MARGIN = 16;
/** The orb's drawing is 600 units across; its outermost ring (the dashed one around the glass) has radius 203. */
const ORB_UNITS = 600;
const ORB_OUTER_RING = 203;
/** The speech-bubble pointer is a 16 px square turned 45°; its centre must sit at least this far in from the box's side, clear of the 18 px rounded corner. */
const POINTER_HALF = 8;
const POINTER_MIN_IN = 21;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** How far the box's edge dips into the mascot: the orb's clear margin outside its outer ring (10 px at 64 px). */
export function boxDip(mascot: number): number {
  return Math.round((mascot * (ORB_UNITS / 2 - ORB_OUTER_RING)) / ORB_UNITS);
}

/** How far the box's side edge sits in from the mascot's side, so the pointer can sit over the mascot's centre. */
export function boxIn(mascot: number): number {
  return Math.max(0, mascot / 2 - POINTER_HALF - POINTER_MIN_IN);
}

/** How far the pointer sits in from the box's side: boxIn + pointerIn + 8 is the mascot's centre. */
export function pointerIn(mascot: number): number {
  return mascot / 2 - POINTER_HALF - boxIn(mascot);
}

/** The tucked-away tab's height off the screen's bottom: centred on where the mascot was. */
export function tabBottom(bottom: number, mascot: number): number {
  return bottom + (mascot - CRIS_TAB_HEIGHT) / 2;
}

/** The side a dropped mascot glides to: the half of the screen its centre is in. */
export function snapSide(left: number, width: number, mascot: number): CrisSide {
  return left + mascot / 2 > width / 2 ? "right" : "left";
}

/** The saved height (px from the screen's bottom) of a mascot dropped with its top at `top`. */
export function bottomFromTop(top: number, height: number, mascot: number): number {
  return clamp(Math.round(height - top - mascot), CRIS_BOTTOM_MIN, CRIS_BOTTOM_MAX);
}

/** A saved height as shown on this screen: never above the top bar, never under the minimum. */
export function clampBottom(bottom: number, height: number, mascot: number): number {
  return clamp(bottom, CRIS_BOTTOM_MIN, Math.max(CRIS_BOTTOM_MIN, height - mascot - DRAG_TOP));
}

/** Arrow Up and Down: 40 px a press, kept between the saved minimum (16 px) and 160 px short of the top (and within what prefs store). */
export function nudgeBottom(bottom: number, dir: "up" | "down", height: number): number {
  return dir === "up"
    ? Math.min(CRIS_BOTTOM_MAX, height - NUDGE_CEILING_GAP, bottom + NUDGE)
    : Math.max(NUDGE_FLOOR, bottom - NUDGE);
}

/** Where a dragged mascot's top-left is, following the pointer less where it was grabbed, kept on screen. */
export function dragPosition(
  pointer: { x: number; y: number },
  grab: { offsetX: number; offsetY: number },
  screen: { width: number; height: number },
  mascot: number,
): { left: number; top: number } {
  return {
    left: Math.round(clamp(pointer.x - grab.offsetX, DRAG_EDGE, screen.width - mascot - DRAG_EDGE)),
    top: Math.round(clamp(pointer.y - grab.offsetY, DRAG_TOP, screen.height - mascot - DRAG_EDGE)),
  };
}

/**
 * Where the box hangs off the mascot (spec §4 "Placement"): above it unless the mascot sits in the upper half of
 * the screen, its edge dipping into the orb's clear margin (boxDip), aligned boxIn in from the mascot's side so the
 * pointer (pointerIn further in, handed to the CSS as --cris-pointer-in) sits over the mascot's centre, and capped to
 * the room on that side. `css` is the box's inline style; phones replace all of it (cris-widget.css).
 */
export function boxPlacement(p: { side: CrisSide; bottom: number; height: number; mascot: number; big: boolean }): {
  above: boolean;
  css: { [k: string]: string };
} {
  const above = !(p.bottom > p.height / 2);
  const dip = boxDip(p.mascot);
  const inset = boxIn(p.mascot);
  const pointer = pointerIn(p.mascot);
  const room = above ? p.height - p.bottom - p.mascot : p.bottom;
  const maxHeight = Math.max(BOX_MIN_HEIGHT, room + dip - BOX_MARGIN);
  const edge = `calc(100% - ${dip}px)`;
  // It grows out of the pointer, over the mascot's centre.
  const origin = pointer + POINTER_HALF;
  const originX = p.side === "right" ? `calc(100% - ${origin}px)` : `${origin}px`;
  return {
    above,
    css: {
      [p.side]: `${inset}px`,
      [above ? "bottom" : "top"]: edge,
      "--cris-pointer-in": `${pointer}px`,
      // Make bigger is a taller box only (spec §4); the width stays the same either way.
      width: "min(368px, calc(100vw - 170px))",
      height: p.big ? "620px" : "470px",
      maxHeight: `${maxHeight}px`,
      transformOrigin: `${originX} ${above ? "100%" : "0"}`,
    },
  };
}
