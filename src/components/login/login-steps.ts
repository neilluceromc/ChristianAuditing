// The sign-in card's steps, Cris's lines, the signed-in sequence, her idle facts and the client checks (spec §5.2,
// §6; Task 10's blob-style redesign). Pure, so the rules are tested without the DOM.
import type { CrisMood } from "@/lib/cris-mood";
import type { SignUpField } from "@/lib/signup-rules";

/** One sign-in form ("Welcome back"), then the three sign-up steps. */
export type Step = "login" | "signup-name" | "signup-password" | "signup-done";

/** The page's first step: /signup opens Sign up 1, /login the sign-in form (`?step=login` only focuses it). */
export function initialStep(page: "login" | "signup"): Step {
  return page === "signup" ? "signup-name" : "login";
}

/** The sign-up progress bars, one per step: done, current, or still to come. None on the sign-in form. */
export function segments(step: Step): ("done" | "on" | "")[] {
  const at = { login: -1, "signup-name": 0, "signup-password": 1, "signup-done": 2 }[step];
  if (at < 0) return [];
  return [0, 1, 2].map((i) => (i < at ? "done" : i === at ? "on" : ""));
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

/** The first name in an email's local part, capitalised: "neil.lucero@…" gives "Neil". "" when there is none. */
export function firstFromEmail(email: string): string {
  const local = email.trim().split("@")[0] ?? "";
  const first = local.split(/[._-]/).filter(Boolean)[0];
  return first ? first[0]!.toUpperCase() + first.slice(1).toLowerCase() : "";
}

/**
 * The email the signed-in sequence may show and greet by: a password sign-in's, as typed. A Microsoft sign-in's
 * account is picked at Microsoft, so whatever sits in the email field is not who is signing in — it shows none.
 */
export function sequenceEmail(passwordSignIn: boolean, typed: string): string {
  return passwordSignIn ? typed.trim() : "";
}

/** The first word of a name, trimmed. */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** The sign-up step that holds a field (name and email share sign-up 1). */
export function stepForField(field: SignUpField): Step {
  return field === "password" ? "signup-password" : "signup-name";
}

/**
 * Cris's line beside the card. "login" is her greeting when someone starts on the sign-in form; "login-password"
 * is what she says when they reach the password with a good email, before she looks away.
 */
export function crisLine(at: Step | "login-password", ctx: { email: string; name: string }): string {
  switch (at) {
    case "login":
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
      return "Account created! An admin will take it from here.";
  }
}

/** Cris's line for a failed check or server error. */
export function errorLine(message: string): string {
  return `Hmm. ${message}`;
}

/**
 * The signed-in sequence (owner's decision: it plays only while the sign-in request is in flight, and never holds
 * the redirect). Each status line, Cris's mood for it and how far the progress bar runs.
 */
export function enterLines(name: string): { text: string; mood: CrisMood; bar: number }[] {
  return [
    { text: "Checking your badge…", mood: "search", bar: 0.25 },
    { text: "Unlocking the stockroom…", mood: "think", bar: 0.5 },
    { text: "Counting your assets…", mood: "search", bar: 0.82 },
    { text: name ? `Welcome back, ${name}!` : "Welcome back!", mood: "talk", bar: 1 },
    { text: "Opening your dashboard…", mood: "idle", bar: 1 },
  ];
}

/** A fact Cris tells when the page sits idle or she is tapped; a quiz pauses before its answer. */
export type Fact = { q: string; a?: string; mood?: CrisMood };

/**
 * The owner's facts, minus every line that names or points at a real person (owner's decisions, 2026-10-21 and the
 * final review, which dropped a line about the creator): only this one is left.
 */
export const FACTS: readonly Fact[] = [
  { q: "My original design came from Raphael in Tensura." },
];

/**
 * The next fact from a shuffled bag, so every fact comes up once before any repeats and never twice in a row.
 * Returns the fact's index and the bag left over. `random` is Math.random in the page, injectable for tests.
 */
export function nextFact(
  bag: number[],
  last: number | null,
  count: number,
  random: () => number = Math.random,
): { index: number; bag: number[] } {
  let left = bag;
  if (left.length === 0) {
    left = Array.from({ length: count }, (_, i) => i).filter((i) => count < 2 || i !== last);
    for (let i = left.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [left[i], left[j]] = [left[j]!, left[i]!];
    }
  }
  return { index: left[0]!, bag: left.slice(1) };
}
