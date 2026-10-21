"use client";

// The stage beside the sign-in card (Task 10's blob style, from the owner's "Cris Login Redesign" artboard): a desk
// vignette inside a liquid blob, Cris in front with her gold-to-blue halo, the prop she works with flying between the
// desk and her side, her speech bubble, and the day log (area, task, six dots) underneath. Decorative: the whole
// column is aria-hidden (her lines are extras; every message that matters is in the card).
//
// Cris is the app's CrisOrb (gold), laid over the svg in stage units (the stage is 520 × 380, container-query units
// do the scaling). Her station, focus-mode spot and the props move with CSS transitions; only the blob reshapes per
// frame (useStageLoop).
import { forwardRef, type CSSProperties, type RefObject } from "react";
import { CrisOrb } from "@/components/cris/orb";
import { cn } from "@/lib/cn";
import type { CrisMood } from "@/lib/cris-mood";
import { ROOM_SVG } from "./room-svg";
import { BLOB_SHAPES, HOME, SCENES, propSide } from "./scenes";

export type BlobStageProps = {
  sceneIndex: number;
  /** Focus mode or signing in: the room and blob melt away and Cris stands beside the card. */
  focus: boolean;
  /** Cris's offset from home, in stage units. */
  station: [number, number];
  /** Seconds for her move to `station`. */
  moveSeconds: number;
  /** Which prop is at her side (none while she travels or in focus mode). */
  prop: "laptop" | "paper" | null;
  mood: CrisMood;
  still: boolean;
  /** Her eye's offset toward the caret (orb units), or null to let her mood drive it. */
  look: [number, number] | null;
  bubble: string | null;
  /** The day log's current scene is fading out. */
  fading: boolean;
  drops: RefObject<(SVGCircleElement | null)[]>;
  shades: RefObject<(SVGCircleElement | null)[]>;
  onTapCris: () => void;
  /** The signed-in sequence's flight to the middle of the screen. */
  style?: CSSProperties;
};

export const BlobStage = forwardRef<HTMLDivElement, BlobStageProps>(function BlobStage(
  { sceneIndex, focus, station, moveSeconds, prop, mood, still, look, bubble, fading, drops, shades, onTapCris, style },
  ref,
) {
  const scene = SCENES[sceneIndex]!;
  const [sx, sy] = station;
  // Props and the scan beam go to her side nearer the middle of the stage, at her scene's station.
  const st = scene.station;
  const side = propSide(st);
  const cx = HOME[0] + st[0];
  const cy = HOME[1] + st[1];
  const vars = {
    "--lw-sx": sx,
    "--lw-sy": sy,
    "--lw-tv": `${moveSeconds}s`,
  } as CSSProperties;
  const bodyStyle = look ? ({ "--cr-look": `${look[0].toFixed(1)}px ${look[1].toFixed(1)}px` } as CSSProperties) : undefined;
  const paperAt = prop === "paper";
  const laptopAt = prop === "laptop";

  return (
    <div ref={ref} className="lw-left" style={style} aria-hidden="true">
      <div className={cn("lw-stage", `lw-ph-${focus ? "focus" : scene.id}`)} style={vars}>
        <svg className="lw-scene-back" viewBox="0 0 520 380" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="lw-goo" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="9" />
              <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
            </filter>
            <filter id="lw-goo-shadow" x="-20%" y="-20%" width="140%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="9" />
              <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
              <feGaussianBlur stdDeviation="10" />
            </filter>
            <mask id="lw-blob" maskUnits="userSpaceOnUse" x="0" y="0" width="520" height="380">
              <g filter="url(#lw-goo)" fill="#FFFFFF">
                {BLOB_SHAPES[0]!.map(([x, y, r], i) => (
                  <circle
                    key={i}
                    ref={(el) => {
                      drops.current[i] = el;
                    }}
                    cx={x}
                    cy={y}
                    r={r}
                  />
                ))}
              </g>
            </mask>
            <clipPath id="lw-win">
              <rect x="76" y="146" width="62" height="52" />
            </clipPath>
          </defs>
          <g filter="url(#lw-goo-shadow)" className="lw-f-blobshadow lw-blobshade" transform="translate(0 14)">
            {BLOB_SHAPES[0]!.slice(0, 4).map(([x, y, r], i) => (
              <circle
                key={i}
                ref={(el) => {
                  shades.current[i] = el;
                }}
                cx={x}
                cy={y}
                r={r - 4}
              />
            ))}
          </g>
          <g mask="url(#lw-blob)" className="lw-blobfill">
            <rect className="lw-f-wall" x="-10" y="-10" width="540" height="410" />
            <g className="lw-room">
              <g className="lw-cam">
                <g dangerouslySetInnerHTML={{ __html: ROOM_SVG }} />
                <ellipse className="lw-f-shadow lw-cris-shadow" cx="222" cy="298" rx="60" ry="9" />
              </g>
            </g>
          </g>
        </svg>

        <div className="lw-cris" data-still={still || undefined} onClick={onTapCris}>
          <div className="lw-cris-in">
            <span className="lw-halo" />
            <div className="lw-cris-body" style={bodyStyle}>
              <CrisOrb color="gold" mood={mood} motion={still ? "still" : "lively"} size={200} decorative />
            </div>
          </div>
          <div className={cn("lw-bubble", bubble && "lw-on")}>{bubble}</div>
        </div>

        <svg className="lw-front lw-room" viewBox="0 0 520 380" preserveAspectRatio="xMidYMid meet">
          <line
            className="lw-pose lw-p-scan lw-beam"
            x1={cx + 33 * side}
            y1={cy + 8}
            x2={cx + 101 * side}
            y2={cy + 20}
            stroke="#8CD0FF"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <g
            className="lw-mv"
            style={{
              transform: paperAt
                ? `translate(${cx + 97 * side}px, ${cy + 26}px) rotate(${-2 - 8 * side}deg) scale(1, 1)`
                : "translate(408px, 247px) rotate(-2deg) scale(0.9, 0.18)",
            }}
          >
            <rect x="-23" y="-31" width="46" height="62" rx="1" fill="#FFFFFF" stroke="#b7c3d1" strokeWidth="1.5" />
            <rect x="-13" y="-21" width="26" height="3" rx="1" fill="#e4e7ec" />
            <rect x="-17" y="-11" width="34" height="2.5" rx="1" fill="#eef1f5" />
            <rect x="-17" y="-4" width="30" height="2.5" rx="1" fill="#eef1f5" />
            <rect x="-17" y="3" width="34" height="2.5" rx="1" fill="#eef1f5" />
            <rect x="-17" y="10" width="24" height="2.5" rx="1" fill="#eef1f5" />
          </g>
          <g
            className="lw-mv"
            style={{
              transform: laptopAt
                ? `translate(${cx + 103 * side}px, ${cy + 20}px) rotate(${-6 * side}deg) scale(1, 1)`
                : "translate(406px, 238px) rotate(0deg) scale(1, 0.22)",
            }}
          >
            <rect x="-21" y="-14" width="42" height="28" rx="3" fill="#c2ccd8" stroke="#8b98aa" strokeWidth="1.2" />
            <circle cx="0" cy="0" r="3.5" fill="#FFFFFF" opacity="0.8" />
            <rect x="-14" y="8" width="28" height="3" rx="1.5" fill="#FFFFFF" opacity="0.7" />
          </g>
        </svg>
      </div>

      <div className="lw-daylog">
        <div className={cn("lw-dl-area lw-swap", fading && "lw-out")}>{scene.area}</div>
        <p className={cn("lw-dl-task lw-swap", fading && "lw-out")}>{scene.task}</p>
        <div className="lw-dots">
          {SCENES.map((s, i) => (
            <span key={s.id} className={cn("lw-dot", i === sceneIndex && "lw-on")} />
          ))}
        </div>
      </div>
    </div>
  );
});
