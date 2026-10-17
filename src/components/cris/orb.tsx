// Cris's orb (spec §5): one SVG <symbol> per colour, drawn once per page by <CrisOrbDefs />,
// and <CrisOrb> which shows one through <use>. Ported from the CrisLooks mockup's gen_orb.py
// (itself the launch film's orbSvg, simplified for a still). The moods live in cris.css and
// reach the eye, core and HUD inside the <use> clone through inherited CSS custom properties.
import type { ReactElement } from "react";
import type { CrisColor, CrisMood, CrisMotion } from "@/lib/cris-mood";
import "./cris.css";

type Palette = {
  body: string[];
  lens: string[];
  iris: string[];
  core: string[];
  metal: string[];
  ring: string;
  acc: string;
  cool: string;
  icon: string;
  shade: string;
  under: string;
  rimEdge: string;
};

const PAL: Record<CrisColor, Palette> = {
  gold: {
    body: ["#FFFDF0", "#FFE7A0", "#FFC531", "#E08600", "#8A4600"],
    lens: ["#3D2600", "#160C00", "#060300"],
    iris: ["#FFFFFF", "#FFF1BF", "#FFB21E", "#5A3100", "#160C00", "#050300"],
    core: ["#FFFFFF", "#FFE48A", "#FFBE28"],
    metal: ["#FFF6D6", "#FFB800"],
    ring: "#FFC93C", acc: "#FFD45A", cool: "#BDF0FF", icon: "#FFF1C2", shade: "#4A2900", under: "#FFE7A0", rimEdge: "#FFFFFF",
  },
  sky: {
    body: ["#FFFFFF", "#D4F1FF", "#5FCBFF", "#1EA2EF", "#0A6FB8"],
    lens: ["#0A4E86", "#053259", "#021A31"],
    iris: ["#FFFFFF", "#E2F7FF", "#4CC6FF", "#0D6DB5", "#05345E", "#021A31"],
    core: ["#FFFFFF", "#CFF2FF", "#4CC6FF"],
    metal: ["#F2FCFF", "#29B6FF"],
    ring: "#4CC6FF", acc: "#9BE3FF", cool: "#E0FAFF", icon: "#F0FBFF", shade: "#0A4E86", under: "#D4F1FF", rimEdge: "#FFFFFF",
  },
  silver: {
    body: ["#FFFFFF", "#F4F6F9", "#D3D8DF", "#9AA2AE", "#5B636F"],
    lens: ["#2A3038", "#12161B", "#06080A"],
    iris: ["#FFFFFF", "#EEF1F5", "#B8C0CB", "#46505C", "#12161B", "#06080A"],
    core: ["#FFFFFF", "#F1F4F8", "#C6CDD6"],
    metal: ["#FFFFFF", "#A3ACB8"],
    ring: "#AEB6C2", acc: "#C9D0D9", cool: "#BDF0FF", icon: "#F8FAFC", shade: "#3B434E", under: "#FFFFFF", rimEdge: "#6B7380",
  },
};

/** Gradient id prefix per symbol; unique so "sky" and "silver" don't collide. */
const PREFIX: Record<CrisColor, string> = { gold: "crg", sky: "crk", silver: "crs" };
const COLORS: CrisColor[] = ["gold", "sky", "silver"];

/** The pod device icons: laptop, headset, monitor, mouse. */
const ICONS: ReactElement[] = [
  <>
    <rect x="5" y="6" width="14" height="9" rx="1.2" />
    <path d="M3 18h18" />
  </>,
  <>
    <path d="M5 14v-2a7 7 0 0 1 14 0v2" />
    <rect x="3.5" y="13" width="4" height="6" rx="1.5" />
    <rect x="16.5" y="13" width="4" height="6" rx="1.5" />
  </>,
  <>
    <rect x="3.5" y="4.5" width="17" height="11" rx="1.2" />
    <path d="M9 20h6M12 15.5V20" />
  </>,
  <>
    <rect x="7.5" y="3.5" width="9" height="16" rx="4.5" />
    <path d="M12 7v3" />
  </>,
];

const RINGS = [
  { rx: 262, ry: 62, tilt: -16, pods: [0.4, Math.PI + 0.4] },
  { rx: 250, ry: 56, tilt: 22, pods: [1.9] },
  { rx: 240, ry: 50, tilt: -48, pods: [4.2] },
];

// Fixed precision keeps the server and client markup identical.
const f1 = (n: number) => n.toFixed(1);
const p2 = (r: number, a: number) => `${f1(r * Math.cos(a))} ${f1(r * Math.sin(a))}`;
const rad = (deg: number) => (deg * Math.PI) / 180;

function Arc({ r, a0, a1, w, c, o = 1 }: { r: number; a0: number; a1: number; w: number; c: string; o?: number }) {
  const d = `M ${p2(r, rad(a0))} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p2(r, rad(a1))}`;
  return <path d={d} fill="none" stroke={c} strokeWidth={w} opacity={o} strokeLinecap="round" />;
}

function OrbSymbol({ color }: { color: CrisColor }) {
  const P = PAL[color];
  const i = PREFIX[color];
  const [b, l, ir, c, m] = [P.body, P.lens, P.iris, P.core, P.metal];
  const url = (s: string) => `url(#${i}${s})`;

  const back: ReactElement[] = [];
  const front: ReactElement[] = [];
  let pi = 0;
  RINGS.forEach((g, gi) => {
    const tr = `rotate(${g.tilt})`;
    back.push(
      <g key={`r${gi}`} transform={tr}>
        <ellipse rx={g.rx} ry={g.ry} fill="none" stroke={P.ring} strokeWidth={4} opacity={0.5} />
        <ellipse rx={g.rx + 10} ry={g.ry + 4} fill="none" stroke={P.cool} strokeWidth={1.2} strokeDasharray="2 12" opacity={0.55} />
      </g>,
    );
    front.push(
      <g key={`r${gi}`} transform={tr}>
        <path d={`M ${-g.rx} 0 A ${g.rx} ${g.ry} 0 0 0 ${g.rx} 0`} fill="none" stroke={url("m")} strokeWidth={5} />
      </g>,
    );
    const t = rad(g.tilt);
    for (const a of g.pods) {
      const lx = g.rx * Math.cos(a);
      const ly = g.ry * Math.sin(a);
      const X = lx * Math.cos(t) - ly * Math.sin(t);
      const Y = lx * Math.sin(t) + ly * Math.cos(t);
      const pod = (
        <g key={`p${pi}`} transform={`translate(${f1(X)} ${f1(Y)})`}>
          <circle r={30} fill={url("p")} />
          <circle r={24} fill={url("l")} stroke={url("m")} strokeWidth={4} />
          <g
            transform="translate(-12.5 -12.5) scale(1.04)"
            fill="none"
            stroke={P.icon}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {ICONS[pi % 4]}
          </g>
        </g>
      );
      (Math.sin(a) > 0 ? front : back).push(pod);
      pi += 1;
    }
  });

  return (
    <symbol id={`cris-${color}`} viewBox="-300 -300 600 600">
      <defs>
        <radialGradient id={`${i}g`} cx=".38" cy=".32" r=".75">
          <stop offset="0" stopColor={b[0]} stopOpacity=".85" />
          <stop offset=".25" stopColor={b[1]} stopOpacity=".6" />
          <stop offset=".6" stopColor={b[2]} stopOpacity=".55" />
          <stop offset=".86" stopColor={b[3]} stopOpacity=".8" />
          <stop offset="1" stopColor={b[4]} stopOpacity=".97" />
        </radialGradient>
        <radialGradient id={`${i}l`} cx=".5" cy=".45" r=".6">
          <stop offset="0" stopColor={l[0]} />
          <stop offset=".7" stopColor={l[1]} />
          <stop offset="1" stopColor={l[2]} />
        </radialGradient>
        <radialGradient id={`${i}i`}>
          <stop offset="0" stopColor={ir[0]} />
          <stop offset=".1" stopColor={ir[1]} />
          <stop offset=".26" stopColor={ir[2]} />
          <stop offset=".5" stopColor={ir[3]} />
          <stop offset=".82" stopColor={ir[4]} />
          <stop offset="1" stopColor={ir[5]} />
        </radialGradient>
        <radialGradient id={`${i}c`}>
          <stop offset="0" stopColor={c[0]} />
          <stop offset=".35" stopColor={c[1]} />
          <stop offset="1" stopColor={c[2]} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${i}p`}>
          <stop offset=".5" stopColor={P.ring} stopOpacity=".55" />
          <stop offset="1" stopColor={P.ring} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${i}m`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={m[0]} />
          <stop offset=".5" stopColor={m[1]} />
          <stop offset="1" stopColor={m[0]} />
        </linearGradient>
        <linearGradient id={`${i}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.rimEdge} stopOpacity=".95" />
          <stop offset=".5" stopColor={P.acc} stopOpacity=".4" />
          <stop offset="1" stopColor={P.cool} stopOpacity=".85" />
        </linearGradient>
      </defs>
      <g>{back}</g>
      <g>
        <circle r={172} fill={url("g")} />
        <ellipse cy={96} rx={122} ry={48} fill={P.under} opacity={0.28} />
        <circle r={168} fill="none" stroke={url("r")} strokeWidth={7} />
        <g className="cr-spin-r">
          {[20, 110, 200, 290].map((a) => (
            <g key={a}>
              <Arc r={194} a0={a} a1={a + 52} w={9} c={url("m")} o={0.85} />
              <Arc r={203} a0={a + 4} a1={a + 48} w={1.5} c={P.cool} o={0.6} />
            </g>
          ))}
        </g>
        <g className="cr-eye">
          <circle r={128} fill={P.shade} opacity={0.38} />
          <circle r={120} fill={url("i")} stroke={url("m")} strokeWidth={9} />
          <g className="cr-spin">
            <circle r={107} fill="none" stroke={P.ring} strokeWidth={2} strokeDasharray="4 7" />
            <Arc r={96} a0={-150} a1={-100} w={6} c={P.acc} />
            <Arc r={96} a0={-30} a1={10} w={6} c={P.acc} />
            <Arc r={96} a0={60} a1={130} w={6} c={P.acc} o={0.7} />
          </g>
          <g className="cr-spin-r">
            <circle r={82} fill="none" stroke={m[1]} strokeWidth={9} strokeDasharray="2 9" opacity={0.7} />
            <circle r={72} fill="none" stroke={P.cool} strokeWidth={1.5} opacity={0.7} />
          </g>
          <g opacity={0.55} stroke={P.icon} strokeWidth={1.6}>
            <line x1={-116} x2={116} />
            <line y1={-116} y2={116} />
          </g>
          <g className="cr-spin-f">
            <circle r={56} fill="none" stroke={P.acc} strokeWidth={5} strokeDasharray="66 22" />
          </g>
          <circle className="cr-core" r={52} fill={url("c")} />
          <path d="M0 -44 Q 6 -6 44 0 Q 6 6 0 44 Q -6 6 -44 0 Q -6 -6 0 -44 Z" fill="#FFFFFF" />
        </g>
        <ellipse cx={-66} cy={-104} rx={70} ry={28} fill="#FFFFFF" opacity={0.5} transform="rotate(-32 -66 -104)" />
        <ellipse cx={-104} cy={-40} rx={10} ry={26} fill="#FFFFFF" opacity={0.28} transform="rotate(20 -104 -40)" />
        <ellipse cx={92} cy={112} rx={34} ry={12} fill="#FFFFFF" opacity={0.22} transform="rotate(-38 92 112)" />
      </g>
      <g>{front}</g>
    </symbol>
  );
}

/** The three orb symbols (#cris-gold, #cris-sky, #cris-silver). Render exactly once per page. */
export function CrisOrbDefs() {
  return (
    <svg
      className="cr-defs"
      aria-hidden="true"
      width={0}
      height={0}
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      {COLORS.map((c) => (
        <OrbSymbol key={c} color={c} />
      ))}
    </svg>
  );
}

/**
 * Cris, in one colour and mood. Needs <CrisOrbDefs /> somewhere on the page.
 * Motion: "lively" plays the mood, "calm" only the slow float, "still" nothing;
 * prefers-reduced-motion always stops everything (cris.css).
 */
export function CrisOrb({
  color,
  mood,
  motion,
  size,
  label,
  className,
  decorative = false,
}: {
  color: CrisColor;
  mood: CrisMood;
  motion: CrisMotion;
  size: number;
  label?: string;
  className?: string;
  /** True when something nearby already names Cris (e.g. inside a labelled button): hidden from assistive tech. */
  decorative?: boolean;
}) {
  const cls = `cris-orb m-${mood} cr-${motion}${className ? ` ${className}` : ""}`;
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": label ?? "Cris" } as const);
  return (
    <span className={cls}>
      <svg className="cr-orb" {...a11y} width={size} height={size} viewBox="-300 -300 600 600">
        {/* Explicit viewport so the symbol's centred viewBox lines up with this one. */}
        <use href={`#cris-${color}`} x={-300} y={-300} width={600} height={600} />
      </svg>
    </span>
  );
}
