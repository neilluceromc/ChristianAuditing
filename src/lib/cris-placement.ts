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

/** The mascot's size on wide screens (spec: "about 110 px", the orb inside a 116 px button). */
export const CRIS_MASCOT = 116;
/** How far the dock sits from its side of the screen (spec: "about 64 px from the right"). */
export const CRIS_INSET = 64;
/** The box's edge dips this far into the mascot's clear top (or bottom) margin, so there is no gap. */
export const CRIS_BOX_DIP = 24;
/** The box's side edge sits this far in from the mascot's side. */
export const CRIS_BOX_IN = 29;
/** The speech-bubble pointer (a 16 px square turned 45°) sits this far in from the box's side: 29 + 21 + 8 = 58, the mascot's centre. */
export const CRIS_POINTER_IN = 21;
/** Dragging keeps the mascot under the top bar and this far inside the other edges. */
const DRAG_TOP = 60;
const DRAG_EDGE = 8;
/** Arrow keys move the mascot this far a press, between these limits. */
const NUDGE = 40;
const NUDGE_FLOOR = 24;
const NUDGE_CEILING_GAP = 160;
const BOX_MIN_HEIGHT = 240;
const BOX_MARGIN = 16;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

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

/** Arrow Up and Down: 40 px a press, kept between 24 px and 160 px short of the top (and within what prefs store). */
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
 * the screen, its edge dipping 24 px into the mascot, aligned 29 px in from the mascot's side so the pointer (21 px
 * further in) sits over the mascot's centre, and capped to the room on that side. `css` is the box's inline style;
 * phones replace all of it (cris-widget.css).
 */
export function boxPlacement(p: { side: CrisSide; bottom: number; height: number; mascot: number; big: boolean }): {
  above: boolean;
  css: { [k: string]: string };
} {
  const above = !(p.bottom > p.height / 2);
  const room = above ? p.height - p.bottom - p.mascot : p.bottom;
  const maxHeight = Math.max(BOX_MIN_HEIGHT, room + CRIS_BOX_DIP - BOX_MARGIN);
  const edge = `calc(100% - ${CRIS_BOX_DIP}px)`;
  const originX = p.side === "right" ? `calc(100% - ${CRIS_BOX_IN}px)` : `${CRIS_BOX_IN}px`;
  return {
    above,
    css: {
      [p.side]: `${CRIS_BOX_IN}px`,
      [above ? "bottom" : "top"]: edge,
      width: p.big ? "min(420px, calc(100vw - 170px))" : "min(368px, calc(100vw - 170px))",
      height: p.big ? "620px" : "470px",
      maxHeight: `${maxHeight}px`,
      transformOrigin: `${originX} ${above ? "100%" : "0"}`,
    },
  };
}
