import { prisma } from "@/server/db/client";
import { lockReason, roleWorkspaces, ROLE_OPTIONS, type TargetUser } from "@/lib/admin-users";
import { FLAG_SPECS, flagEnabled, type FlagState } from "@/lib/admin-flags";
import { fmtDateTime } from "@/lib/format";
import {
  DELIVERY_TABS, deliveryStage, partitionEvents, replayBlockedReason, type DeliveryTab,
  type WebhookEvent,
} from "@/lib/webhooks";
import type { Prisma, Role } from "@prisma/client";

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
   * the EFFECTIVE state, computed with `flagEnabled()` (the same expression
   * `/login` and `/signup` use via `flagDomain`). `createBootstrapAdmin` with a blank domain
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
      enabled: flagEnabled(spec, row),
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

export interface AdminHome {
  users: { total: number; disabled: number; byRole: Array<{ role: Role; count: number }> };
  flags: Array<{ key: string; label: string; enabled: boolean; unavailable: boolean }>;
  webhooks: { endpoints: number; inactive: number; dead: number; delivered: number };
}

export async function adminHome(): Promise<AdminHome> {
  const [byRole, disabled, flagRows, endpoints, inactive, dead, delivered] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.count({ where: { disabled: true } }),
    prisma.featureFlag.findMany(),
    prisma.webhookEndpoint.count(),
    prisma.webhookEndpoint.count({ where: { active: false } }),
    prisma.webhookDelivery.count({ where: { status: "DEAD" } }),
    prisma.webhookDelivery.count({ where: { status: "DELIVERED" } }),
  ]);

  const rowByKey = new Map(flagRows.map((f) => [f.key, f]));
  return {
    users: {
      total: byRole.reduce((sum, g) => sum + g._count._all, 0),
      disabled,
      // Driven by ROLE_OPTIONS so a role nobody holds still shows as 0 rather
      // than vanishing — "no admins" is exactly the kind of thing a zero row
      // is for. ROLE_OPTIONS lists every Role enum value, so this sum can
      // never disagree with the reduce() above.
      byRole: ROLE_OPTIONS.map((role) => ({
        role,
        count: byRole.find((g) => g.role === role)?._count._all ?? 0,
      })),
    },
    // FLAG_SPECS-driven for the same reason as listFlags: a hand-inserted row
    // is not something this page should report as configuration.
    flags: FLAG_SPECS.map((spec) => ({
      key: spec.key,
      label: spec.label,
      // flagEnabled, not the raw row.enabled column — see its doc comment.
      // Reading the raw column here would let this summary show ON for
      // allowed_domain while /signup enforces nothing (HANDOVER §6a rule 15).
      enabled: flagEnabled(spec, rowByKey.get(spec.key)),
      // `spec` is already the FLAG_SPECS entry for this key, so reading
      // spec.unavailable directly is the same lookup specFor(spec.key) would
      // do, minus the redundant re-scan of the array we're already iterating.
      unavailable: !!spec.unavailable,
    })),
    webhooks: { endpoints, inactive, dead, delivered },
  };
}

export interface DeliveryRow {
  id: string;
  endpointUrl: string;
  event: string;
  when: string;
  attempts: number;
  lastError: string | null;
  /**
   * The raw DeliveryStatus. `StatusPill` derives the colour from THIS, with
   * `ns="delivery"` — unnamespaced, PENDING resolves to the approval family
   * (attention) and a healthy queued delivery goes amber, indistinguishable
   * from a failing one (Task 6, `src/lib/status.ts`).
   */
  status: string;
  /** The chip's LABEL only — "DEAD · 5/5". Never passed where `status` belongs. */
  stageLabel: string;
  /**
   * Whether a live Replay control may render. Every one of `replayDelivery`'s
   * refusals is folded in here, which is the point: a button whose click is
   * guaranteed to fail is §6a rule 10's exact shape.
   */
  replayable: boolean;
}

const DELIVERY_PAGE = 50;

/**
 * A live `DELIVER_WEBHOOK` job's delivery id, or null for a payload that has
 * none. Defensive about the shape because `Job.payload` is a `Json` column: it
 * can legally hold an array or a bare string, and the migration that added
 * `Job_one_live_deliver_per_delivery` had to add a CHECK constraint precisely
 * because a payload with no `deliveryId` is possible.
 */
function liveDeliveryId(payload: Prisma.JsonValue): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = payload.deliveryId;
  return typeof id === "string" ? id : null;
}

/**
 * Scope decision #12: no pagination, matching `/approvals` — the newest
 * `DELIVERY_PAGE` attempts, with a line saying so when there are more.
 *
 * `WebhookDelivery.nextAttemptAt` is deliberately NOT read. Only the seed ever
 * writes it (`prisma/seed.ts`) — the worker's retry path (`mark` in
 * `src/worker/deliver-webhook.ts`) never does, it only clears the column on a
 * success — so a "next attempt" column sourced from it would read as authoritative
 * and be blank for every delivery the running code produced. The real schedule
 * is the job's `runAt`; if this page ever shows it, take it from there.
 */
export async function listDeliveries(
  tab: DeliveryTab,
): Promise<{ rows: DeliveryRow[]; total: number; deadReplayable: number }> {
  const statuses = DELIVERY_TABS.find((t) => t.id === tab)!.statuses;
  const where: Prisma.WebhookDeliveryWhereInput = statuses
    ? { status: { in: [...statuses] } }
    : {};

  const [rows, total, deadReplayable, liveJobs] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      // An explicit `select`, not `include: { endpoint: true }`: that pulls
      // every endpoint scalar including the encrypted `secret`, for the same
      // reason `listEndpoints` above spells its columns out. The ciphertext
      // has no business crossing this boundary even to be discarded here.
      select: {
        id: true, event: true, status: true, attempts: true, lastError: true, createdAt: true,
        endpoint: { select: { url: true, active: true } },
      },
      // createdAt alone is not a stable order — rows written in one
      // transaction share a millisecond (HANDOVER §7), and this seed writes
      // five in one `createMany`. The id tiebreaker is mandatory.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: DELIVERY_PAGE,
    }),
    prisma.webhookDelivery.count({ where }),
    // Not filtered by `tab`: this is the batch control's offer, and it means
    // the same thing on every tab. A DEAD delivery cannot also hold a live
    // job — the worker dead-letters both in the same failure (`retryStatus`
    // and `tick`'s `dead` read the same `attempts` against the same cap) — so
    // this count needs no live-job exclusion the way `replayable` below does.
    prisma.webhookDelivery.count({ where: { status: "DEAD", endpoint: { active: true } } }),
    // One query for the whole live set rather than one per row. This is what
    // lets the page know, BEFORE the click, that `replayDelivery` would refuse
    // with "already queued" — without it, every freshly-emitted PENDING row and
    // every backing-off RETRYING row renders a Replay button whose P2002 is
    // guaranteed. The live set is bounded by how fast the worker drains it.
    prisma.job.findMany({
      where: { type: "DELIVER_WEBHOOK", status: { in: ["PENDING", "RUNNING"] } },
      select: { payload: true },
    }),
  ]);

  const queued = new Set(
    liveJobs.map((j) => liveDeliveryId(j.payload)).filter((id): id is string => id !== null),
  );

  return {
    total,
    deadReplayable,
    rows: rows.map((r) => ({
      id: r.id,
      endpointUrl: r.endpoint.url,
      event: r.event,
      when: fmtDateTime(r.createdAt),
      attempts: r.attempts,
      lastError: r.lastError,
      status: r.status,
      // No third argument: `deliveryStage` defaults the denominator to
      // MAX_JOB_ATTEMPTS, the worker's own cap. A local literal here is what
      // makes `DEAD · 3/5` possible the day someone tunes the worker.
      stageLabel: deliveryStage(r.status, r.attempts),
      // `replayBlockedReason` is the ONE owner of the conditions — the same
      // function `replayDelivery` refuses with — so a refusal added to the
      // action cannot leave a live Replay button behind here (§6a rule 10).
      // The sentence itself is not carried onto the row: the chip already says
      // DELIVERED or QUEUED, the disabled endpoint is stated on
      // /admin/webhooks, and a 90px actions column has no room for prose.
      replayable:
        replayBlockedReason({
          status: r.status,
          endpointUrl: r.endpoint.url,
          endpointActive: r.endpoint.active,
          alreadyQueued: queued.has(r.id),
        }) === null,
    })),
  };
}
