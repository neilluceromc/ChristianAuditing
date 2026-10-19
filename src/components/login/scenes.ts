// The six scenes of Cris's day in the room (spec §4.3, §4.4). Pure data and maths; the room
// component drives the timing and the camera from these.
import type { CrisMood } from "@/lib/cris-mood";

export type SceneId = "scan" | "missing" | "stamp" | "short" | "dep" | "off";

export type Scene = {
  id: SceneId;
  /** Minutes after midnight, for the day log. */
  minute: number;
  area: string;
  task: string;
  line: string;
  /** Moods to play, with the ms after arrival each one starts. */
  moods: [CrisMood, number][];
  /** ms after arrival when the bubble starts typing. */
  sayAt: number;
  /** Cris's position in world units. */
  cx: number;
  cy: number;
  /** Camera focus x in world units. */
  focus: number;
  /** Bubble anchor in world units. */
  anchor: [number, number];
  align: "left" | "right";
  /** Sky gradient, top and bottom. */
  sky: [string, string];
};

export const SCENES: readonly Scene[] = [
  {
    id: "scan",
    minute: 520,
    area: "Stockroom",
    task: "Checking in a returned laptop",
    line: "BR-LT-0230 is checked in. Back on shelf A2.",
    moods: [["search", 0], ["talk", 2500]],
    sayAt: 2500,
    cx: 560,
    cy: 340,
    focus: 700,
    anchor: [604, 226],
    align: "right",
    sky: ["#a9d6f7", "#eef8ff"],
  },
  {
    id: "missing",
    minute: 595,
    area: "Stockroom",
    task: "Looking for a laptop that isn't on its shelf",
    line: "Shelf B3 says BR-LT-0027. Shelf B3 disagrees.",
    moods: [["look", 0]],
    sayAt: 2200,
    cx: 1000,
    cy: 340,
    focus: 1110,
    anchor: [968, 226],
    align: "left",
    sky: ["#97cdf4", "#e3f3ff"],
  },
  {
    id: "stamp",
    minute: 680,
    area: "Purchasing",
    task: "Approving a purchase request",
    line: "PR-1042 approved. Five headsets for the new hires.",
    moods: [["think", 0], ["talk", 2600]],
    sayAt: 2600,
    cx: 1650,
    cy: 350,
    focus: 1830,
    anchor: [1620, 238],
    align: "left",
    sky: ["#86c4f2", "#d6eeff"],
  },
  {
    id: "short",
    minute: 825,
    area: "Receiving",
    task: "Receiving a delivery that came up short",
    line: "Ordered 10. Received 9. Again.",
    moods: [["search", 0], ["cross", 2400]],
    sayAt: 2400,
    cx: 2100,
    cy: 350,
    focus: 2300,
    anchor: [2068, 238],
    align: "left",
    sky: ["#86c0ee", "#dcefff"],
  },
  {
    id: "dep",
    minute: 930,
    area: "Finance",
    task: "Running this month's depreciation",
    line: "Month 7 of 36. Book value ₱58,000.",
    moods: [["think", 0], ["talk", 2600]],
    sayAt: 2600,
    cx: 2850,
    cy: 350,
    focus: 3050,
    anchor: [2818, 238],
    align: "left",
    sky: ["#f2c58f", "#fdebd0"],
  },
  {
    id: "off",
    minute: 1025,
    area: "Offboarding",
    task: "Collecting a leaver's equipment",
    line: "Laptop, headset, badge. All 3 back.",
    moods: [["search", 0], ["idle", 2500]],
    sayAt: 2500,
    cx: 3370,
    cy: 340,
    focus: 3560,
    anchor: [3404, 226],
    align: "right",
    sky: ["#f2a372", "#ffd7a8"],
  },
];

/** How long Cris stays at a station before the next scene. */
export const DWELL_MS = 6200;

/** Travel time between two stations' x: 0 when there is no move, else clamped to 1.3 s to 2.4 s. */
export function travelSeconds(fromCx: number | null, toCx: number): number {
  if (fromCx === null || fromCx === toCx) return 0;
  return Math.min(2.4, Math.max(1.3, Math.abs(toCx - fromCx) / 1100));
}

/** A minute of the day as "HH:MM", wrapping past midnight. */
export function fmtClock(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String((m / 60) | 0).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** How far a minute sits along the day log's 08:00 to 18:00 bar, 0 to 100. */
export function dayPct(minute: number): number {
  return ((minute - 480) / 600) * 100;
}

/**
 * The world's left offset so the camera centres `focus` in the visible part of the room
 * (`visibleRight` is where the visible part ends), clamped so the world never shows past
 * either end. The world is 3960 units wide.
 */
export function cameraX(focus: number, scale: number, visibleRight: number, viewportWidth: number): number {
  const x = visibleRight / 2 - focus * scale;
  return Math.min(0, Math.max(viewportWidth - 3960 * scale, x));
}

/**
 * The day-log clock during a travel: the minute `k` (0 to 1) of the way from `from` to `to`, eased in and out.
 * Always counts forward, so the loop from 17:05 back to 08:40 runs through the night. Not wrapped: format
 * with `fmtClock`.
 */
export function clockAt(from: number, to: number, k: number): number {
  const t = Math.min(1, Math.max(0, k));
  const target = to < from ? to + 1440 : to;
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return from + (target - from) * e;
}

/**
 * Where the room's speech bubble goes, in scene pixels (spec §4.5): at the scene's anchor, kept 12 px inside
 * the visible room (`right` is where it ends, so never under the card) and at least 70 px from the top. `left`
 * is the bubble's CSS left (its right edge for a right-aligned bubble, which is drawn translated by -100 %);
 * `tail` is the tail's offset from the bubble's left edge, still pointing at Cris after a clamp.
 */
export function roomBubble(p: {
  anchor: [number, number];
  align: "left" | "right";
  tx: number;
  scale: number;
  right: number;
  width: number;
}): { left: number; top: number; tail: number } {
  const ax = p.tx + p.anchor[0] * p.scale;
  const leftEdge = p.align === "right" ? ax - p.width : ax;
  const fix = Math.min(Math.max(leftEdge, 12), p.right - p.width - 12) - leftEdge;
  const tail = p.align === "right" ? p.width - 40 - fix : 26 - fix;
  return {
    left: ax + fix,
    top: Math.max(p.anchor[1] * p.scale, 70),
    tail: Math.min(Math.max(tail, 14), p.width - 26),
  };
}
