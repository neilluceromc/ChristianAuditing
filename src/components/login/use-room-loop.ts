// Cris's day in the back room (spec §4.4): travel to a station, play its moods and line, dwell 6.2 s, move on;
// after the sixth scene it loops. Ported from the mockup's go()/frame()/runClock()/hands().
//
// What changes per scene is split two ways. The things that must line up with CSS timing are set straight on the
// DOM, as the mockup does: `--lw-tv` (travel seconds) on the scene, the sky and `data-at` (reset, reflow, set, so
// the station animations restart) and the camera transform on the world, and the wall clock's hands. Everything
// the components render (scene index, mood, line, travel state, the day-log clock) is React state. The only
// per-frame work is the clock count during a travel (spec §9).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { CrisMood } from "@/lib/cris-mood";
import { DWELL_MS, SCENES, cameraX, clockAt, travelSeconds } from "./scenes";
import { WORLD_H } from "./world";

export type RoomLoopOptions = {
  reduced: boolean;
  sceneRef: RefObject<HTMLDivElement | null>;
  worldRef: RefObject<HTMLDivElement | null>;
  /** Where the visible part of the room ends, in scene pixels (left of the card on desktop). */
  visibleRight: () => number;
};

type LoopState = {
  index: number;
  playing: boolean;
  mood: CrisMood;
  line: string | null;
  travelling: boolean;
  /** This scene's travel time in seconds (0 when it did not move). */
  travel: number;
  /** Cris's lean while travelling, in degrees: toward the direction of travel. */
  lean: number;
  tx: number;
  scale: number;
  /** The visible room's right edge used for the last camera placement, in scene pixels. */
  viewRight: number;
};

export type RoomLoop = LoopState & {
  /** The day-log clock, whole minutes after midnight. */
  minute: number;
  goTo(i: number): void;
  togglePlay(): void;
  /** Stop the loop and its timers (focus mode); the scene stays where it is. */
  suspend(): void;
  /** Undo suspend: replay the current scene, or when paused show it complete with its line. */
  resume(): void;
  /** Re-place the camera for the current layout without transitions. */
  relayout(): void;
  /** The room Cris's centre and scale, in scene-element pixels (where the camera is heading, not mid-pan). */
  crisPoint(): { x: number; y: number; scale: number };
  sceneRef: RefObject<HTMLDivElement | null>;
  worldRef: RefObject<HTMLDivElement | null>;
};

const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribeReduced(cb: () => void) {
  const m = window.matchMedia(reducedQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const readReduced = () => window.matchMedia(reducedQuery).matches;
const no = () => false;

/** The person's reduced-motion setting (false on the server and during hydration). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, no);
}

const wrap = (m: number) => ((m % 1440) + 1440) % 1440;
const RESIZE_DEBOUNCE_MS = 80;

export function useRoomLoop({ reduced, sceneRef, worldRef, visibleRight }: RoomLoopOptions): RoomLoop {
  const [state, setState] = useState<LoopState>({
    index: 0,
    playing: true,
    mood: "idle",
    line: null,
    travelling: false,
    travel: 0,
    lean: 10,
    tx: 0,
    scale: 1,
    viewRight: 0,
  });
  const [minute, setMinute] = useState(SCENES[0].minute);

  // Latest options, read by the controller without rebuilding it.
  const opts = useRef({ reduced, visibleRight });
  useEffect(() => {
    opts.current = { reduced, visibleRight };
  });

  const api = useMemo(() => {
    const m = {
      cur: -1,
      playing: true,
      suspended: false,
      timers: [] as ReturnType<typeof setTimeout>[],
      next: undefined as ReturnType<typeof setTimeout> | undefined,
      raf: 0,
      instantRaf: 0,
      /** The clock as shown (unwrapped during a count) and the minute it is heading for. */
      shown: SCENES[0].minute,
      target: SCENES[0].minute,
      tx: 0,
      scale: 1,
    };
    const patch = (p: Partial<LoopState>) => setState((s) => ({ ...s, ...p }));
    const later = (ms: number, fn: () => void) => {
      m.timers.push(setTimeout(fn, ms));
    };
    const clearAll = () => {
      m.timers.forEach(clearTimeout);
      m.timers = [];
      clearTimeout(m.next);
      cancelAnimationFrame(m.raf);
    };

    // The wall clock's hands (the world's markup never changes, so they are looked up once).
    let hourHand: Element | null = null;
    let minuteHand: Element | null = null;
    const hands = (min: number) => {
      hourHand ??= worldRef.current?.querySelector("#lw-hour") ?? null;
      minuteHand ??= worldRef.current?.querySelector("#lw-minute") ?? null;
      const w = wrap(min);
      hourHand?.setAttribute("transform", `rotate(${(((w / 60) % 12) * 30).toFixed(2)})`);
      minuteHand?.setAttribute("transform", `rotate(${((w % 60) * 6).toFixed(2)})`);
    };
    const showClock = (min: number) => {
      m.shown = min;
      setMinute(Math.round(wrap(min)) % 1440);
      hands(min);
    };
    const runClock = (to: number, seconds: number) => {
      const from = wrap(m.shown);
      m.target = to;
      if (!seconds) {
        showClock(to);
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = (t - t0) / (seconds * 1000);
        showClock(clockAt(from, to, k));
        if (k < 1) m.raf = requestAnimationFrame(step);
      };
      m.raf = requestAnimationFrame(step);
    };

    /** Place the camera on the current scene (mockup frame()). */
    const frame = () => {
      const scene = sceneRef.current;
      const world = worldRef.current;
      if (!scene || !world || m.cur < 0) return;
      const sc = SCENES[m.cur];
      const scale = scene.clientHeight / WORLD_H;
      const right = opts.current.visibleRight();
      const tx = cameraX(sc.focus, scale, right, scene.clientWidth);
      m.tx = tx;
      m.scale = scale;
      world.style.transform = `translate3d(${tx.toFixed(1)}px,0,0) scale(${scale.toFixed(4)})`;
      patch({ tx, scale, viewRight: right });
    };

    /** Start scene i (mockup go()). */
    const go = (i: number) => {
      clearAll();
      const scene = sceneRef.current;
      const world = worldRef.current;
      if (!scene || !world) return;
      const sc = SCENES[i];
      const prev = m.cur >= 0 ? SCENES[m.cur] : null;
      m.cur = i;
      const reducedNow = opts.current.reduced;
      // Suspended (focus mode): jump straight there, so no clock count or travel lean runs behind the blur.
      const tv = reducedNow || m.suspended ? 0 : travelSeconds(prev ? prev.cx : null, sc.cx);
      scene.style.setProperty("--lw-tv", `${tv}s`);
      world.style.setProperty("--lw-sky1", sc.sky[0]);
      world.style.setProperty("--lw-sky2", sc.sky[1]);
      // Reset, force a style flush, then set: the station animations restart even for the same scene.
      world.dataset.at = "";
      world.getBoundingClientRect();
      world.dataset.at = sc.id;
      patch({
        index: i,
        mood: "idle",
        line: null,
        travelling: tv > 0,
        travel: tv,
        lean: prev && sc.cx < prev.cx ? -10 : 10,
      });
      frame();
      runClock(sc.minute, tv);
      if (m.suspended) return;
      const arrive = tv * 1000;
      later(arrive + 80, () => patch({ travelling: false }));
      for (const [mood, at] of sc.moods) later(arrive + at, () => patch({ mood }));
      if (reducedNow) patch({ line: sc.line });
      else later(arrive + sc.sayAt, () => patch({ line: sc.line }));
      if (m.playing) m.next = setTimeout(() => go((i + 1) % SCENES.length), arrive + DWELL_MS);
    };

    /** Show the current scene complete, at once: clock, last mood and line (a paused room). */
    const settle = () => {
      clearAll();
      if (m.cur < 0) return;
      const sc = SCENES[m.cur];
      showClock(m.target);
      patch({ travelling: false, mood: sc.moods[sc.moods.length - 1][0], line: sc.line });
    };

    const relayout = () => {
      const scene = sceneRef.current;
      if (!scene) return;
      scene.dataset.instant = "";
      frame();
      scene.getBoundingClientRect();
      cancelAnimationFrame(m.instantRaf);
      m.instantRaf = requestAnimationFrame(() => delete scene.dataset.instant);
    };

    return {
      m,
      go,
      settle,
      clearAll,
      relayout,
      goTo(i: number) {
        go(i);
      },
      togglePlay() {
        m.playing = !m.playing;
        patch({ playing: m.playing });
        if (!m.playing) clearTimeout(m.next);
        else if (!m.suspended && !document.hidden) go((m.cur + 1) % SCENES.length);
      },
      suspend() {
        m.suspended = true;
        clearAll();
        showClock(m.target);
        patch({ travelling: false });
      },
      resume() {
        m.suspended = false;
        if (document.hidden) return;
        if (m.playing) go(Math.max(m.cur, 0));
        else settle();
      },
      crisPoint() {
        const sc = SCENES[Math.max(m.cur, 0)];
        return { x: m.tx + sc.cx * m.scale, y: sc.cy * m.scale, scale: m.scale };
      },
    };
  }, [sceneRef, worldRef]);

  // Start (and restart when reduced motion flips, which it does once after hydration when it is on).
  useEffect(() => {
    const { m } = api;
    m.playing = !reduced;
    setState((s) => ({ ...s, playing: m.playing }));
    api.go(Math.max(m.cur, 0));
    if (document.hidden) api.clearAll();

    const onVisibility = () => {
      if (document.hidden) api.clearAll();
      else if (!m.suspended) {
        if (m.playing) api.go(Math.max(m.cur, 0));
        else api.settle();
      }
    };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(api.relayout, RESIZE_DEBOUNCE_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    return () => {
      api.clearAll();
      cancelAnimationFrame(m.instantRaf);
      clearTimeout(resizeTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, [api, reduced]);

  const { goTo, togglePlay, suspend, resume, relayout, crisPoint } = api;
  return useMemo(
    () => ({ ...state, minute, goTo, togglePlay, suspend, resume, relayout, crisPoint, sceneRef, worldRef }),
    [state, minute, goTo, togglePlay, suspend, resume, relayout, crisPoint, sceneRef, worldRef],
  );
}
