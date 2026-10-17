import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ASSIGNABLE_FROM } from "@/lib/asset-class";

/**
 * Phase 39 (spec §6): the profile no longer ships every assignable IT spare — the Fill, Replace and Reserve
 * pickers ask `spareCandidates` when they open, and again as the operator types.
 */
export const SPARE_LIMIT = 50;
export const SPARE_DEBOUNCE_MS = 250;
/** The longest text the spare search sends; the inputs stop there, so the schema's cap is never the operator's error. */
export const SPARE_QUERY_MAX = 60;

export interface SpareOption {
  id: string;
  tag: string;
  model: string;
  typeId: string | null;
  reservedFor: string | null; // employee name, or null
  reservedForThis: boolean;
  /** Phase 29 (spec §4.5): an open approval already promises this spare — unpickable, and it says which request. */
  pendingRef: string | null;
}

export const spareCandidatesSchema = z.object({
  employeeId: z.string().min(1),
  assetTypeId: z.string().min(1).optional(),
  q: z.string().trim().max(SPARE_QUERY_MAX).optional(),
  /** Replace and Reserve: leave out, server-side, what this person may not pick (`heldOrQueuedWhere`). */
  pickable: z.literal(true).optional(),
});

// The same states approvals/create.ts calls OPEN_APPROVAL_STATES — repeated here because src/lib cannot import src/server.
const OPEN_APPROVAL = ["PENDING", "CLAIMED", "APPROVED"] as const;

/**
 * The profile's spare pool, moved here from the profile page unchanged. Assignment through /employees is IT's
 * surface (Phase 13) — pinned to the IT class explicitly so a picker never offers a STORED car by accident.
 */
export function spareWhere(): Prisma.AssetWhereInput {
  return { cls: "IT", status: ASSIGNABLE_FROM.IT, returnedAt: null };
}

/**
 * The spares a picker cannot offer this person: held for someone else, or promised by an open request — the
 * server-side twin of `isUnpickable`, for the pool-wide counts.
 */
export function heldOrQueuedWhere(employeeId: string): Prisma.AssetWhereInput {
  return {
    OR: [
      { reservations: { some: { state: "ACTIVE", employeeId: { not: employeeId } } } },
      { approvals: { some: { state: { in: [...OPEN_APPROVAL] } } } },
    ],
  };
}

/**
 * Phase 41 (Cris, "spare laptops in stock"): the spares free for anyone — the pool less every spare held for
 * someone (an ACTIVE hold) or promised by an open request. With no person named, nobody's hold is theirs.
 */
export function stockWhere(): Prisma.AssetWhereInput {
  return {
    AND: [
      spareWhere(),
      {
        NOT: {
          OR: [
            { reservations: { some: { state: "ACTIVE" } } },
            { approvals: { some: { state: { in: [...OPEN_APPROVAL] } } } },
          ],
        },
      },
    ],
  };
}

/** The pool, narrowed by the typed text: a case-insensitive match on the tag or the model. */
export function spareSearchWhere(q?: string): Prisma.AssetWhereInput {
  const term = q?.trim();
  if (!term) return spareWhere();
  return {
    AND: [
      spareWhere(),
      { OR: [{ tag: { contains: term, mode: "insensitive" } }, { model: { contains: term, mode: "insensitive" } }] },
    ],
  };
}

/**
 * The rows' pool: `spareSearchWhere`, and with `pickable` without the spares held or queued for someone else — so a
 * picker that cannot offer those (Replace, Reserve) never gets 50 rows it must hide while free spares exist. The
 * counts are never narrowed by it: they stay pool-wide.
 */
export function spareCandidatesWhere(employeeId: string, q?: string, pickable?: boolean): Prisma.AssetWhereInput {
  const pool = spareSearchWhere(q);
  return pickable ? { AND: [pool, { NOT: heldOrQueuedWhere(employeeId) }] } : pool;
}

/** What each candidate row carries, so the pickers can say who holds it and which request promises it. */
export const SPARE_INCLUDE = {
  reservations: { where: { state: "ACTIVE" }, select: { employeeId: true, employee: { select: { name: true } } } },
  // Phase 29 (final review I-1, ruling R7): asked per asset, so a spare ANOTHER person's request is already
  // waiting on reads as promised here too — exactly what the "held or queued for someone else" line claims.
  approvals: {
    where: { state: { in: [...OPEN_APPROVAL] } },
    select: { refNo: true },
    orderBy: { createdAt: "asc" },
    take: 1,
  },
} satisfies Prisma.AssetInclude;

export interface SpareRow {
  id: string;
  tag: string;
  model: string;
  typeId: string | null;
  reservations: Array<{ employeeId: string; employee: { name: string } }>;
  approvals: Array<{ refNo: string }>;
}

/** One row as the dialogs read it; `employeeId` is the profile's person, for "reserved for them". */
export function toSpareOption(row: SpareRow, employeeId: string): SpareOption {
  const hold = row.reservations[0];
  return {
    id: row.id, tag: row.tag, model: row.model, typeId: row.typeId,
    reservedFor: hold?.employee.name ?? null,
    reservedForThis: hold?.employeeId === employeeId,
    pendingRef: row.approvals[0]?.refNo ?? null,
  };
}

/** Same type first, then by tag (the order the pickers always used), at most `limit`. */
export function orderSpareCandidates<T extends { typeId: string | null; tag: string }>(
  rows: T[], typeId: string | null, limit = SPARE_LIMIT,
): T[] {
  const rank = (r: T) => (typeId !== null && r.typeId === typeId ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.tag.localeCompare(b.tag)).slice(0, limit);
}

/** A spare promised to someone else (held for another person, or queued by an open request) — never pickable. */
export function isUnpickable(s: Pick<SpareOption, "reservedFor" | "reservedForThis" | "pendingRef">): boolean {
  return (s.reservedFor !== null && !s.reservedForThis) || !!s.pendingRef;
}

/** Pool-wide counts, so the dialogs' lines never depend on which 50 rows were loaded. */
export interface SpareCounts {
  total: number;
  heldOrQueued: number;
}

/** What the untyped call returns beside the rows: the whole pool, and the slot's type when one was asked for. */
export interface SpareCandidateCounts {
  all: SpareCounts;
  sameType: SpareCounts | null;
}

export interface SpareCandidates {
  spares: SpareOption[];
  /** Only on the untyped call — a search answer is about its rows, not the pool. */
  counts: SpareCandidateCounts | null;
}

export type ReplacePicker =
  | { kind: "empty" }
  | { kind: "allHeld"; count: number }
  | { kind: "pick"; hidden: number };

/**
 * Replace (Phase 29 plan P-9): nothing in stock, everything promised to someone else, or a picker with how many
 * it leaves out — decided on the pool-wide counts. Two counts read a moment apart can cross, hence `>=`.
 */
export function replacePicker(c: SpareCounts): ReplacePicker {
  if (c.total === 0) return { kind: "empty" };
  if (c.heldOrQueued >= c.total) return { kind: "allHeld", count: c.total };
  return { kind: "pick", hidden: c.heldOrQueued };
}

/**
 * Fill (Phase 29 spec §4.4): the sole pickable spare of the slot's type is preselected — only when the pool has
 * exactly one, and only when that one is among the rows loaded.
 */
export function solePick(rows: SpareOption[], typeId: string | null, c: SpareCounts): string | null {
  if (c.total - c.heldOrQueued !== 1) return null;
  const pickable = rows.filter((s) => s.typeId !== null && s.typeId === typeId && !isUnpickable(s));
  return pickable.length === 1 ? pickable[0].id : null;
}
