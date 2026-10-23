import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role; sessionVersion: number; mustChangePassword: boolean } & DefaultSession["user"];
  }
  interface User {
    role: Role;
    /** Users & access (spec §4.2): the account's sessionVersion when this sign-in was issued. */
    sessionVersion: number;
    /** True while the person still owes their own password (an admin created the account or reset it). */
    mustChangePassword: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    /** Compared with User.sessionVersion by the guards; a token issued before this field existed reads as 0. */
    sessionVersion: number;
    mustChangePassword: boolean;
  }
}
