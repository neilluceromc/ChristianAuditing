import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";
import { isQuickLoginEmail, parseQuickLoginEmails, quickLoginUser } from "@/lib/quick-login";
import { authConfigEdge } from "./config.edge";
import { passwordMatches } from "./password-check";
import { clearSignInFailures, releaseSignInAttempt, reserveSignInAttempt } from "./sign-in-limit";

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(credentials) {
      const email = normalizeEmail(String(credentials?.email ?? "")).slice(0, 320);
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;
      // Users & access (spec §4.6): the same rule as the sign-in form (signInWithCredentials), for a direct POST to
      // /api/auth/callback/credentials, which never passes through that action. Reserve under the per-email lock
      // (refused when paused), check the password once, then keep, release or clear the attempt exactly as the form
      // does. From the form this runs only after a right password, whose count the form has just cleared.
      const attempt = await reserveSignInAttempt(email);
      if (attempt.paused) return null;
      const user = await prisma.user.findUnique({ where: { email } });
      // Always one bcrypt compare (a dummy hash when the row is missing/passwordless)
      // so response timing doesn't reveal whether an account exists or is disabled.
      const matches = await passwordMatches(password, user?.passwordHash);
      if (!user || !matches) return null; // the reserved attempt stays as the failure
      if (user.approvalState !== "APPROVED") {
        await releaseSignInAttempt(attempt.attemptId); // the right password: not a failure
        return null;
      }
      if (user.disabled) return null; // counted, so it reads exactly like a wrong password (fix round 1, M-2)
      // Fix round 1 (M-1): a successful sign-in clears the count and stamps lastSignInAt on this path too.
      await clearSignInFailures(email);
      await prisma.user.update({ where: { id: user.id }, data: { lastSignInAt: new Date() } });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        sessionVersion: user.sessionVersion,
        mustChangePassword: user.mustChangePassword,
      };
    },
  }),
];

// SSO is NOT functional yet: there is no signIn callback mapping an Entra
// profile to a User row, so an Entra login would carry no role. Registering
// only when fully configured keeps a half-set env from showing a broken button.
// TODO(sso-phase): add a signIn callback resolving entraObjectId/email → User.
if (
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
) {
  providers.push(MicrosoftEntraID);
}

// Staging-only one-click sign-in (no password). Registered only when
// QUICK_LOGIN_EMAILS lists accounts at startup — never set it in production.
if (parseQuickLoginEmails(process.env.QUICK_LOGIN_EMAILS).length > 0) {
  providers.push(
    Credentials({
      id: "quick-login",
      name: "Quick sign-in",
      credentials: { email: {} },
      async authorize(credentials) {
        const email = normalizeEmail(String(credentials?.email ?? "")).slice(0, 320);
        if (!isQuickLoginEmail(email, process.env.QUICK_LOGIN_EMAILS)) return null;
        const row = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true, email: true, name: true, role: true, disabled: true,
            approvalState: true, sessionVersion: true, mustChangePassword: true,
          },
        });
        // Users & access: a waiting or declined account is refused here too, and the token carries the version the
        // guards compare (without it they would sign the person straight back out).
        if (!row || row.approvalState !== "APPROVED") return null;
        const user = quickLoginUser(email, process.env.QUICK_LOGIN_EMAILS, row);
        return user && { ...user, sessionVersion: row.sessionVersion, mustChangePassword: row.mustChangePassword };
      },
    }),
  );
}

// unstable_update: for Tasks 2/3, always with `await signedSessionUpdate(...)` (session-version.ts) as its argument.
export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfigEdge,
  providers,
});
