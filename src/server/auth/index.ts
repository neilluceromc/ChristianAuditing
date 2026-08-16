import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";
import { authConfigEdge } from "./config.edge";

// A valid cost-10 bcrypt hash of a throwaway string; compared against when no
// user row exists so authorize() always spends the same time (anti-enumeration).
const DUMMY_HASH = "$2b$10$l89N0WvFRRNscT9OSQHFYOavkWnuDSQo.q6hXve35x64eOdY.U6my";

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(credentials) {
      const email = normalizeEmail(String(credentials?.email ?? "")).slice(0, 320);
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;
      const user = await prisma.user.findUnique({ where: { email } });
      // Always run bcrypt against a dummy hash when the row is missing/passwordless
      // so response timing doesn't reveal whether an account exists or is disabled.
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
      if (!ok || !user?.passwordHash || user.disabled) return null;
      return { id: user.id, email: user.email, name: user.name, role: user.role };
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfigEdge,
  providers,
});
