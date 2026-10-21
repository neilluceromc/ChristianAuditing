"use client";

// The login page (Task 10: the owner's blob-style "Cris Login Redesign"). One hero: soft glows drifting behind, the
// stage (Cris's day in a liquid blob, aria-hidden) on the left, the sign-in card (<main>) on the right, the STAGING
// pill and the Pause control in the corners. DOM order puts the card first after the decorative stage, so it is the
// first thing a keyboard reaches.
//
// Focus mode: using the form (or any sign-up step) melts the room away and brings Cris beside the card, where she
// talks the person through it; her eye follows the caret in text fields and looks away in password fields. Leaving the
// untouched sign-in form sends her back to her day. After 9 s idle (or a tap on her) she tells a fact.
//
// Signed in: while a sign-in request is in flight (credentials, Microsoft or quick sign-in) the card fades, Cris flies
// to the middle and talks through loading the workspace. It follows the request (owner's decision): it never holds
// the redirect, and a refused sign-in brings the card straight back with its error.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CrisOrbDefs } from "@/components/cris/orb";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { cn } from "@/lib/cn";
import type { CrisMood } from "@/lib/cris-mood";
import { BlobStage } from "./blob-stage";
import { FACTS, crisLine, emailProblem, enterLines, errorLine, firstFromEmail, nextFact, type Step } from "./login-steps";
import { QuickSignIn } from "./quick-sign-in";
import { SCENES, focusOffset } from "./scenes";
import { SignInCard, type CrisCue, type QuickSignIn as QuickSignInData, type SignInCardProps } from "./sign-in-card";
import { useDayLoop } from "./use-day-loop";
import { useStageLoop } from "./use-stage-loop";
import "./login.css";

export type LoginExperienceProps = {
  page: "login" | "signup";
  initialStep: Step;
  /** Open with the email field focused (`/login?step=login`). */
  autoFocus?: boolean;
  card: Pick<SignInCardProps, "domain" | "next" | "microsoftAction" | "viewerLanding"> & { quick: QuickSignInData };
};

// One element for the page's life.
const ORB_DEFS = <CrisOrbDefs />;

/** When Cris speaks: after flying beside the card, and on a later step change. */
const LINE_AFTER_FLIGHT_MS = 820;
const LINE_AFTER_STEP_MS = 120;
/** Back to rest after a line (its reading time), or after showing it whole with reduced motion. */
const REST_PER_CHAR_MS = 28;
const REST_AFTER_LINE_MS = 700;
const REST_REDUCED_MS = 1200;
/** Typing zooms her in for a moment. */
const TYPING_MS = 1200;
/** The flight to or from the card. */
const FLIGHT_S = 0.8;
/** Idle on the page this long before the first fact, then one at most this often. */
const IDLE_FACT_MS = 9000;
const FACT_GAP_MS = 12000;
/** The signed-in sequence starts once a request has been in flight this long (a quick refusal never flashes it). */
const ENTER_DELAY_MS = 300;
const ENTER_GAP_MS = 1250;
const ENTER_GAP_REDUCED_MS = 900;

type Timer = ReturnType<typeof setTimeout> | undefined;
type Entering = {
  stage: number;
  email: string;
  /** Where she stood when it started: she flies to the middle from there. */
  station: [number, number];
  dx: number;
  dy: number;
  scale: number;
  /** The point she scales around (her centre), in the stage column's box. */
  origin: [number, number];
  statusTop: number | null;
};

export function LoginExperience({ initialStep, autoFocus, card }: LoginExperienceProps) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState<Step>(initialStep);
  const [engaged, setEngaged] = useState(initialStep !== "login");
  const [mood, setMood] = useState<CrisMood>("idle");
  const [line, setLine] = useState<string | null>(null);
  const [look, setLook] = useState<[number, number] | null>(null);
  const [typing, setTyping] = useState(false);
  const [fact, setFact] = useState<{ text: string; mood: CrisMood } | null>(null);
  const [paused, setPaused] = useState(false);
  const [entering, setEntering] = useState<Entering | null>(null);
  const [fdx, setFdx] = useState(120);

  const heroRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const drops = useRef<(SVGCircleElement | null)[]>([]);
  const shades = useRef<(SVGCircleElement | null)[]>([]);
  const glows = useRef<(HTMLSpanElement | null)[]>([]);

  const still = paused || reduced;
  const focus = engaged || !!entering;
  const day = useDayLoop(!focus && !still && !fact);
  useStageLoop({ drops, shades, glows, focus, running: !still });

  // Latest values for timers and callbacks.
  const live = useRef({
    step,
    engaged,
    reduced,
    values: { email: "", name: "" },
    shy: false,
    entering: false,
    station: [0, 0] as [number, number],
  });
  useEffect(() => {
    live.current.step = step;
    live.current.engaged = engaged;
    live.current.reduced = reduced;
    live.current.entering = !!entering;
  });

  useEffect(() => {
    const onResize = () => setFdx(focusOffset(window.innerWidth));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---------- Cris beside the card ----------
  const t = useRef({ line: undefined as Timer, rest: undefined as Timer, typing: undefined as Timer });
  const rest = useCallback(() => setMood(live.current.shy ? "shy" : "idle"), []);
  const say = useCallback(
    (text: string, m: CrisMood) => {
      clearTimeout(t.current.rest);
      setMood(m);
      setLine(text);
      const hold = live.current.reduced ? REST_REDUCED_MS : text.length * REST_PER_CHAR_MS + REST_AFTER_LINE_MS;
      t.current.rest = setTimeout(rest, hold);
    },
    [rest],
  );
  const cueLine = useCallback(
    (at: Step, delay: number) => {
      clearTimeout(t.current.line);
      clearTimeout(t.current.rest);
      t.current.line = setTimeout(() => {
        if (live.current.step !== at) return;
        say(crisLine(at, live.current.values), "talk");
      }, delay);
    },
    [say],
  );

  /** Focus mode on: Cris flies beside the card and greets after the flight. */
  const engage = useCallback(
    (at: Step) => {
      setFact(null);
      if (live.current.engaged) return false;
      live.current.engaged = true;
      setEngaged(true);
      setMood("idle");
      setLine(null);
      cueLine(at, live.current.reduced ? 0 : LINE_AFTER_FLIGHT_MS);
      return true;
    },
    [cueLine],
  );
  const disengage = useCallback(() => {
    clearTimeout(t.current.line);
    clearTimeout(t.current.rest);
    live.current.engaged = false;
    live.current.shy = false;
    setEngaged(false);
    setLine(null);
    setLook(null);
    setMood("idle");
  }, []);

  /** Where Cris's eye should look to follow the caret in `el` (orb units), from where she stands now. */
  const lookAt = useCallback((el: HTMLInputElement) => {
    const orb = leftRef.current?.querySelector<HTMLElement>(".lw-cris-body");
    if (!orb) return;
    const o = orb.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const tx = r.left + 42 + Math.min(el.value.length * 7.4, r.width - 60);
    const ty = r.top + r.height / 2;
    const dx = tx - (o.left + o.width / 2);
    const dy = ty - (o.top + o.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    setLook([(40 * dx) / d, (30 * dy) / d]);
  }, []);

  const onCue = useCallback(
    (c: CrisCue) => {
      if (live.current.entering) return;
      switch (c.kind) {
        case "engage": {
          const first = engage(live.current.step);
          if (c.field === "password" || c.field === "newPassword") {
            live.current.shy = true;
            setLook(null);
            clearTimeout(t.current.rest);
            // On the sign-in form, a good email gets her "your password" line before she looks away.
            if (live.current.step === "login" && !emailProblem(live.current.values.email, null)) {
              clearTimeout(t.current.line);
              say(crisLine("login-password", live.current.values), "shy");
            } else {
              if (!first) setLine(null);
              setMood("shy");
            }
          } else {
            live.current.shy = false;
            if (!first) rest();
            lookAt(c.el);
          }
          return;
        }
        case "typing":
          if (!live.current.engaged) engage(live.current.step);
          lookAt(c.el);
          setTyping(true);
          clearTimeout(t.current.typing);
          t.current.typing = setTimeout(() => setTyping(false), TYPING_MS);
          return;
        case "field-blur":
          live.current.shy = false;
          setLook(null);
          rest();
          return;
        case "leave":
          if (live.current.step === "login") disengage();
          return;
        case "error":
          engage(live.current.step);
          clearTimeout(t.current.line);
          say(errorLine(c.message), "look");
          return;
        case "busy":
          clearTimeout(t.current.line);
          clearTimeout(t.current.rest);
          setLine(null);
          setMood("think");
          return;
      }
    },
    [engage, disengage, say, rest, lookAt],
  );

  const onStep = useCallback(
    (to: Step) => {
      const from = live.current.step;
      if (to === from) return;
      live.current.step = to;
      setStep(to);
      if (to === "login") {
        disengage();
        return;
      }
      if (!engage(to)) cueLine(to, LINE_AFTER_STEP_MS);
    },
    [engage, disengage, cueLine],
  );

  const onValues = useCallback((v: { email: string; name: string }) => {
    live.current.values = v;
  }, []);

  // A direct load of a sign-up step greets once hydrated.
  useEffect(() => {
    if (initialStep !== "login") cueLine(initialStep, 300);
    const timers = t.current;
    return () => {
      clearTimeout(timers.line);
      clearTimeout(timers.rest);
      clearTimeout(timers.typing);
    };
    // Only on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- facts ----------
  const factState = useRef({ bag: [] as number[], last: null as number | null, at: 0, idleAt: 0, timer: undefined as Timer });
  const tellFact = useCallback(() => {
    const f = factState.current;
    const { index, bag } = nextFact(f.bag, f.last, FACTS.length);
    f.bag = bag;
    f.last = index;
    const fct = FACTS[index]!;
    const hold = (text: string) => (live.current.reduced ? 3000 : Math.max(3200, text.length * 55));
    const end = () => {
      f.at = Date.now();
      setFact(null);
    };
    clearTimeout(f.timer);
    f.at = Date.now();
    setFact({ text: fct.q, mood: fct.a ? "think" : (fct.mood ?? "talk") });
    f.timer = setTimeout(
      () => {
        if (!fct.a) return end();
        f.at = Date.now();
        setFact({ text: fct.a, mood: "talk" });
        f.timer = setTimeout(end, hold(fct.a));
      },
      fct.a ? 3200 : hold(fct.q),
    );
  }, []);

  useEffect(() => {
    const f = factState.current;
    f.idleAt = Date.now();
    const onActivity = () => {
      f.idleAt = Date.now();
    };
    const events = ["pointermove", "pointerdown", "keydown", "touchstart", "wheel"] as const;
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    const tick = setInterval(() => {
      if (live.current.engaged || live.current.entering) return;
      const now = Date.now();
      if (now - f.idleAt > IDLE_FACT_MS && now - f.at > FACT_GAP_MS) tellFact();
    }, 1000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearInterval(tick);
      clearTimeout(f.timer);
    };
  }, [tellFact]);

  // A fact gives way to the form.
  useEffect(() => {
    if (!engaged) return;
    clearTimeout(factState.current.timer);
    setFact(null);
  }, [engaged]);

  const onTapCris = useCallback(() => {
    if (live.current.entering || live.current.engaged) return;
    tellFact();
  }, [tellFact]);

  // ---------- signed in ----------
  const sources = useRef({ card: { pending: false, email: "" }, quick: { pending: false, email: "" } });
  const enterTimers = useRef<Timer[]>([]);
  const startEntering = useCallback((email: string) => {
    const hero = heroRef.current;
    const left = leftRef.current;
    const orb = left?.querySelector<HTMLElement>(".lw-cris-body");
    let geo = { dx: 0, dy: 0, scale: 1.3, origin: [0, 0] as [number, number], statusTop: null as number | null };
    if (hero && left && orb) {
      // Wherever she is, she travels to the middle of the screen and grows a little; the status sits under her rings.
      const h = hero.getBoundingClientRect();
      const l = left.getBoundingClientRect();
      const o = orb.getBoundingClientRect();
      const ox = o.left + o.width / 2;
      const oy = o.top + o.height / 2;
      const phone = window.innerWidth < 720;
      const scale = phone ? 1.55 : 1.3;
      const ring = (o.width / 2) * 1.08 * scale;
      const centreY = Math.max(ring + 36, Math.min(h.height, window.innerHeight) * 0.4);
      geo = {
        dx: h.left + h.width / 2 - ox,
        dy: h.top + centreY - oy,
        scale,
        origin: [ox - l.left, oy - l.top],
        statusTop: centreY + ring + 20,
      };
    }
    setLine(null);
    setFact(null);
    setEntering({ stage: 0, email, station: live.current.station, ...geo });
    const gap = live.current.reduced ? ENTER_GAP_REDUCED_MS : ENTER_GAP_MS;
    enterTimers.current = [1, 2, 3, 4].map((stage) =>
      setTimeout(() => setEntering((e) => (e ? { ...e, stage } : e)), gap * stage + (stage >= 4 ? 300 : 0)),
    );
  }, []);

  const onSignIn = useCallback(
    (from: "card" | "quick", s: { pending: boolean; email: string }) => {
      sources.current[from] = s;
      const any = sources.current.card.pending || sources.current.quick.pending;
      enterTimers.current.forEach(clearTimeout);
      enterTimers.current = [];
      if (!any) {
        // At once, not on the next render: a refusal's error cue follows straight after and must reach Cris.
        live.current.entering = false;
        setEntering(null);
        return;
      }
      // In flight: Cris thinks; after a moment the sequence takes over.
      setLine(null);
      setMood("think");
      const email = sources.current.card.pending ? sources.current.card.email : sources.current.quick.email;
      enterTimers.current = [setTimeout(() => startEntering(email), ENTER_DELAY_MS)];
    },
    [startEntering],
  );
  const onCardSignIn = useCallback((s: { pending: boolean; email: string }) => onSignIn("card", s), [onSignIn]);
  const onQuickSignIn = useCallback((s: { pending: boolean; email: string }) => onSignIn("quick", s), [onSignIn]);
  useEffect(() => () => enterTimers.current.forEach(clearTimeout), []);

  // ---------- what the stage shows ----------
  const scene = SCENES[day.index]!;
  const lines = entering ? enterLines(firstFromEmail(entering.email)) : null;
  const status = entering ? lines![Math.min(4, entering.stage)]! : null;
  const crisMood: CrisMood = status ? status.mood : fact ? fact.mood : engaged ? mood : day.mood;
  const bubble = entering
    ? null
    : fact
      ? fact.text
      : engaged
        ? line
        : day.said && !day.leaving && !day.fading
          ? scene.line
          : null;
  const station: [number, number] = entering
    ? entering.station
    : focus
      ? [fdx + (typing ? 16 : 0), 0]
      : scene.station;
  useEffect(() => {
    live.current.station = station;
  });
  const moveSeconds = !focus && !day.arrived ? day.travel : FLIGHT_S;
  const prop = !focus && day.arrived && !day.leaving ? scene.prop : null;

  const cardEl = useMemo(
    () => (
      <SignInCard
        domain={card.domain}
        next={card.next}
        microsoftAction={card.microsoftAction}
        viewerLanding={card.viewerLanding}
        step={step}
        autoFocus={autoFocus}
        onStep={onStep}
        onCue={onCue}
        onValues={onValues}
        onSignIn={onCardSignIn}
      />
    ),
    [card, step, autoFocus, onStep, onCue, onValues, onCardSignIn],
  );

  const leftStyle = entering
    ? ({
        transform: `translate(${entering.dx.toFixed(1)}px, ${entering.dy.toFixed(1)}px) scale(${entering.scale})`,
        transformOrigin: `${entering.origin[0].toFixed(1)}px ${entering.origin[1].toFixed(1)}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div
      ref={heroRef}
      className={cn(
        "lw-hero",
        focus && "lw-focus",
        entering && "lw-entering",
        fact && "lw-fact",
        typing && engaged && !entering && "lw-typing",
        look && "lw-looking",
        still && "lw-still",
      )}
    >
      {ORB_DEFS}
      <div className="lw-bg" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n, i) => (
          <span
            key={n}
            className={`lw-bgb lw-b${n}`}
            ref={(el) => {
              glows.current[i] = el;
            }}
          />
        ))}
      </div>

      <BlobStage
        ref={leftRef}
        style={leftStyle}
        sceneIndex={day.index}
        focus={focus}
        station={station}
        moveSeconds={moveSeconds}
        prop={prop}
        mood={crisMood}
        still={still}
        look={look}
        bubble={bubble}
        fading={day.fading}
        drops={drops}
        shades={shades}
        onTapCris={onTapCris}
      />

      {cardEl}

      <div
        className="lw-enter"
        role="status"
        aria-live="polite"
        style={entering?.statusTop != null ? { top: `${entering.statusTop.toFixed(1)}px` } : undefined}
      >
        <p className="lw-le-status">{status?.text ?? ""}</p>
        <div className="lw-le-bar" aria-hidden="true">
          <span style={{ width: `${(status?.bar ?? 0) * 100}%` }} />
        </div>
        <p className="lw-le-who">{entering?.email ?? ""}</p>
      </div>

      {card.quick && <QuickSignIn quick={card.quick} next={card.next} onSignIn={onQuickSignIn} />}

      <button type="button" className="lw-pause" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
          {paused ? (
            <path d="M4 2.5v9a.6.6 0 0 0 .9.5l7.2-4.5a.6.6 0 0 0 0-1L4.9 2a.6.6 0 0 0-.9.5z" fill="currentColor" />
          ) : (
            <>
              <rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor" />
            </>
          )}
        </svg>
        Pause motion
      </button>
    </div>
  );
}
