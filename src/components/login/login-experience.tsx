"use client";

// The login page (spec §3): the hero with the sign-in card. Owns the card's step. The room scene and day log
// (Task 6) and focus mode with the forward Cris (Task 7) join here; until then the hero is plain --canvas.
import { useState } from "react";
import { SignInCard, type SignInCardProps } from "./sign-in-card";
import type { Step } from "./login-steps";
import "./login.css";

export type LoginExperienceProps = {
  page: "login" | "signup";
  initialStep: Step;
  /** The room SVG from buildWorld(), built once per server process (rendered from Task 6). */
  world: string;
  card: Omit<SignInCardProps, "step" | "onStep" | "onCue" | "onValues">;
};

export function LoginExperience({ initialStep, card }: LoginExperienceProps) {
  const [step, setStep] = useState<Step>(initialStep);
  return (
    <div className="lw-hero">
      <SignInCard {...card} step={step} onStep={setStep} />
    </div>
  );
}
