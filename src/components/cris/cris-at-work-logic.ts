// "Cris at Work" (Phase 47 Task 10): the owner's Design Component, ported. This file holds its script's pure parts —
// the five tasks and their words, the phase cycle, Cris's moods as functions of time, the liquid frame's drops and the
// pods' rings — so the component (cris-at-work.tsx) only wires them to the DOM, and they test without one.

export type CawMood = "think" | "cross" | "search" | "idle" | "sad";
export type CawTask = { key: "coding" | "error" | "reading" | "coffee" | "limit"; mood: CawMood; doing: string; lines: [string, string, string] };

export const CAW_TASKS: readonly CawTask[] = [
  { key: "coding", mood: "think", doing: "coding the new screens", lines: ["Nearly there…", "Just one more function.", "Tab, tab, tab."] },
  {
    key: "error", mood: "cross", doing: "debugging a stubborn error",
    lines: ["Why is this undefined?!", "It worked five minutes ago.", "Who wrote this? Oh. Me."],
  },
  { key: "reading", mood: "search", doing: "reading up on the rules", lines: ["Hmm, says here…", "Ah. That explains it.", "Highlighting everything."] },
  {
    key: "coffee", mood: "idle", doing: "taking a quick coffee break",
    lines: ["Refuel. Reboot.", "Tests pass. I earned this.", "Coffee first, then features."],
  },
  {
    key: "limit", mood: "sad", doing: "waiting for her Claude limit to reset",
    lines: ["I hit my Claude limit…", "Out of tokens. Out of hope.", "Wake me when it resets."],
  },
];

export const CAW_MOODS: readonly CawMood[] = ["think", "cross", "search", "idle", "sad"];

/** The source's default pace (its "pace" prop): a new task every 6 s. */
export const CAW_PACE_MS = 6000;
/** The words fade out over this long before the task changes (the source's swapTimer and .swap transition). */
export const CAW_FADE_MS = 350;
/** Under reduced motion the cycle stops on one calm task: reading. */
export const CAW_CALM_INDEX = 2;

/** The task and the speech-bubble line for a step of the loop (the source's taskIndex() and renderVals()). */
export function cawShown(step: number, reduced: boolean): { task: CawTask; quote: string } {
  const s = reduced ? 0 : step;
  const task = reduced ? CAW_TASKS[CAW_CALM_INDEX] : CAW_TASKS[s % CAW_TASKS.length];
  const turn = Math.floor(s / CAW_TASKS.length);
  return { task, quote: task.lines[turn % 3] };
}

export type PhaseCycle = { pause(): void; resume(): void; stop(): void };

/**
 * The source's start()/tick(): every pace, fade the words out, then after the fade step to the next task. Under
 * reduced motion it never schedules anything. pause() (the tab went hidden) clears both timers and finishes a fade
 * that was under way, so the words are never left faded out; stop() (unmount) clears both and calls nothing.
 */
export function createPhaseCycle(opts: {
  reduced: boolean;
  paceMs?: number;
  onFadeOut: () => void;
  onNext: () => void;
}): PhaseCycle {
  const pace = opts.paceMs ?? CAW_PACE_MS;
  let interval: ReturnType<typeof setInterval> | null = null;
  let swap: ReturnType<typeof setTimeout> | null = null;
  const clearSwap = () => {
    if (swap !== null) clearTimeout(swap);
    swap = null;
  };
  const tick = () => {
    opts.onFadeOut();
    clearSwap();
    swap = setTimeout(() => {
      swap = null;
      opts.onNext();
    }, CAW_FADE_MS);
  };
  const halt = () => {
    if (interval !== null) clearInterval(interval);
    interval = null;
  };
  return {
    resume() {
      if (opts.reduced || interval !== null) return;
      interval = setInterval(tick, pace);
    },
    pause() {
      halt();
      if (swap !== null) {
        clearSwap();
        opts.onNext();
      }
    },
    stop() {
      halt();
      clearSwap();
    },
  };
}

export type MoodFrame = {
  x: number; y: number; r: number; glow: number; ex: number; ey: number; sy: number;
  cs: number; co: number; va: number; vb: number; vc: number; vo: number; sc: number;
};

/**
 * Cris's moods (from cris.css) as functions of time, so one melts into the next: the orb's sway (x, y, r), the red
 * glow, the eye's offset and squash, the core's scale and opacity, and the spin speeds (deg/s) of her ring sets.
 */
export function moodAt(m: CawMood, t: number): MoodFrame {
  const TAU = Math.PI * 2;
  const br = Math.sin((TAU * t) / 3.2);
  const base: MoodFrame = {
    x: 0, y: 0, r: 0, glow: 0, ex: 0, ey: 0, sy: 1, cs: 0.99 + 0.07 * br, co: 0.925 + 0.075 * br, va: 15, vb: -10, vc: 40, vo: 0.3, sc: 1,
  };
  if (m === "idle") return { ...base, y: -3 * (1 - Math.cos((TAU * t) / 4)) };
  if (m === "think") {
    const c = Math.cos((TAU * t) / 2.4);
    return { ...base, y: -2 * (1 - c), r: -3 * c, ex: 10 * c, ey: -20 + 2 * c, va: 120, vb: -90, vc: 225, vo: 1.1 };
  }
  if (m === "search") {
    const c = Math.cos((TAU * t) / 1.8);
    return { ...base, x: -6 * c, r: -4 * c, ex: -34 * c, vc: 180, vo: 0.6 };
  }
  if (m === "sad") {
    // m-sad, pushed further: she sinks lower, the eye drops, the core all but goes out.
    const c = 1 - Math.cos((TAU * t) / 5);
    return {
      ...base, y: 22 + 2 * c, r: -8 - 0.6 * c, sc: 0.95, ey: 30 + 2 * c, cs: 0.68 + 0.03 * c, co: 0.5 + 0.05 * c,
      va: 3, vb: -2, vc: 8, vo: 0.04,
    };
  }
  const p = (t % 1.6) / 1.6;
  let x = 0;
  let r = 0;
  let glow = 0;
  if (p > 0.52 && p < 0.86) {
    const q = (p - 0.52) / 0.34;
    x = 7 * Math.sin(q * Math.PI * 5) * (1 - q);
    r = 2 * Math.sin(q * Math.PI * 5) * (1 - q);
  }
  if (p > 0.5) glow = p < 0.62 ? (p - 0.5) / 0.12 : (1 - p) / 0.38;
  return {
    ...base, x, r, glow, sy: 0.66 - 0.04 * Math.cos((TAU * t) / 1.6), cs: 1.14 - 0.14 * Math.cos((TAU * t) / 0.5), co: 1,
    va: 180, vb: -144, vc: 257, vo: 1.5,
  };
}

const DROP_KEYS = ["d1", "d2", "d3", "d4", "s1", "s2", "s3", "s4", "s5"];
const SHAPES = [
  [[165, 215, 112], [300, 165, 75], [335, 265, 85], [252, 236, 92], [240, 73, 17], [424, 178, 28], [234, 341, 12], [90, 104, 8], [470, 250, 9]],
  [[150, 230, 100], [285, 150, 82], [370, 230, 88], [240, 250, 100], [110, 105, 14], [470, 140, 20], [330, 345, 16], [60, 300, 10], [452, 320, 12]],
  [[190, 200, 118], [320, 180, 80], [300, 280, 80], [230, 270, 90], [330, 62, 20], [440, 250, 24], [140, 340, 14], [70, 170, 12], [420, 95, 10]],
];

/**
 * The liquid frame: nine drops melted together by the goo filter. It holds one of three shapes, then flows into the
 * next; each drop also wobbles on its own clock, and the satellites pinch off and rejoin as they travel.
 */
export function blobAt(k: string, t: number): { x: number; y: number; r: number } | null {
  const i = DROP_KEYS.indexOf(k);
  if (i < 0) return null;
  const HOLD = 3;
  const MORPH = 2.4;
  const SEG = HOLD + MORPH;
  const n = Math.max(0, Math.floor(t / SEG));
  const f = t - n * SEG;
  const m = f < HOLD ? 0 : (f - HOLD) / MORPH;
  const e = m * m * m * (m * (m * 6 - 15) + 10);
  const A = SHAPES[n % 3][i];
  const B = SHAPES[(n + 1) % 3][i];
  const w = (Math.PI * 2 * t) / (4 + i * 0.7) + i;
  return {
    x: A[0] + (B[0] - A[0]) * e + 4 * Math.sin(w),
    y: A[1] + (B[1] - A[1]) * e + 4 * Math.cos(w * 0.8 + 1),
    r: A[2] + (B[2] - A[2]) * e + A[2] * 0.04 * Math.sin(w * 1.3 + 0.5),
  };
}

/** The device pods' rings (orb.tsx RINGS), one entry per pod. */
export function ringOf(i: number): { rx: number; ry: number; tilt: number; a: number } {
  return [
    { rx: 262, ry: 62, tilt: -16, a: 0.4 },
    { rx: 262, ry: 62, tilt: -16, a: Math.PI + 0.4 },
    { rx: 250, ry: 56, tilt: 22, a: 1.9 },
    { rx: 240, ry: 50, tilt: -48, a: 4.2 },
  ][i];
}
