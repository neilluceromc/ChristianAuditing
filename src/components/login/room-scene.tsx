"use client";

// The back room behind the sign-in card (spec §4): the world SVG (built once on the server), the room Cris with
// its halo and floor shadow, and the speech bubble. All decoration, so the whole scene is aria-hidden and holds
// nothing focusable. useRoomLoop drives it; the camera, sky and station hooks are set on the DOM by the loop.
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { CrisOrb } from "@/components/cris/orb";
import { cn } from "@/lib/cn";
import { SCENES, roomBubble } from "./scenes";
import { useReducedMotion, type RoomLoop } from "./use-room-loop";
import { useTypewriter } from "./use-typewriter";

export function RoomScene({
  world,
  loop,
  hidden,
}: {
  /** The room SVG from buildWorld(): a constant built on the server, no user data. */
  world: string;
  loop: RoomLoop;
  /** Hide the room Cris and its bubble (while the forward Cris stands in for it). */
  hidden: boolean;
}) {
  const reduced = useReducedMotion();
  const sc = SCENES[loop.index];
  const { shown, done } = useTypewriter(loop.line, { reduced, msPerChar: 34 });
  const bubbleRef = useRef<HTMLDivElement>(null);

  // The bubble lives in screen space, so it stays readable however small the room is drawn; its width comes
  // from the full line (the ghost), so the clamp is right before typing starts.
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const p = roomBubble({
      anchor: sc.anchor,
      align: sc.align,
      tx: loop.tx,
      scale: loop.scale,
      right: loop.viewRight,
      width: el.offsetWidth,
    });
    el.style.left = `${p.left.toFixed(1)}px`;
    el.style.top = `${p.top.toFixed(1)}px`;
    el.style.setProperty("--lw-tail", `${Math.round(p.tail)}px`);
  }, [sc, loop.tx, loop.scale, loop.viewRight]);

  const crisStyle = {
    transform: `translate(${sc.cx - 100}px, ${sc.cy - 100}px)`,
    "--lw-lean": `${loop.lean}deg`,
    // The floor shadow sits on the floor under Cris, in world units from the top of Cris's box.
    "--lw-sy": `${Math.min(640, sc.cy + 280) - sc.cy + 90}px`,
  } as CSSProperties;

  return (
    <div ref={loop.sceneRef} className="lw-scene" aria-hidden="true">
      <div ref={loop.worldRef} className="lw-world">
        <div className="lw-room" dangerouslySetInnerHTML={{ __html: world }} />
        <div className={cn("lw-crisw", loop.travelling && "lw-travel", hidden && "lw-gone")} style={crisStyle}>
          <div className="lw-floorshadow" />
          <div className="lw-tilt">
            <div className="lw-cris">
              <div className="lw-halo" />
              <CrisOrb color="gold" mood={loop.mood} motion="lively" size={200} decorative className="lw-orb" />
            </div>
          </div>
        </div>
      </div>
      <div
        ref={bubbleRef}
        className={cn(
          "lw-bubble",
          sc.align === "right" && "lw-bubble-r",
          loop.travelling && "lw-moving",
          loop.line !== null && !hidden && "lw-on",
        )}
      >
        <span className="lw-ghost">{sc.line}</span>
        <span className="lw-typed">
          {shown}
          {loop.line !== null && !done && <span className="lw-caret" />}
        </span>
      </div>
    </div>
  );
}
