"use client";

// "Cris at Work" (Phase 47 Task 10, owner request 2026-10-21): the owner's Design Component, ported as the Disposal
// page's body. The SVG and its CSS are the source's (classes prefixed caw-, see cris-at-work.css), and so are the
// phases, the words and the timing; the pure parts of its script live in cris-at-work-logic.ts. What changed:
//   - ids are per instance (useId), so two scenes never share a filter, mask, clip or gradient;
//   - the theme follows the app (<html data-theme>, watched), not a prop; the source's other props keep their defaults
//     (pace 6 s, motion lively, scene loop);
//   - reduced motion: the CSS stops every animation and transition, the phase cycle never starts (reading stays up),
//     and the frame loop draws one still frame;
//   - nothing runs while the tab is hidden, and everything stops on unmount;
//   - it scales down with the screen (the svg fills its box; the bubble is sized in container units).
// The changing "Cris is …" line is deliberately plain text, not a live region: it changes every few seconds.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { CAW_MOODS, blobAt, cawShown, createPhaseCycle, moodAt, ringOf, type CawMood, type MoodFrame } from "./cris-at-work-logic";
import "./cris-at-work.css";

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const readTheme = (): "light" | "dark" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
/** On the server (and while hydrating) the scene carries no theme of its own; the CSS reads <html data-theme>. */
const serverTheme = () => undefined;

const ease = (q: number) => q * q * (3 - 2 * q);

export function CrisAtWork() {
  const reduced = useReducedMotion();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const uid = `caw-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const id = (s: string) => `${uid}-${s}`;
  const url = (s: string) => `url(#${id(s)})`;

  const [cycle, setCycle] = useState({ step: 0, fading: false });
  const { task, quote } = cawShown(cycle.step, reduced);
  // A fade cut short by reduced motion switching on must not leave the words invisible.
  const fadeCls = cycle.fading && !reduced ? " is-out" : "";

  const stageRef = useRef<SVGSVGElement>(null);
  const orbRef = useRef<SVGGElement>(null);
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  // The phase cycle (the source's start()/tick()), paused while the tab is hidden.
  useEffect(() => {
    const c = createPhaseCycle({
      reduced,
      onFadeOut: () => setCycle((s) => ({ ...s, fading: true })),
      onNext: () => setCycle((s) => ({ step: s.step + 1, fading: false })),
    });
    const onVisibility = () => (document.visibilityState === "hidden" ? c.pause() : c.resume());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      c.stop();
    };
  }, [reduced]);

  // The frame loop (the source's frame()): Cris's mood, her rings and pods, the props travelling between the desk and
  // her, and the liquid frame, set straight on the DOM as the source does. Under reduced motion it draws one still
  // frame and stops; while the tab is hidden it does not run.
  useEffect(() => {
    const stage = stageRef.current;
    const orb = orbRef.current;
    if (!stage || !orb) return;
    const parts = {
      a: orb.querySelectorAll<SVGGElement>(".caw-cr-spin"),
      b: orb.querySelectorAll<SVGGElement>(".caw-cr-spin-r"),
      c: orb.querySelectorAll<SVGGElement>(".caw-cr-spin-f"),
      eye: orb.querySelector<SVGGElement>(".caw-cr-eye"),
      core: orb.querySelector<SVGCircleElement>(".caw-cr-core"),
      pods: orb.querySelectorAll<SVGGElement>(".caw-pod"),
    };
    const movers = { paper: stage.querySelector<SVGGElement>(".caw-mv-paper"), mug: stage.querySelector<SVGGElement>(".caw-mv-mug") };
    const drops = stage.querySelectorAll<SVGCircleElement>(".caw-drop");
    const still = reduced;
    let t = 0;
    const spin = { a: 0, b: 0, c: 0, o: 0 };
    const w: Record<CawMood, number> = { think: 1, cross: 0, search: 0, idle: 0, sad: 0 };
    const pp = { paper: 0, mug: 0 };
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = 0;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (!still) t += dt;
      const current = taskRef.current;
      const target = current.mood;
      const k = 1 - Math.exp(-dt / 0.5);
      const v: MoodFrame = { x: 0, y: 0, r: 0, glow: 0, ex: 0, ey: 0, sy: 0, cs: 0, co: 0, va: 0, vb: 0, vc: 0, vo: 0, sc: 0 };
      for (const m of CAW_MOODS) {
        w[m] += ((m === target ? 1 : 0) - w[m]) * k;
        const f = moodAt(m, t);
        for (const key of Object.keys(v) as (keyof MoodFrame)[]) v[key] += w[m] * f[key];
      }
      if (still) Object.assign(v, { x: 0, y: 0, r: 0, glow: 0, ex: 0, ey: 0, sy: 1, cs: 1, co: 1, va: 0, vb: 0, vc: 0, vo: 0, sc: 1 });
      // Props travel between the desk and Cris. One goes back before the next comes out, and Cris leans toward the
      // desk while she fetches or returns one.
      const need = { paper: current.key === "reading", mug: current.key === "coffee" };
      let lean = 0;
      for (const n of ["paper", "mug"] as const) {
        const other = (Object.keys(pp) as (keyof typeof pp)[]).some((o) => o !== n && pp[o] > 0.02);
        const goal = need[n] && !other ? 1 : 0;
        if (still) pp[n] = goal;
        else pp[n] += Math.sign(goal - pp[n]) * Math.min(Math.abs(goal - pp[n]), dt / 1.3);
        lean += Math.sin(Math.PI * ease(pp[n]));
      }
      lean = Math.min(1, lean);
      v.x += 22 * lean;
      v.y += 6 * lean;
      v.r += 6 * lean;
      spin.a += v.va * dt;
      spin.b += v.vb * dt;
      spin.c += v.vc * dt;
      spin.o += v.vo * dt;

      orb.style.transform = `translate(${v.x.toFixed(2)}px,${v.y.toFixed(2)}px) rotate(${v.r.toFixed(2)}deg) scale(${v.sc.toFixed(3)})`;
      const sad = still && target === "sad" ? 1 : w.sad;
      const fx: string[] = [];
      if (sad > 0.02) fx.push(`saturate(${(1 - 0.8 * sad).toFixed(2)}) brightness(${(1 - 0.22 * sad).toFixed(2)})`);
      if (v.glow > 0.02) fx.push(`drop-shadow(0 0 ${(14 * v.glow).toFixed(1)}px rgba(217,45,32,${(0.75 * v.glow).toFixed(2)}))`);
      orb.style.filter = fx.length ? fx.join(" ") : "none";
      parts.a.forEach((el) => {
        el.style.transform = `rotate(${spin.a.toFixed(1)}deg)`;
      });
      parts.b.forEach((el) => {
        el.style.transform = `rotate(${spin.b.toFixed(1)}deg)`;
      });
      parts.c.forEach((el) => {
        el.style.transform = `rotate(${spin.c.toFixed(1)}deg)`;
      });
      if (parts.eye) parts.eye.style.transform = `translate(${v.ex.toFixed(1)}px,${v.ey.toFixed(1)}px) scale(1,${v.sy.toFixed(3)})`;
      // The device pods ride their rings; each is drawn twice, behind and in front of the body, and only the copy on
      // the near side of its ring shows, so it passes behind Cris and back.
      parts.pods.forEach((el) => {
        const g = ringOf(Number(el.getAttribute("data-p")));
        const a = g.a + spin.o;
        const tilt = (g.tilt * Math.PI) / 180;
        const lx = g.rx * Math.cos(a);
        const ly = g.ry * Math.sin(a);
        el.setAttribute(
          "transform",
          `translate(${(lx * Math.cos(tilt) - ly * Math.sin(tilt)).toFixed(1)} ${(lx * Math.sin(tilt) + ly * Math.cos(tilt)).toFixed(1)})`,
        );
        el.setAttribute("opacity", Math.sin(a) > 0 === (el.getAttribute("data-layer") === "front") ? "1" : "0");
      });
      if (parts.core) {
        parts.core.style.transform = `scale(${v.cs.toFixed(3)})`;
        parts.core.style.opacity = v.co.toFixed(2);
      }

      const ep = ease(pp.paper);
      const em = ease(pp.mug);
      const bob = still ? 0 : Math.sin((Math.PI * 2 * t) / 2.6);
      if (movers.paper) {
        // Off the stack, standing up as it rises, into Cris's reading spot; and back down flat.
        const x = 408 - 96 * ep;
        const y = 247 + 21 * ep - 46 * Math.sin(Math.PI * ep) + 1.5 * bob * ep;
        movers.paper.setAttribute(
          "transform",
          `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(-2 - 8 * ep).toFixed(1)}) scale(${(0.9 + 0.1 * ep).toFixed(3)} ${(0.18 + 0.82 * ep).toFixed(3)})`,
        );
      }
      if (movers.mug) {
        // Up off the desk in an arc to Cris's side, where it tips toward her for a sip now and then.
        const sip = still ? 0 : Math.max(0, (em - 0.85) / 0.15) * (0.5 - 0.5 * Math.cos((Math.PI * 2 * t) / 4));
        const x = 407 - 271 * em;
        const y = 225 + 11 * em - 64 * Math.sin(Math.PI * em) + 1.5 * bob * em;
        movers.mug.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(22 * sip).toFixed(1)})`);
      }
      if (!still) {
        drops.forEach((el) => {
          const b = blobAt(el.getAttribute("data-k") ?? "", t);
          if (!b) return;
          const dr = Number(el.getAttribute("data-dr") || 0);
          el.setAttribute("cx", b.x.toFixed(1));
          el.setAttribute("cy", b.y.toFixed(1));
          el.setAttribute("r", Math.max(1, b.r + dr).toFixed(1));
        });
        if (document.visibilityState !== "hidden") raf = requestAnimationFrame(frame);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf && !still) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return (
    <div className="caw" data-theme={theme}>
      <div className={`caw-stage caw-ph-${task.key}`}>
        <svg ref={stageRef} viewBox="0 0 520 380" role="img" aria-label="Cris, the gold orb, at her desk inside a softly moving liquid shape, working through coding, debugging, reading and a coffee break" className="caw-svg">
        <defs>
        <filter id={id("goo")} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="9" />
        <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
        </filter>
        <filter id={id("gooShadow")} x="-20%" y="-20%" width="140%" height="160%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="9" />
        <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
        <feGaussianBlur stdDeviation="10" />
        </filter>
        <mask id={id("blob")} maskUnits="userSpaceOnUse" x="0" y="0" width="520" height="380">
        <g filter={url("goo")} fill="#FFFFFF">
        <circle className="caw-drop" data-k="d1" cx="165" cy="215" r="112" />
        <circle className="caw-drop" data-k="d2" cx="300" cy="165" r="75" />
        <circle className="caw-drop" data-k="d3" cx="335" cy="265" r="85" />
        <circle className="caw-drop" data-k="d4" cx="252" cy="236" r="92" />
        <circle className="caw-drop" data-k="s1" cx="240" cy="73" r="17" />
        <circle className="caw-drop" data-k="s2" cx="424" cy="178" r="28" />
        <circle className="caw-drop" data-k="s3" cx="234" cy="341" r="12" />
        <circle className="caw-drop" data-k="s4" cx="96" cy="96" r="10" />
        <circle className="caw-drop" data-k="s5" cx="470" cy="250" r="10" />
        </g>
        </mask>
        <clipPath id={id("scr")}><rect x="104" y="140" width="140" height="88" /></clipPath>
        <clipPath id={id("win")}><rect x="76" y="146" width="62" height="52" /></clipPath>
        <radialGradient id={id("crHalo")}><stop offset="0" stopColor="#FFC846" stopOpacity=".5" /><stop offset=".26" stopColor="#FFC846" stopOpacity=".5" /><stop offset=".4" stopColor="#FFBE3C" stopOpacity=".18" /><stop offset=".54" stopColor="#8CD0FF" stopOpacity=".32" /><stop offset=".7" stopColor="#8CD0FF" stopOpacity="0" /></radialGradient>
        <radialGradient id={id("crgg")} cx=".38" cy=".32" r=".75"><stop offset="0" stopColor="#FFFDF0" stopOpacity=".85" /><stop offset=".25" stopColor="#FFE7A0" stopOpacity=".6" /><stop offset=".6" stopColor="#FFC531" stopOpacity=".55" /><stop offset=".86" stopColor="#E08600" stopOpacity=".8" /><stop offset="1" stopColor="#8A4600" stopOpacity=".97" /></radialGradient>
        <radialGradient id={id("crgi")}><stop offset="0" stopColor="#FFFFFF" /><stop offset=".1" stopColor="#FFF1BF" /><stop offset=".26" stopColor="#FFB21E" /><stop offset=".5" stopColor="#5A3100" /><stop offset=".82" stopColor="#160C00" /><stop offset="1" stopColor="#050300" /></radialGradient>
        <radialGradient id={id("crgc")}><stop offset="0" stopColor="#FFFFFF" /><stop offset=".35" stopColor="#FFE48A" /><stop offset="1" stopColor="#FFBE28" stopOpacity="0" /></radialGradient>
        <linearGradient id={id("crgr")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".95" /><stop offset=".5" stopColor="#FFD45A" stopOpacity=".4" /><stop offset="1" stopColor="#BDF0FF" stopOpacity=".85" /></linearGradient>
        <radialGradient id={id("crgl")} cx=".5" cy=".45" r=".6"><stop offset="0" stopColor="#3D2600" /><stop offset=".7" stopColor="#160C00" /><stop offset="1" stopColor="#060300" /></radialGradient>
        <radialGradient id={id("crgp")}><stop offset=".5" stopColor="#FFC93C" stopOpacity=".55" /><stop offset="1" stopColor="#FFC93C" stopOpacity="0" /></radialGradient>
        <linearGradient id={id("crgm")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF6D6" /><stop offset=".5" stopColor="#FFB800" /><stop offset="1" stopColor="#FFF6D6" /></linearGradient>
        <radialGradient id={id("screenGlow")}><stop offset="0" stopColor="#FFFFFF" stopOpacity=".55" /><stop offset="1" stopColor="#FFFFFF" stopOpacity="0" /></radialGradient>
        </defs>

        <g filter={url("gooShadow")} className="caw-f-blobshadow" transform="translate(0 14)">
        <circle className="caw-drop" data-k="d1" data-dr="-4" cx="165" cy="215" r="108" />
        <circle className="caw-drop" data-k="d2" data-dr="-4" cx="300" cy="165" r="71" />
        <circle className="caw-drop" data-k="d3" data-dr="-4" cx="335" cy="265" r="81" />
        <circle className="caw-drop" data-k="d4" data-dr="-4" cx="252" cy="236" r="88" />
        </g>

        <g mask={url("blob")}>
        <g className="caw-cam">
        <rect className="caw-f-wall" x="-10" y="-10" width="540" height="246" />
        <rect className="caw-f-wall2" x="-10" y="198" width="540" height="26" />

        <rect className="caw-f-furntop caw-s-edge" x="70" y="140" width="74" height="64" rx="3" strokeWidth="2" />
        <rect className="caw-f-sky" x="76" y="146" width="62" height="52" />
        <g clipPath={url("win")}>
        <g className="caw-only-light"><g className="caw-cloud"><ellipse cx="96" cy="164" rx="12" ry="5" fill="#FFFFFF" /><ellipse cx="104" cy="160" rx="8" ry="6" fill="#FFFFFF" /></g></g>
        <g className="caw-only-dark"><circle cx="124" cy="160" r="6" fill="#dfe4eb" /><circle className="caw-f-sky" cx="127" cy="157" r="5" /><circle cx="88" cy="156" r="1.2" fill="#dfe4eb" /><circle cx="104" cy="168" r="1" fill="#dfe4eb" /></g>
        <rect className="caw-f-outside" x="76" y="180" width="12" height="18" />
        <rect className="caw-f-outside" x="88" y="172" width="10" height="26" />
        <rect className="caw-f-outside" x="98" y="184" width="14" height="14" />
        <rect className="caw-f-outside" x="112" y="176" width="12" height="22" />
        <rect className="caw-f-outside" x="124" y="186" width="14" height="12" />
        </g>
        <rect className="caw-f-furntop" x="105" y="146" width="3" height="52" />

        <g transform="rotate(-3 422 176)">
        <rect x="404" y="158" width="26" height="24" rx="2" fill="#fef0c7" />
        <rect x="408" y="165" width="16" height="2.5" fill="#93370d" />
        <rect x="408" y="171" width="12" height="2.5" fill="#93370d" />
        </g>
        <g transform="rotate(4 440 192)">
        <rect x="428" y="180" width="24" height="22" rx="2" fill="#eff6fc" />
        <rect x="432" y="187" width="15" height="2.5" fill="#1d4e87" />
        <rect x="432" y="193" width="11" height="2.5" fill="#1d4e87" />
        </g>

        <g className="caw-lamp-sway">
        <line className="caw-s-metal" x1="200" y1="0" x2="200" y2="112" strokeWidth="2" />
        <polygon className="caw-cone" points="186,128 214,128 250,224 150,224" />
        <polygon className="caw-f-lamp" points="190,112 210,112 218,128 182,128" />
        <ellipse className="caw-f-bulb" cx="200" cy="129" rx="8" ry="2.5" />
        </g>

        <ellipse className="caw-glow" cx="322" cy="168" rx="92" ry="62" fill="#6aa9e0" opacity="0.22" />

        <rect className="caw-f-metal" x="318" y="206" width="8" height="18" />
        <rect className="caw-f-metal" x="302" y="221" width="40" height="4" rx="2" />
        <rect className="caw-f-bezel" x="256" y="122" width="132" height="87" rx="6" />
        <svg x="262" y="128" width="120" height="75.4" viewBox="104 140 140 88">
        <rect x="104" y="140" width="140" height="88" rx="2" fill="#0f1720" />
        <g className="caw-pose caw-p-coding" clipPath={url("scr")}>
        <rect x="104" y="140" width="8" height="88" fill="#171f2b" />
        <g className="caw-code-scroll">
        <rect x="118" y="146" width="46" height="4" rx="1" fill="#6aa9e0" />
        <rect x="168" y="146" width="30" height="4" rx="1" fill="#c7cdd8" />
        <rect x="126" y="155" width="60" height="4" rx="1" fill="#c7cdd8" />
        <rect x="126" y="164" width="34" height="4" rx="1" fill="#e7b168" />
        <rect x="164" y="164" width="40" height="4" rx="1" fill="#c7cdd8" />
        <rect x="134" y="173" width="72" height="4" rx="1" fill="#c7cdd8" />
        <rect x="134" y="182" width="40" height="4" rx="1" fill="#75e0a7" />
        <rect x="126" y="191" width="20" height="4" rx="1" fill="#c7cdd8" />
        <rect x="118" y="200" width="12" height="4" rx="1" fill="#c7cdd8" />
        <rect x="118" y="209" width="54" height="4" rx="1" fill="#6aa9e0" />
        <rect x="126" y="218" width="66" height="4" rx="1" fill="#c7cdd8" />
        <rect x="118" y="227" width="46" height="4" rx="1" fill="#6aa9e0" />
        <rect x="168" y="227" width="30" height="4" rx="1" fill="#c7cdd8" />
        <rect x="126" y="236" width="60" height="4" rx="1" fill="#c7cdd8" />
        <rect x="126" y="245" width="34" height="4" rx="1" fill="#e7b168" />
        <rect x="164" y="245" width="40" height="4" rx="1" fill="#c7cdd8" />
        <rect x="134" y="254" width="72" height="4" rx="1" fill="#c7cdd8" />
        <rect x="134" y="263" width="40" height="4" rx="1" fill="#75e0a7" />
        <rect x="126" y="272" width="20" height="4" rx="1" fill="#c7cdd8" />
        <rect x="118" y="281" width="12" height="4" rx="1" fill="#c7cdd8" />
        <rect x="118" y="290" width="54" height="4" rx="1" fill="#6aa9e0" />
        <rect x="126" y="299" width="66" height="4" rx="1" fill="#c7cdd8" />
        </g>
        <rect className="caw-blink" x="200" y="216" width="3" height="8" fill="#6aa9e0" />
        </g>
        <g className="caw-pose caw-p-error">
        <rect x="104" y="140" width="140" height="88" rx="2" fill="#fef3f2" />
        <rect className="caw-err-bar" x="104" y="140" width="140" height="16" fill="#d92d20" />
        <text className="caw-mono" x="112" y="151" fontSize="8" fontWeight="500" fill="#FFFFFF" letterSpacing="0.8">ERROR</text>
        <text className="caw-mono" x="112" y="172" fontSize="7.5" fill="#b42318">TypeError: value</text>
        <text className="caw-mono" x="112" y="183" fontSize="7.5" fill="#b42318">is undefined</text>
        <text className="caw-mono" x="112" y="204" fontSize="6.5" fill="#667085">at feature.ts:128</text>
        <rect x="112" y="210" width="44" height="10" rx="5" fill="#fecdca" />
        <text className="caw-mono" x="134" y="217.5" fontSize="5.5" fill="#b42318" textAnchor="middle">1 FAILING</text>
        </g>
        <g className="caw-pose caw-p-reading">
        <rect x="104" y="140" width="140" height="88" rx="2" fill="#FFFFFF" />
        <rect x="104" y="140" width="140" height="12" fill="#f2f4f7" />
        <circle cx="110" cy="146" r="2" fill="#d0d5dd" />
        <circle cx="117" cy="146" r="2" fill="#d0d5dd" />
        <rect x="114" y="160" width="70" height="6" rx="1" fill="#101828" />
        <rect x="114" y="172" width="110" height="3" rx="1" fill="#d0d5dd" />
        <rect x="114" y="180" width="96" height="3" rx="1" fill="#d0d5dd" />
        <rect x="112" y="186" width="94" height="7" rx="1" fill="#fef0c7" />
        <rect x="114" y="188" width="90" height="3" rx="1" fill="#475467" />
        <rect x="114" y="199" width="80" height="3" rx="1" fill="#d0d5dd" />
        <rect x="114" y="207" width="100" height="3" rx="1" fill="#d0d5dd" />
        <rect x="114" y="215" width="70" height="3" rx="1" fill="#d0d5dd" />
        </g>
        <g className="caw-pose caw-p-coffee">
        <rect x="104" y="140" width="140" height="88" rx="2" fill="#FFFFFF" />
        <circle cx="174" cy="170" r="11" fill="#dcfae6" />
        <path d="M169 170 L172.5 173.5 L179 166.5" stroke="#16a34a" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text className="caw-svgt" x="174" y="198" fontSize="10" fontWeight="600" fill="#101828" textAnchor="middle">All tests passing</text>
        <text className="caw-mono" x="174" y="212" fontSize="6.5" fill="#667085" textAnchor="middle">0 failing</text>
        </g>
        <g className="caw-pose caw-p-limit">
        <rect x="104" y="140" width="140" height="88" rx="2" fill="#FFFFFF" />
        <circle cx="174" cy="166" r="11" fill="#fef0c7" />
        <path d="M174 160 V167" stroke="#b54708" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="174" cy="171.5" r="1.4" fill="#b54708" />
        <text className="caw-svgt" x="174" y="194" fontSize="9.5" fontWeight="600" fill="#101828" textAnchor="middle">Usage limit reached</text>
        <text className="caw-mono" x="174" y="208" fontSize="6.5" fill="#667085" textAnchor="middle">Claude · try again later</text>
        </g>
        </svg>

        <rect className="caw-f-desk" x="-10" y="224" width="540" height="170" />
        <rect className="caw-f-edge" x="-10" y="222" width="540" height="3" />
        <g className="caw-plant">
        <ellipse className="caw-f-leaf" cx="94" cy="196" rx="6" ry="20" />
        <ellipse className="caw-f-leaf" cx="84" cy="204" rx="4" ry="14" transform="rotate(-28 84 204)" />
        <ellipse className="caw-f-leaf" cx="104" cy="204" rx="4" ry="14" transform="rotate(28 104 204)" />
        </g>
        <rect className="caw-f-furn2 caw-s-edge" x="83" y="214" width="22" height="18" rx="2" strokeWidth="1.2" />

        <rect className="caw-f-furn2 caw-s-edge" x="292" y="236" width="84" height="12" rx="2" strokeWidth="1" />
        <g className="caw-keys">
        <rect className="caw-key caw-f-metal2" x="297" y="239" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="307" y="239" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="317" y="239" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="327" y="239" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="337" y="239" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="347" y="239" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="357" y="239" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="302" y="243" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="312" y="243" width="30" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="345" y="243" width="7" height="2.5" />
        <rect className="caw-key caw-f-metal2" x="355" y="243" width="7" height="2.5" />
        </g>
        <rect x="378" y="252" width="56" height="9" rx="1" fill="#FFFFFF" stroke="#b7c3d1" strokeWidth="1" transform="rotate(-4 406 256)" />
        <rect x="382" y="246" width="52" height="8" rx="1" fill="#FFFFFF" stroke="#b7c3d1" strokeWidth="1" transform="rotate(3 408 250)" />
        <ellipse className="caw-f-shadow" cx="222" cy="298" rx="60" ry="9" />

        <g className="caw-prop caw-p-coding"><g className="caw-chip-rise">
        <rect x="268" y="212" width="40" height="18" rx="9" fill="#eff6fc" stroke="#cfe2f4" strokeWidth="1" />
        <text className="caw-mono" x="288" y="224.5" fontSize="9" fontWeight="500" fill="#1d4e87" textAnchor="middle">{"</>"}</text>
        </g></g>
        <g className="caw-prop caw-p-error"><g className="caw-alarm">
        <text className="caw-svgt" x="394" y="124" fontSize="22" fontWeight="700" fill="#d92d20">!</text>
        <text className="caw-svgt" x="406" y="108" fontSize="16" fontWeight="700" fill="#d92d20">!</text>
        <text className="caw-svgt caw-f-ink" x="148" y="196" fontSize="18" fontWeight="700">?</text>
        </g></g>

        <rect className="caw-dim" x="-10" y="-10" width="540" height="410" fill="#0b1220" opacity="0" />
        <circle className="caw-halo-c" cx="215" cy="242" r="118" fill={url("crHalo")} opacity="0.9" />
        <g className="caw-orb-move" ref={orbRef}>
        <svg x="115" y="142" width="200" height="200" viewBox="-300 -300 600 600" overflow="visible">
        <g>
        <g transform="rotate(-16)"><ellipse rx="262" ry="62" fill="none" stroke="#FFC93C" strokeWidth="4" opacity="0.5" /><ellipse rx="272" ry="66" fill="none" stroke="#BDF0FF" strokeWidth="1.2" strokeDasharray="2 12" opacity="0.55" /></g>
        <g transform="rotate(22)"><ellipse rx="250" ry="56" fill="none" stroke="#FFC93C" strokeWidth="4" opacity="0.5" /><ellipse rx="260" ry="60" fill="none" stroke="#BDF0FF" strokeWidth="1.2" strokeDasharray="2 12" opacity="0.55" /></g>
        <g transform="rotate(-48)"><ellipse rx="240" ry="50" fill="none" stroke="#FFC93C" strokeWidth="4" opacity="0.5" /><ellipse rx="250" ry="54" fill="none" stroke="#BDF0FF" strokeWidth="1.2" strokeDasharray="2 12" opacity="0.55" /></g>
        <g className="caw-pod" data-p="0" data-layer="back" transform="translate(238.6 -43.3)" opacity="0"><circle r="30" fill={url("crgp")} /><circle r="24" fill={url("crgl")} stroke={url("crgm")} strokeWidth="4" /><g transform="translate(-12.5 -12.5) scale(1.04)" fill="none" stroke="#FFF1C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="6" width="14" height="9" rx="1.2" /><path d="M3 18h18" /></g></g>
        <g className="caw-pod" data-p="1" data-layer="back" transform="translate(-238.6 43.3)" opacity="1"><circle r="30" fill={url("crgp")} /><circle r="24" fill={url("crgl")} stroke={url("crgm")} strokeWidth="4" /><g transform="translate(-12.5 -12.5) scale(1.04)" fill="none" stroke="#FFF1C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 14v-2a7 7 0 0 1 14 0v2" /><rect x="3.5" y="13" width="4" height="6" rx="1.5" /><rect x="16.5" y="13" width="4" height="6" rx="1.5" /></g></g>
        <g className="caw-pod" data-p="2" data-layer="back" transform="translate(-94.8 18.9)" opacity="0"><circle r="30" fill={url("crgp")} /><circle r="24" fill={url("crgl")} stroke={url("crgm")} strokeWidth="4" /><g transform="translate(-12.5 -12.5) scale(1.04)" fill="none" stroke="#FFF1C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="11" rx="1.2" /><path d="M9 20h6M12 15.5V20" /></g></g>
        <g className="caw-pod" data-p="3" data-layer="back" transform="translate(-111.1 58.3)" opacity="1"><circle r="30" fill={url("crgp")} /><circle r="24" fill={url("crgl")} stroke={url("crgm")} strokeWidth="4" /><g transform="translate(-12.5 -12.5) scale(1.04)" fill="none" stroke="#FFF1C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7.5" y="3.5" width="9" height="16" rx="4.5" /><path d="M12 7v3" /></g></g>
        </g>
        <g>
        <circle r="172" fill={url("crgg")} />
        <ellipse cy="96" rx="122" ry="48" fill="#FFE7A0" opacity="0.28" />
        <circle r="168" fill="none" stroke={url("crgr")} strokeWidth="7" />
        <g className="caw-cr-spin-r">
        <g><path d="M 182.3 66.4 A 194 194 0 0 1 59.9 184.5" fill="none" stroke={url("crgm")} strokeWidth="9" opacity="0.85" strokeLinecap="round" /><path d="M 185.4 82.6 A 203 203 0 0 1 76.0 188.2" fill="none" stroke="#BDF0FF" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" /></g>
        <g><path d="M -66.4 182.3 A 194 194 0 0 1 -184.5 59.9" fill="none" stroke={url("crgm")} strokeWidth="9" opacity="0.85" strokeLinecap="round" /><path d="M -82.6 185.4 A 203 203 0 0 1 -188.2 76.0" fill="none" stroke="#BDF0FF" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" /></g>
        <g><path d="M -182.3 -66.4 A 194 194 0 0 1 -59.9 -184.5" fill="none" stroke={url("crgm")} strokeWidth="9" opacity="0.85" strokeLinecap="round" /><path d="M -185.4 -82.6 A 203 203 0 0 1 -76.0 -188.2" fill="none" stroke="#BDF0FF" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" /></g>
        <g><path d="M 66.4 -182.3 A 194 194 0 0 1 184.5 -59.9" fill="none" stroke={url("crgm")} strokeWidth="9" opacity="0.85" strokeLinecap="round" /><path d="M 82.6 -185.4 A 203 203 0 0 1 188.2 -76.0" fill="none" stroke="#BDF0FF" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" /></g>
        </g>
        <g className="caw-cr-eye">
        <circle r="128" fill="#4A2900" opacity="0.38" />
        <circle r="120" fill={url("crgi")} stroke={url("crgm")} strokeWidth="9" />
        <g className="caw-cr-spin">
        <circle r="107" fill="none" stroke="#FFC93C" strokeWidth="2" strokeDasharray="4 7" />
        <path d="M -83.1 -48.0 A 96 96 0 0 1 -16.7 -94.5" fill="none" stroke="#FFD45A" strokeWidth="6" strokeLinecap="round" />
        <path d="M 83.1 -48.0 A 96 96 0 0 1 94.5 16.7" fill="none" stroke="#FFD45A" strokeWidth="6" strokeLinecap="round" />
        <path d="M 48.0 83.1 A 96 96 0 0 1 -61.7 73.5" fill="none" stroke="#FFD45A" strokeWidth="6" opacity="0.7" strokeLinecap="round" />
        </g>
        <g className="caw-cr-spin-r">
        <circle r="82" fill="none" stroke="#FFB800" strokeWidth="9" strokeDasharray="2 9" opacity="0.7" />
        <circle r="72" fill="none" stroke="#BDF0FF" strokeWidth="1.5" opacity="0.7" />
        </g>
        <g opacity="0.55" stroke="#FFF1C2" strokeWidth="1.6"><line x1="-116" x2="116" /><line y1="-116" y2="116" /></g>
        <g className="caw-cr-spin-f"><circle r="56" fill="none" stroke="#FFD45A" strokeWidth="5" strokeDasharray="66 22" /></g>
        <circle className="caw-cr-core" r="52" fill={url("crgc")} />
        <path d="M0 -44 Q 6 -6 44 0 Q 6 6 0 44 Q -6 6 -44 0 Q -6 -6 0 -44 Z" fill="#FFFFFF" />
        </g>
        <ellipse cx="-66" cy="-104" rx="70" ry="28" fill="#FFFFFF" opacity="0.5" transform="rotate(-32 -66 -104)" />
        <ellipse cx="-104" cy="-40" rx="10" ry="26" fill="#FFFFFF" opacity="0.28" transform="rotate(20 -104 -40)" />
        <ellipse cx="92" cy="112" rx="34" ry="12" fill="#FFFFFF" opacity="0.22" transform="rotate(-38 92 112)" />
        </g>
        <g>
        <g transform="rotate(-16)"><path d="M -262 0 A 262 62 0 0 0 262 0" fill="none" stroke={url("crgm")} strokeWidth="5" /></g>
        <g transform="rotate(22)"><path d="M -250 0 A 250 56 0 0 0 250 0" fill="none" stroke={url("crgm")} strokeWidth="5" /></g>
        <g transform="rotate(-48)"><path d="M -240 0 A 240 50 0 0 0 240 0" fill="none" stroke={url("crgm")} strokeWidth="5" /></g>
        <g className="caw-pod" data-p="0" data-layer="front" transform="translate(238.6 -43.3)" opacity="1"><circle r="30" fill={url("crgp")} /><circle r="24" fill={url("crgl")} stroke={url("crgm")} strokeWidth="4" /><g transform="translate(-12.5 -12.5) scale(1.04)" fill="none" stroke="#FFF1C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="6" width="14" height="9" rx="1.2" /><path d="M3 18h18" /></g></g>
        <g className="caw-pod" data-p="1" data-layer="front" transform="translate(-238.6 43.3)" opacity="0"><circle r="30" fill={url("crgp")} /><circle r="24" fill={url("crgl")} stroke={url("crgm")} strokeWidth="4" /><g transform="translate(-12.5 -12.5) scale(1.04)" fill="none" stroke="#FFF1C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 14v-2a7 7 0 0 1 14 0v2" /><rect x="3.5" y="13" width="4" height="6" rx="1.5" /><rect x="16.5" y="13" width="4" height="6" rx="1.5" /></g></g>
        <g className="caw-pod" data-p="2" data-layer="front" transform="translate(-94.8 18.9)" opacity="1"><circle r="30" fill={url("crgp")} /><circle r="24" fill={url("crgl")} stroke={url("crgm")} strokeWidth="4" /><g transform="translate(-12.5 -12.5) scale(1.04)" fill="none" stroke="#FFF1C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="11" rx="1.2" /><path d="M9 20h6M12 15.5V20" /></g></g>
        <g className="caw-pod" data-p="3" data-layer="front" transform="translate(-111.1 58.3)" opacity="0"><circle r="30" fill={url("crgp")} /><circle r="24" fill={url("crgl")} stroke={url("crgm")} strokeWidth="4" /><g transform="translate(-12.5 -12.5) scale(1.04)" fill="none" stroke="#FFF1C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7.5" y="3.5" width="9" height="16" rx="4.5" /><path d="M12 7v3" /></g></g>
        </g>
        </svg>
        <g className="caw-prop caw-p-limit">
        <path className="caw-tear" d="M206 286 Q202 293 206 297 Q210 293 206 286 Z" fill="#8fc0ea" />
        <path className="caw-tear caw-t2" d="M226 288 Q222 295 226 299 Q230 295 226 288 Z" fill="#8fc0ea" />
        </g>
        </g>

        <g className="caw-mv-paper" transform="translate(408 247) rotate(-2) scale(0.9 0.18)">
        <rect x="-23" y="-31" width="46" height="62" rx="1" fill="#FFFFFF" stroke="#b7c3d1" strokeWidth="1.5" />
        <rect x="-13" y="-21" width="26" height="3" rx="1" fill="#e4e7ec" />
        <rect x="-17" y="-11" width="34" height="2.5" rx="1" fill="#eef1f5" />
        <rect x="-17" y="-4" width="30" height="2.5" rx="1" fill="#eef1f5" />
        <rect x="-17" y="3" width="34" height="2.5" rx="1" fill="#eef1f5" />
        <rect x="-17" y="10" width="24" height="2.5" rx="1" fill="#eef1f5" />
        </g>
        <g className="caw-mv-mug" transform="translate(407 225)">
        <g className="caw-steam">
        <path d="M-4 -16 Q-8 -22 -4 -28 Q0 -34 -4 -40" stroke="#98a2b3" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M4 -16 Q0 -22 4 -28 Q8 -34 4 -40" stroke="#98a2b3" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        <rect x="-10" y="-11" width="20" height="22" rx="3" fill="#eb6834" />
        <path d="M10 -6 Q17 -1 10 4" stroke="#eb6834" strokeWidth="3" fill="none" />
        <rect x="-6" y="-3" width="12" height="2" rx="1" fill="#FFFFFF" />
        </g>
        <g className="caw-prop caw-p-limit"><g className="caw-float-bob">
        <rect x="222" y="138" width="42" height="13" rx="6.5" fill="#98a2b3" />
        <circle cx="228" cy="140" r="10" fill="#98a2b3" />
        <circle cx="245" cy="134" r="13" fill="#98a2b3" />
        <circle cx="259" cy="141" r="9" fill="#98a2b3" />
        <g className="caw-rain" stroke="#6aa9e0" strokeWidth="2" strokeLinecap="round">
        <path d="M230 157 l-2 7" /><path d="M243 159 l-2 7" /><path d="M256 157 l-2 7" />
        </g>
        </g></g>
        </g>
        </g>
        </svg>
        <div className={`caw-bubble caw-swap${fadeCls}`}>{quote}</div>
      </div>

      <div className="caw-words">
        <span className="caw-badge">
          <span className="caw-pulse" aria-hidden="true" />
          IN DEVELOPMENT
        </span>
        <h2 className="caw-title">Currently working on it</h2>
        <p className={`caw-doing caw-swap${fadeCls}`}>Cris is {task.doing}.</p>
        <p className="caw-later">Recording disposals and their value will come here.</p>
      </div>
    </div>
  );
}
