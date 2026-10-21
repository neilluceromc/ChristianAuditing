"use client";

// The login page's two continuous motions (Task 10's blob stage), on one animation frame: the liquid blob around
// Cris melting between its shapes (and into a small round blob beside the card in focus mode), and the soft glows
// drifting behind everything. Stopped (Pause, reduced motion) it draws one still frame whenever focus mode changes.
// Phones hide the blob (login.css), so it is not reshaped there.
import { useEffect, useRef, type RefObject } from "react";
import { blobDrop, focusOffset } from "./scenes";

const PHONE = 720;
/** Each glow's drift: x and y reach, and seconds per lap. */
const GLOWS: [number, number, number][] = [
  [170, 120, 13],
  [190, 140, 17],
  [210, 110, 15],
  [150, 160, 12],
  [230, 130, 19],
];

export function useStageLoop({
  drops,
  shades,
  glows,
  focus,
  running,
}: {
  /** The nine drops of the blob mask. */
  drops: RefObject<(SVGCircleElement | null)[]>;
  /** The blob's shadow: its first four drops, 4 units smaller. */
  shades: RefObject<(SVGCircleElement | null)[]>;
  glows: RefObject<(HTMLSpanElement | null)[]>;
  focus: boolean;
  running: boolean;
}) {
  const st = useRef({ t: 0, wf: focus ? 1 : 0, last: 0 });
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  });

  useEffect(() => {
    const s = st.current;
    const draw = (moveGlows: boolean) => {
      const w = window.innerWidth;
      if (w >= PHONE) {
        const dx = focusOffset(w);
        drops.current?.forEach((d, i) => {
          if (!d) return;
          const b = blobDrop(i, s.t, s.wf, dx);
          d.setAttribute("cx", b.x.toFixed(1));
          d.setAttribute("cy", b.y.toFixed(1));
          d.setAttribute("r", Math.max(1, b.r).toFixed(1));
        });
        shades.current?.forEach((d, i) => {
          if (!d) return;
          const b = blobDrop(i, s.t, s.wf, dx);
          d.setAttribute("cx", b.x.toFixed(1));
          d.setAttribute("cy", b.y.toFixed(1));
          d.setAttribute("r", Math.max(1, b.r - 4).toFixed(1));
        });
      }
      if (!moveGlows) return;
      glows.current?.forEach((el, i) => {
        if (!el) return;
        const [rx, ry, lap] = GLOWS[i] ?? GLOWS[0]!;
        const a = (Math.PI * 2 * s.t) / lap + i * 1.7;
        const r = (k: number) => 50 + 12 * Math.sin(a * k + i);
        el.style.transform = `translate(${(rx * Math.sin(a)).toFixed(1)}px,${(ry * Math.cos(a * 0.8 + i)).toFixed(1)}px) scale(${(1 + 0.15 * Math.sin(a * 1.3)).toFixed(3)})`;
        el.style.borderRadius =
          `${r(1.1).toFixed(0)}% ${(100 - r(1.1)).toFixed(0)}% ${r(0.9).toFixed(0)}% ${(100 - r(0.9)).toFixed(0)}% / ` +
          `${r(1.3).toFixed(0)}% ${r(0.7).toFixed(0)}% ${(100 - r(0.7)).toFixed(0)}% ${(100 - r(1.3)).toFixed(0)}%`;
      });
    };

    if (!running) {
      s.wf = focus ? 1 : 0;
      draw(false);
      return;
    }
    let raf = 0;
    s.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - s.last) / 1000));
      s.last = now;
      s.t += dt;
      s.wf += ((focusRef.current ? 1 : 0) - s.wf) * (1 - Math.exp(-dt / 0.45));
      draw(true);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Running: focus is read per frame. Stopped: a new still frame when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, running ? null : focus]);
}
