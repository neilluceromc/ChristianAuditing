import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";
import { authConfigEdge } from "./config.edge";

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(credentials) {
      const email = normalizeEmail(String(credentials?.email ?? ""));
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;
      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
      if (!user?.passwordHash || user.disabled) return null;
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return null;
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },
  }),
];

// Registered only when Entra credentials exist in the environment; the
// m365_sso DB flag additionally gates the login-page button (spec: flag-ready).
if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
  providers.push(MicrosoftEntraID);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfigEdge,
  providers,
});
