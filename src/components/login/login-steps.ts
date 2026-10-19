// The sign-in card's steps, their progress, Cris's lines and the client checks (spec §5.2, §6).
// Pure, so the rules are tested without the DOM.
import type { SignUpField } from "@/lib/signup-rules";

export type Step = "welcome" | "login-email" | "login-password" | "signup-name" | "signup-password" | "signup-done";

export const STEP_PROGRESS: Record<Step, number> = {
  welcome: 0,
  "login-email": 50,
  "login-password": 100,
  "signup-name": 33,
  "signup-password": 67,
  "signup-done": 100,
};

/** The order of the steps within each flow; a move to an earlier one is backward. */
const ORDER: Step[] = ["welcome", "login-email", "login-password", "signup-name", "signup-password", "signup-done"];

/** The page's first step: `/login?step=login` opens Log in 1, `/signup` opens Sign up 1, anything else Welcome. */
export function initialStep(page: "login" | "signup", stepParam: string | undefined): Step {
  if (page === "signup") return "signup-name";
  return stepParam === "login" ? "login-email" : "welcome";
}

/** The first client check that fails for an email, or "" when it is fine. */
export function emailProblem(raw: string, domain: string | null): string {
  const value = raw.trim();
  if (!value) return "Enter your work email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "That doesn't look like an email address. Check for typos.";
  if (domain && value.slice(value.lastIndexOf("@") + 1).toLowerCase() !== domain.trim().toLowerCase()) {
    return `Use your @${domain} email.`;
  }
  return "";
}

/** The local part of an email, split on '.', '_' or '-'. */
function localParts(email: string): string[] {
  const local = email.trim().split("@")[0] ?? "";
  return local.split(/[._-]/).filter(Boolean);
}

/** Up to two initials from the email's local part: "neil.lucero@…" gives "NL". "?" when there is none. */
export function initials(email: string): string {
  const letters = localParts(email)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return letters || "?";
}

/** The first name in an email's local part, capitalised: "neil.lucero@…" gives "Neil". "" when there is none. */
export function firstFromEmail(email: string): string {
  const first = localParts(email)[0];
  return first ? first[0]!.toUpperCase() + first.slice(1).toLowerCase() : "";
}

/** The first word of a name, trimmed. */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** The sign-up step that holds a field (name and email share sign-up 1). */
export function stepForField(field: SignUpField): Step {
  return field === "password" ? "signup-password" : "signup-name";
}

/** Cris's line for a step, or null on Welcome (no bubble). */
export function crisLine(step: Step, ctx: { email: string; name: string }): string | null {
  switch (step) {
    case "welcome":
      return null;
    case "login-email":
      return "Hi again! What's your work email?";
    case "login-password": {
      const first = firstFromEmail(ctx.email);
      return first ? `Thanks, ${first}. Now your password. I won't peek.` : "Thanks. Now your password. I won't peek.";
    }
    case "signup-name":
      return "Hi, I'm Cris! Let's set up your account.";
    case "signup-password": {
      const first = firstWord(ctx.name);
      return first
        ? `Nice to meet you, ${first}. Pick a password with at least 10 characters.`
        : "Nice to meet you. Pick a password with at least 10 characters.";
    }
    case "signup-done":
      return "You're all set! An admin will give you a role soon.";
  }
}

/** Cris's line for a failed check or server error. */
export function errorLine(message: string): string {
  return `Hmm. ${message}`;
}

/** True when moving from one step to another goes back: to Welcome, or to an earlier step of the same flow. */
export function isBackward(from: Step, to: Step): boolean {
  if (to === "welcome") return from !== "welcome";
  const flow = (step: Step) => (step.startsWith("login") ? "login" : step.startsWith("signup") ? "signup" : "welcome");
  if (flow(from) !== flow(to)) return false;
  return ORDER.indexOf(to) < ORDER.indexOf(from);
}
