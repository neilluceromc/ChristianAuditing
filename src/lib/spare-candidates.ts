import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ASSIGNABLE_FROM } from "@/lib/asset-class";

/**
 * Phase 39 (spec §6): the profile no longer ships every assignable IT spare — the Fill, Replace and Reserve
 * pickers ask `spareCandidates` when they open, and again as the operator types.
 */
export const SPARE_LIMIT = 50;
export const SPARE_DEBOUNCE_MS = 250;

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
  q: z.string().trim().max(60).optional(),
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
