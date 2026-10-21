import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { LoginExperience } from "@/components/login/login-experience";
import { initialStep } from "@/components/login/login-steps";
import { loadCardProps } from "../card-props";

export const metadata: Metadata = { title: pageTitle("Sign in") };

// `?step=login` (the links back from sign-up) opens the sign-in form with the email field focused.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; quick?: string; step?: string }>;
}) {
  const { next, quick, step } = await searchParams;
  const card = await loadCardProps({ next, quick });
  return <LoginExperience page="login" initialStep={initialStep("login")} autoFocus={step === "login"} card={card} />;
}
