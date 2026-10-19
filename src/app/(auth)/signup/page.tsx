import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { LoginExperience } from "@/components/login/login-experience";
import { initialStep } from "@/components/login/login-steps";
import { buildWorld } from "@/components/login/world";
import { loadCardProps } from "../card-props";

export const metadata: Metadata = { title: pageTitle("Create account") };

// The room SVG, built once per server process (spec §9).
const WORLD = buildWorld();

// The same page as /login, opened at Sign up 1. Sign-up ignores `next`, as before.
export default async function SignupPage() {
  const card = await loadCardProps({});
  return <LoginExperience page="signup" initialStep={initialStep("signup", undefined)} world={WORLD} card={card} />;
}
