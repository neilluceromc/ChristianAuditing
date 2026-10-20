"use client";

// The forward Cris of focus mode (spec §6): a second gold Cris outside the blurred room that flies to beside the
// centred card and talks the person through each step. Decoration only (aria-hidden, nothing focusable); the
// card says everything Cris says. LoginExperience drives where it stands and what it says; this places the
// bubble, which has to be measured: its width comes from the full line (the ghost), so the clamp that keeps it
// clear of the card is right before typing starts.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CrisOrb } from "@/components/cris/orb";
import { cn } from "@/lib/cn";
import type { CrisMood } from "@/lib/cris-mood";
import { bubbleMaxWidth, focusBubble, type FocusLayout, type FocusPoint } from "./focus-layout";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { useTypewriter } from "./use-typewriter";

/** The forward Cris types a little faster than the room Cris (34). */
export const FORWARD_MS_PER_CHAR = 30;

export function ForwardCris({
  point,
  flying,
  lean,
  visible,
  mood,
  line,
  layout,
}: {
  /** Where Cris is (or is flying to), in hero pixels; null before the first measurement (CSS places it). */
  point: FocusPoint | null;
  /** Leaning into a flight. */
  flying: boolean;
  /** The lean while flying, in degrees. */
  lean: number;
  visible: boolean;
  mood: CrisMood;
  /** What Cris is saying; null hides the bubble. */
  line: string | null;
  /** The layout the bubble is placed for (null until measured). */
  layout: FocusLayout | null;
}) {
  const reduced = useReducedMotion();
  const { shown, done } = useTypewriter(line, { reduced, msPerChar: FORWARD_MS_PER_CHAR });
  // Keep the last line in the ghost while the bubble fades out, so it doesn't collapse as it goes.
  const [ghost, setGhost] = useState(line ?? "");
  if (line !== null && line !== ghost) setGhost(line);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el || !layout || !point) return;
    el.style.maxWidth = `${bubbleMaxWidth(point, layout)}px`;
    const b = focusBubble(point, layout, el.offsetWidth);
    el.style.left = `${b.left.toFixed(1)}px`;
    el.style.top = `${b.top.toFixed(1)}px`;
    el.style.setProperty("--lw-tail", `${b.tail}px`);
  }, [point, layout, ghost]);

  const guideStyle = {
    ...(point && {
      left: `${point.x.toFixed(1)}px`,
      top: `${point.y.toFixed(1)}px`,
      transform: `scale(${point.scale.toFixed(3)})`,
    }),
    "--lw-glean": `${lean}deg`,
  } as CSSProperties;

  return (
    <>
      <div
        className={cn("lw-guide", !point && "lw-preset", visible && "lw-on", flying && "lw-flying")}
        style={guideStyle}
        aria-hidden="true"
      >
        <div className="lw-gtilt">
          <div className="lw-cris">
            <div className="lw-halo" />
            <CrisOrb color="gold" mood={mood} motion="lively" size={200} decorative className="lw-orb" />
          </div>
        </div>
      </div>
      <div
        ref={bubbleRef}
        className={cn("lw-bubble lw-gb", layout?.narrow && "lw-side", visible && line !== null && "lw-on")}
        aria-hidden="true"
      >
        <span className="lw-ghost">{ghost}</span>
        <span className="lw-typed">
          {shown}
          {line !== null && !done && <span className="lw-caret" />}
        </span>
      </div>
    </>
  );
}
