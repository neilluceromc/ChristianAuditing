// The six scenes of Cris's day on the login page (spec §4.3, §4.4; Task 10's blob stage). Pure data and maths; the
// day loop drives the timing from these. Positions are stage units: the stage is 520 × 380 and Cris's home spot is
// (215, 242), the centre of her 200-unit orb.
import type { CrisMood } from "@/lib/cris-mood";

export type SceneId = "scan" | "missing" | "stamp" | "short" | "dep" | "off";

export type Scene = {
  id: SceneId;
  area: string;
  task: string;
  line: string;
  /** Moods to play, with the ms after arrival each one starts. */
  moods: [CrisMood, number][];
  /** ms after arrival when her line shows. */
  sayAt: number;
  /** Her station: an offset from her home spot, in stage units. */
  station: [number, number];
  /** What flies from the desk to her side while she works there. */
  prop: "laptop" | "paper" | null;
};

export const SCENES: readonly Scene[] = [
  {
    id: "scan",
    area: "Stockroom",
    task: "Checking in a returned laptop",
    line: "BR-LT-0230 is checked in. Back on shelf A2.",
    moods: [["search", 0], ["talk", 2500]],
    sayAt: 2500,
    station: [60, -6],
    prop: "laptop",
  },
  {
    id: "missing",
    area: "Stockroom",
    task: "Looking for a laptop that isn't on its shelf",
    line: "Shelf B3 says BR-LT-0027. Shelf B3 disagrees.",
    moods: [["look", 0]],
    sayAt: 2200,
    station: [-45, -12],
    prop: null,
  },
  {
    id: "stamp",
    area: "Purchasing",
    task: "Approving a purchase order",
    line: "PO-1042 approved. Five headsets for the new hires.",
    moods: [["think", 0], ["talk", 2600]],
    sayAt: 2600,
    station: [0, 0],
    prop: "paper",
  },
  {
    id: "short",
    area: "Receiving",
    task: "Receiving a delivery that came up short",
    line: "Ordered 10. Received 9. Again.",
    moods: [["search", 0], ["cross", 2400]],
    sayAt: 2400,
    station: [125, 6],
    prop: null,
  },
  {
    id: "dep",
    area: "Finance",
    task: "Running this month's depreciation",
    line: "Month 7 of 36. Book value ₱58,000.",
    moods: [["think", 0], ["talk", 2600]],
    sayAt: 2600,
    station: [70, -26],
    prop: "paper",
  },
  {
    id: "off",
    area: "Offboarding",
    task: "Collecting a leaver's equipment",
    line: "Laptop, headset, badge. All 3 back.",
    moods: [["search", 0], ["idle", 2500]],
    sayAt: 2500,
    station: [-30, 6],
    prop: "laptop",
  },
];

/** How long Cris stays at a station before the next scene. */
export const DWELL_MS = 6200;

/** Travel time between two stations: 0 when there is no move, else the distance at 70 units/s, from 1.3 s to 2.4 s. */
export function travelSeconds(from: [number, number] | null, to: [number, number]): number {
  if (from === null) return 0;
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (dist < 1) return 0;
  return Math.min(2.4, Math.max(1.3, dist / 70));
}

/** The mood a scene plays `ms` after Cris arrives. */
export function moodAt(scene: Scene, ms: number): CrisMood {
  let mood = scene.moods[0]![0];
  for (const [m, at] of scene.moods) if (ms >= at) mood = m;
  return mood;
}

/** Cris's home spot in the stage. */
export const HOME: [number, number] = [215, 242];

/**
 * Where Cris stands beside the card in focus mode, as an offset from home: toward the card when it sits beside the
 * stage, less when the stage is narrower, and a little right of centre on a phone (room for her bubble).
 */
export function focusOffset(viewportWidth: number): number {
  if (viewportWidth < 720) return 95;
  return viewportWidth < 960 ? 45 : 120;
}

/** Which side of Cris a prop lands on: toward the middle of the stage. */
export function propSide(station: [number, number]): 1 | -1 {
  return HOME[0] + station[0] > 260 ? -1 : 1;
}

/**
 * The liquid blob (stage units): nine drops merged by a goo filter. Three shapes it melts between while Cris works,
 * and a small round blob around her in focus mode. Each drop is [cx, cy, r].
 */
export const BLOB_SHAPES: readonly (readonly [number, number, number])[][] = [
  [[165, 215, 112], [300, 165, 75], [335, 265, 85], [252, 236, 92], [240, 73, 17], [424, 178, 28], [234, 341, 12], [90, 104, 8], [470, 250, 9]],
  [[150, 230, 100], [285, 150, 82], [370, 230, 88], [240, 250, 100], [110, 105, 14], [470, 140, 20], [330, 345, 16], [60, 300, 10], [452, 320, 12]],
  [[190, 200, 118], [320, 180, 80], [300, 280, 80], [230, 270, 90], [330, 62, 20], [440, 250, 24], [140, 340, 14], [70, 170, 12], [420, 95, 10]],
];
export const BLOB_FOCUS: readonly (readonly [number, number, number])[] = [
  [215, 238, 104], [262, 200, 58], [172, 282, 56], [256, 284, 62], [330, 132, 13], [108, 168, 11], [300, 352, 9], [112, 300, 8], [354, 262, 10],
];
const HOLD = 3;
const MORPH = 2.4;

/**
 * Drop `i` of the blob at time `t` (seconds): holding a shape for 3 s, then melting into the next over 2.4 s, with
 * a small wobble; `focus` (0 to 1) blends it into the focus blob, moved `dx` units toward the card.
 */
export function blobDrop(i: number, t: number, focus: number, dx: number): { x: number; y: number; r: number } {
  const seg = HOLD + MORPH;
  const n = Math.max(0, Math.floor(t / seg));
  const f = t - n * seg;
  const m = f < HOLD ? 0 : (f - HOLD) / MORPH;
  const e = m * m * m * (m * (m * 6 - 15) + 10);
  const a = BLOB_SHAPES[n % 3]![i]!;
  const b = BLOB_SHAPES[(n + 1) % 3]![i]!;
  const c = BLOB_FOCUS[i]!;
  const w = (Math.PI * 2 * t) / (4 + i * 0.7) + i;
  const k = focus * focus * (3 - 2 * focus);
  const mix = (p: number, q: number, r: number) => (p + (q - p) * e) * (1 - k) + r * k;
  return {
    x: mix(a[0], b[0], c[0] + dx) + 4 * Math.sin(w),
    y: mix(a[1], b[1], c[1]) + 4 * Math.cos(w * 0.8 + 1),
    r: mix(a[2], b[2], c[2]) * (1 + 0.04 * Math.sin(w * 1.3 + 0.5)),
  };
}
