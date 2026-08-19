import { prisma } from "@/server/db/client";
import { lockReason, roleWorkspaces, type TargetUser } from "@/lib/admin-users";
import type { Role } from "@prisma/client";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabled: boolean;
  /** non-null → the row is locked, and this is the sentence explaining why */
  locked: string | null;
  /** a passwordHash-less row can only arrive via Entra */
  signIn: "credentials" | "SSO only";
  /** "all four" | "IT · read-only" | … — see roleWorkspaces */
  workspaces: string;
  /**
   * The exact shape every rule in `@/lib/admin-users` reads, passed straight
   * through rather than left for the client to rebuild — a client-synthesized
   * copy of this object is exactly the kind of thing that quietly hardcodes a
   * field (isPermanentAdmin, say) that happens to be right today.
   */
  target: TargetUser;
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await prisma.user.findMany({
    orderBy: [{ isPermanentAdmin: "desc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, role: true,
      isPermanentAdmin: true, disabled: true, passwordHash: true,
    },
  });
  return rows.map((r) => {
    const target: TargetUser = {
      id: r.id, role: r.role, isPermanentAdmin: r.isPermanentAdmin, disabled: r.disabled,
    };
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      disabled: r.disabled,
      locked: lockReason(target),
      signIn: r.passwordHash ? "credentials" : "SSO only",
      workspaces: roleWorkspaces(r.role),
      target,
    };
  });
}
