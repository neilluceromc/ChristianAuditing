"use client";

// The login page (spec §3): one hero holding the room scene, the sign-in card and the day log. Owns the card's
// step and the room loop. DOM order is scene (aria-hidden), card (<main>), day log, so the card comes first for
// keyboards and screen readers; desktop places them absolutely, narrow stacks banner, card, day log. Focus mode
// with the forward Cris (Task 7) joins here.
import { useCallback, useMemo, useRef, useState } from "react";
import { CrisOrbDefs } from "@/components/cris/orb";
import { DayLog } from "./day-log";
import { RoomScene } from "./room-scene";
import { SignInCard, type SignInCardProps } from "./sign-in-card";
import type { Step } from "./login-steps";
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

  // The loop re-renders this component while the clock counts; the card only needs to when its step changes.
  const cardEl = useMemo(() => <SignInCard {...card} step={step} onStep={setStep} />, [card, step]);

  return (
    <div ref={heroRef} className="lw-hero">
      {ORB_DEFS}
      <RoomScene world={world} loop={loop} hidden={false} />
      {cardEl}
      <DayLog loop={loop} />
    </div>
  );
}
