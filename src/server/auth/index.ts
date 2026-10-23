import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";
import { isQuickLoginEmail, parseQuickLoginEmails, quickLoginUser } from "@/lib/quick-login";
import { authConfigEdge } from "./config.edge";
import { passwordMatches } from "./password-check";
import { recordSignInFailure, signInPaused } from "./sign-in-limit";

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(credentials) {
      const email = normalizeEmail(String(credentials?.email ?? "")).slice(0, 320);
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;
      // Users & access (spec §4.6): the sign-in form (signInWithCredentials) checks the pause and counts failures
      // before it calls signIn. These two lines hold the same rule for a direct POST to /api/auth/callback/credentials,
      // which never passes through that action. From the action they are no-ops: a paused or wrong attempt never
      // reaches signIn, and a right one has just cleared the count.
      if (await signInPaused(email)) return null;
      const user = await prisma.user.findUnique({ where: { email } });
      // Always one bcrypt compare (a dummy hash when the row is missing/passwordless)
      // so response timing doesn't reveal whether an account exists or is disabled.
      if (!(await passwordMatches(password, user?.passwordHash))) {
        await recordSignInFailure(email);
        return null;
      }
      if (!user || user.disabled || user.approvalState !== "APPROVED") return null;
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfigEdge,
  providers,
});
