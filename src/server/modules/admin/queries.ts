import { prisma } from "@/server/db/client";
import { lockReason, roleWorkspaces, type TargetUser } from "@/lib/admin-users";
import { FLAG_SPECS, type FlagState } from "@/lib/admin-flags";
import { flagDomain } from "@/lib/auth-shared";
import { partitionEvents, type WebhookEvent } from "@/lib/webhooks";
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

export interface FlagRow {
  key: string;
  label: string;
  description: string;
  /**
   * What the switch shows. NOT `row.enabled` — for a `hasValue` flag this is
   * the EFFECTIVE state, computed with `flagDomain()` (the same expression
   * `/login` and `/signup` use). `createBootstrapAdmin` with a blank domain
   * writes `(enabled: false, value: null)`, not `(true, null)` — so the state
   * this exists to catch, `(enabled: true, value: null)`, has no in-app
   * producer at all now that `flagChange` refuses it; it's reachable only
   * out-of-band (psql, a restored backup, a migration). Still has to render
   * correctly if it shows up: `enabled: true` there would read as "wide open"
   * to every enforcement point, and the admin page claiming a restriction
   * nothing applies is the defect either state's mishandling would repeat.
   */
  enabled: boolean;
  hasValue: boolean;
  value: string | null;
  /** non-null → the switch is not usable, and this is the reason to print */
  unavailable: string | null;
  /**
   * The row exactly as `flagChange`/`flagChangeWarning` need to see it — not
   * `{ key, enabled, value }` rebuilt from the fields above, because `enabled`
   * above is the effective value and would silently feed the rule a lie for
   * exactly the row it exists to correct. Mirrors `UserRow.target`: the query
   * builds the rule's input, the client never synthesizes it.
   */
  state: FlagState;
}

/**
 * Driven by FLAG_SPECS, not by the table: a flag this build doesn't know about
 * is not something the admin page should offer a switch for, and a spec with no
 * row yet still renders (disabled, value null) rather than vanishing.
 */
export async function listFlags(): Promise<FlagRow[]> {
  const rows = await prisma.featureFlag.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return FLAG_SPECS.map((spec) => {
    const row = byKey.get(spec.key);
    const value = typeof row?.value === "string" ? row.value : null;
    const state: FlagState = { key: spec.key, enabled: row?.enabled ?? false, value };
    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      enabled: spec.hasValue ? flagDomain(row) !== null : row?.enabled ?? false,
      hasValue: spec.hasValue,
      value,
      unavailable: spec.unavailable,
      state,
    };
  });
}

export interface EndpointRow {
  id: string;
  url: string;
  events: WebhookEvent[];
  /**
   * Event names this row subscribes to that this build no longer recognises
   * (a rename, a removed integration). Kept separate from `events` — not
   * merged in and not silently dropped — because Task 8's editor owes the
   * admin a way to see these exist before a save that touches only the URL
   * can carry them forward or lose them.
   */
  unknownEvents: string[];
  active: boolean;
  /** how many attempts this endpoint has on record, and how many died */
  attempts: number;
  dead: number;
}

export async function listEndpoints(): Promise<EndpointRow[]> {
  const rows = await prisma.webhookEndpoint.findMany({
    orderBy: [{ url: "asc" }],
    // `secret` is not in the `select` below — verify by looking up four
    // lines, rather than trusting a comment that claims it. Without an
    // explicit `select`, Prisma pulls every scalar column, including the
    // ciphertext, and `EndpointRow` is consumed by a "use client" component:
    // that ciphertext would ride along in the RSC payload on every render.
    select: { id: true, url: true, events: true, active: true },
  });
  // Two grouped counts rather than N per-row queries.
  const [all, dead] = await Promise.all([
    prisma.webhookDelivery.groupBy({ by: ["endpointId"], _count: { _all: true } }),
    prisma.webhookDelivery.groupBy({
      by: ["endpointId"],
      where: { status: "DEAD" },
      _count: { _all: true },
    }),
  ]);
  const allBy = new Map(all.map((g) => [g.endpointId, g._count._all]));
  const deadBy = new Map(dead.map((g) => [g.endpointId, g._count._all]));
  return rows.map((r) => {
    const { known, unknown } = partitionEvents(r.events);
    return {
      id: r.id,
      url: r.url,
      events: known,
      unknownEvents: unknown,
      active: r.active,
      attempts: allBy.get(r.id) ?? 0,
      dead: deadBy.get(r.id) ?? 0,
    };
  });
}
