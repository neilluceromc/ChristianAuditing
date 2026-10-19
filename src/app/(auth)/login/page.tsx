import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { LoginExperience } from "@/components/login/login-experience";
import { initialStep } from "@/components/login/login-steps";
import { buildWorld } from "@/components/login/world";
import { loadCardProps } from "../card-props";

export const metadata: Metadata = { title: pageTitle("Sign in") };

// The room SVG, built once per server process (spec §9).
const WORLD = buildWorld();

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; quick?: string; step?: string }>;
}) {
  const { next, quick, step } = await searchParams;
  const card = await loadCardProps({ next, quick });
  return <LoginExperience page="login" initialStep={initialStep("login", step)} world={WORLD} card={card} />;
}
