"use client";

// The login page (spec §3): one hero holding the room scene, the sign-in card and the day log. Owns the card's
// step and the room loop. DOM order is scene (aria-hidden), card (<main>), day log, so the card comes first for
// keyboards and screen readers; desktop places them absolutely, narrow stacks banner, card, day log.
//
// Focus mode (spec §6) is on for every step but Welcome: the room blurs and pauses, the day log fades, the card
// glides to the centre and the forward Cris flies out of the room to beside it and talks the person through each
// step. Ported from the mockup's enterFocus()/exitFocus()/relayoutFocus()/gsay()/cueLine(). The step changes and
// the card's cues arrive as calls, so the controller below reacts to them directly (an error that moves the step
// lands after the step's line is queued, and cancels it), keeping its timers and flags in a closure.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CrisOrbDefs } from "@/components/cris/orb";
import { cn } from "@/lib/cn";
import type { CrisMood } from "@/lib/cris-mood";
import { DayLog } from "./day-log";
import { cardShift, focusPoint, roomPoint, type FocusLayout, type FocusPoint } from "./focus-layout";
import { FORWARD_MS_PER_CHAR, ForwardCris } from "./forward-cris";
import { RoomScene } from "./room-scene";
import { SignInCard, type CrisCue, type SignInCardProps } from "./sign-in-card";
import { crisLine, errorLine, type Step } from "./login-steps";
import { useReducedMotion, useRoomLoop } from "./use-room-loop";
import "./login.css";

export type LoginExperienceProps = {
  page: "login" | "signup";
  initialStep: Step;
  /** The room SVG from buildWorld(), built once per server process. */
  world: string;
  card: Omit<SignInCardProps, "step" | "onStep" | "onCue" | "onValues">;
};

const NARROW = "(max-width: 900px)";
// One element for the page's life: the loop re-renders this component while the clock counts.
const ORB_DEFS = <CrisOrbDefs />;

/** The flight to or from the card (the CSS transition is 850 ms). */
const FLIGHT_MS = 860;
/** When Cris speaks: after arriving, on a later step change, and on a direct load. */
const LINE_AFTER_FLIGHT_MS = 820;
const LINE_AFTER_STEP_MS = 120;
const LINE_ON_LOAD_MS = 300;
/** Back to rest after a line has typed out (or after showing it whole, with reduced motion). */
const REST_AFTER_LINE_MS = 700;
const REST_REDUCED_MS = 1200;
/** How long Cris looks busy after a keystroke in the email or name field. */
const SEARCH_MS = 800;
const RESIZE_DEBOUNCE_MS = 80;

/** `point` null: not measured yet, so CSS stands Cris at its default focus point (a direct load's server render). */
type Guide = { visible: boolean; point: FocusPoint | null; flying: boolean; lean: number };
/** Transitions off for one frame: card and Cris ("all": a resize, the first placement) or Cris alone ("guide"). */
type Snap = { what: "all" | "guide" } | null;
type Timer = ReturnType<typeof setTimeout> | undefined;

export function LoginExperience({ initialStep, world, card }: LoginExperienceProps) {
  const [step, setStep] = useState<Step>(initialStep);
  const reduced = useReducedMotion();
  const heroRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  // The camera centres on the part of the room left of the card (desktop) or the whole banner (narrow).
  // offsetLeft ignores the card's transform, so the centred card of focus mode doesn't move the camera.
  const visibleRight = useCallback(() => {
    const sceneWidth = sceneRef.current?.clientWidth ?? 0;
    if (window.matchMedia(NARROW).matches) return sceneWidth;
    const cardEl = heroRef.current?.querySelector<HTMLElement>(".lw-card");
    return cardEl ? cardEl.offsetLeft - 24 : sceneWidth;
  }, []);

  const loop = useRoomLoop({ reduced, sceneRef, worldRef, visibleRight });
  const { suspend, resume, crisPoint } = loop;

  const [layout, setLayout] = useState<FocusLayout | null>(null);
  // A direct load renders Cris already beside the card (CSS default placement) until the first measurement.
  const [guide, setGuide] = useState<Guide>({
    visible: initialStep !== "welcome",
    point: null,
    flying: false,
    lean: 12,
  });
  const [mood, setMood] = useState<CrisMood>("idle");
  const [line, setLine] = useState<string | null>(null);
  // A direct load renders focused from the server: placing the card and Cris on hydration must not animate.
  const [snap, setSnap] = useState<Snap>(initialStep === "welcome" ? null : { what: "all" });

  const stepRef = useRef(initialStep);
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  });

  const focus = useMemo(() => {
    const t = { line: undefined as Timer, rest: undefined as Timer, search: undefined as Timer };
    const flight = { end: undefined as Timer, home: undefined as Timer };
    const s = {
      values: { email: "", name: "" },
      /** A password field has focus. */
      shy: false,
      /** The forward Cris is standing in for the room Cris (flying out, beside the card, or flying home). */
      out: false,
      /** Where to fly once Cris has been drawn over the room Cris. */
      flightTo: null as FocusPoint | null,
    };

    const measure = (): FocusLayout | null => {
      const hero = heroRef.current;
      const scene = sceneRef.current;
      const cardEl = hero?.querySelector<HTMLElement>(".lw-card");
      if (!hero || !scene || !cardEl) return null;
      return {
        narrow: window.matchMedia(NARROW).matches,
        heroWidth: hero.clientWidth,
        heroHeight: hero.clientHeight,
        cardWidth: cardEl.offsetWidth,
        cardLeft: cardEl.offsetLeft,
        scene: { left: scene.offsetLeft, top: scene.offsetTop, width: scene.clientWidth, height: scene.clientHeight },
      };
    };

    const rest = () => setMood(s.shy ? "shy" : "idle");
    const quiet = () => {
      clearTimeout(t.line);
      clearTimeout(t.rest);
    };
    const say = (text: string, m: CrisMood) => {
      clearTimeout(t.rest);
      // A keystroke's search mood must not cut a line short.
      clearTimeout(t.search);
      setMood(m);
      setLine(text);
      const typing = reducedRef.current ? REST_REDUCED_MS : text.length * FORWARD_MS_PER_CHAR + REST_AFTER_LINE_MS;
      t.rest = setTimeout(rest, typing);
    };
    const cueLine = (at: Step, delay: number) => {
      quiet();
      t.line = setTimeout(() => {
        if (stepRef.current !== at) return;
        const text = crisLine(at, s.values);
        if (text) say(text, "talk");
      }, delay);
    };

    /** Card centred and Cris beside it at once: a direct load or a resize. */
    const place = () => {
      const l = measure();
      if (!l) return;
      s.flightTo = null;
      setLayout(l);
      setSnap({ what: "all" });
      setGuide((g) => ({ ...g, visible: true, point: focusPoint(l), flying: false }));
    };

    const enter = () => {
      clearTimeout(flight.home);
      clearTimeout(flight.end);
      suspend();
      const l = measure();
      if (!l) return;
      const to = focusPoint(l);
      setLayout(l);
      setMood("idle");
      setLine(null);
      if (reducedRef.current) {
        s.out = true;
        setSnap({ what: "guide" });
        setGuide({ visible: true, point: to, flying: false, lean: 0 });
        return;
      }
      if (s.out) {
        // Turned back on the way home: fly from where it is.
        setGuide((g) => ({ ...g, point: to, flying: true, lean: g.point && to.x < g.point.x ? -12 : 12 }));
      } else {
        // Drawn over the room Cris with no transition; the snap's next frame sends it to `to`.
        const from = roomPoint(crisPoint(), l);
        s.flightTo = to;
        setSnap({ what: "guide" });
        setGuide({ visible: true, point: from, flying: false, lean: to.x < from.x ? -12 : 12 });
      }
      s.out = true;
      flight.end = setTimeout(() => setGuide((g) => ({ ...g, flying: false })), FLIGHT_MS);
    };

    const exit = () => {
      quiet();
      clearTimeout(t.search);
      clearTimeout(flight.end);
      s.flightTo = null;
      s.shy = false;
      setLine(null);
      setMood("idle");
      const reducedNow = reducedRef.current;
      const l = measure();
      if (l) {
        const home = roomPoint(crisPoint(), l);
        setGuide((g) => ({ ...g, point: home, flying: !reducedNow, lean: 10 }));
      }
      flight.home = setTimeout(
        () => {
          s.out = false;
          setGuide((g) => ({ ...g, visible: false, flying: false }));
          resume();
        },
        reducedNow ? 0 : FLIGHT_MS,
      );
    };

    return {
      /** The card moved to another step. */
      changeStep(to: Step) {
        const from = stepRef.current;
        if (to === from) return;
        stepRef.current = to;
        setStep(to);
        if (to === "welcome") {
          exit();
          return;
        }
        const entering = from === "welcome";
        if (entering) enter();
        cueLine(to, entering ? (reducedRef.current ? 0 : LINE_AFTER_FLIGHT_MS) : LINE_AFTER_STEP_MS);
      },
      onCue(c: CrisCue) {
        if (stepRef.current === "welcome") return;
        switch (c.kind) {
          case "typing":
            clearTimeout(t.search);
            setMood("search");
            t.search = setTimeout(rest, SEARCH_MS);
            return;
          case "password-focus":
            s.shy = c.on;
            if (!c.on) return rest();
            clearTimeout(t.rest);
            setLine(null);
            setMood("shy");
            return;
          case "error":
            clearTimeout(t.line);
            say(errorLine(c.message), "look");
            return;
          case "pending":
            quiet();
            clearTimeout(t.search);
            setLine(null);
            setMood("think");
            return;
        }
      },
      onValues(v: { email: string; name: string }) {
        s.values = v;
      },
      /** A direct load (/login?step=login, /signup): focused from the start, no flight. */
      start() {
        const at = stepRef.current;
        if (at === "welcome") return;
        suspend();
        s.out = true;
        place();
        cueLine(at, LINE_ON_LOAD_MS);
      },
      relayout() {
        if (stepRef.current !== "welcome") place();
      },
      /** After a snap frame: the flight that was waiting for Cris to be drawn over the room Cris. */
      takeOff() {
        const to = s.flightTo;
        if (!to) return;
        s.flightTo = null;
        setGuide((g) => ({ ...g, point: to, flying: true }));
      },
      dispose() {
        quiet();
        clearTimeout(t.search);
        clearTimeout(flight.end);
        clearTimeout(flight.home);
      },
    };
  }, [suspend, resume, crisPoint]);

  // Before paint, so a direct load never shows the card or Cris out of place.
  useLayoutEffect(() => focus.start(), [focus]);
  useEffect(() => focus.dispose, [focus]);

  useEffect(() => {
    let timer: Timer;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(focus.relayout, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [focus]);

  // A snap: the new positions are committed with transitions off; flush that style, then let transitions back on
  // next frame (and start a waiting flight from there).
  useLayoutEffect(() => {
    if (!snap) return;
    heroRef.current?.getBoundingClientRect();
    const raf = requestAnimationFrame(() => {
      setSnap(null);
      focus.takeOff();
    });
    return () => cancelAnimationFrame(raf);
  }, [snap, focus]);

  const focused = step !== "welcome";
  // Until measured, CSS works the card's shift out from its own geometry (login.css), so the server render is right.
  const heroStyle = layout ? ({ "--lw-dx": `${cardShift(layout).toFixed(1)}px` } as CSSProperties) : undefined;

  // The loop re-renders this component while the clock counts; the card only needs to when its step changes.
  const cardEl = useMemo(
    () => (
      <SignInCard {...card} step={step} onStep={focus.changeStep} onCue={focus.onCue} onValues={focus.onValues} />
    ),
    [card, step, focus],
  );

  return (
    <div
      ref={heroRef}
      className={cn("lw-hero", focused && "lw-focus")}
      data-snap={snap?.what}
      style={heroStyle}
    >
      {ORB_DEFS}
      <RoomScene world={world} loop={loop} hidden={focused || guide.visible} />
      {cardEl}
      <DayLog loop={loop} />
      <ForwardCris
        point={guide.point}
        flying={guide.flying}
        lean={guide.lean}
        visible={guide.visible}
        mood={mood}
        line={line}
        layout={layout}
      />
    </div>
  );
}
