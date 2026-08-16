import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client"; // type-only: erased at build, edge-safe

/**
 * Edge-safe config: middleware.ts builds its own NextAuth instance from this.
 * NOTHING here may import Prisma or any Node-only API.
 */
export const authConfigEdge = {
  trustHost: true, // self-hosted behind localhost/LAN, not Vercel
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // cap a stale/terminated-user token at one workday

  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role as Role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
