import { isAllowedDomain } from "@/lib/auth-shared";
import { passwordProblem } from "@/lib/password-rules";

export type SignUpField = "name" | "email" | "password";

/**
 * The sign-up checks, in the order the form reports them. Pure so the rules
 * can be tested without the database; the caller passes the already-normalized
 * email and the allowed domain (null = unrestricted).
 */
export function signUpProblem(
  input: { name: string; email: string; password: string },
  domain: string | null,
): { error: string; field: SignUpField } | null {
  if (input.name.trim().length < 2) return { error: "Enter your name.", field: "name" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
    return { error: "Enter a valid email.", field: "email" };
  }
  // Users & access (spec §4.3): the shared password rules (10+ characters, letters and a number). A new account has
  // no current or temporary password to differ from.
  const passwordError = passwordProblem(input.password, {});
  if (passwordError) return { error: passwordError, field: "password" };
  if (!isAllowedDomain(input.email, domain)) {
    return { error: `Signup is limited to @${domain} addresses.`, field: "email" };
  }
  return null;
}
