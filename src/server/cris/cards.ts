import type { Prisma } from "@prisma/client";
import { SPARE_INCLUDE, SPARE_LIMIT, orderSpareCandidates, spareCandidatesWhere } from "@/lib/spare-candidates";
import { toSpareRef, type AssetSnapshot, type PersonSnapshot, type SparesCard } from "@/lib/cris-cards";

/*
 * The DB reads every Cris card is built from, by id (spec §4, §6): never from the model's words. Not "use server"
 * — these read any person or asset they are handed; the callers apply who may see what.
 */

type Db = Prisma.TransactionClient;

/** The person a card names: their row and the name of the group they work for (a department or a client). */
export async function readPerson(db: Db, employeeId: string): Promise<PersonSnapshot | null> {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, employeeNo: true, department: { select: { name: true } } },
  });
  return e ? { id: e.id, name: e.name, employeeNo: e.employeeNo, worksFor: e.department.name } : null;
}

const RETURN_ACTIONS = ["lifecycle.return", "lifecycle.return executed", "lifecycle.replace", "lifecycle.replace executed"];

/**
 * When the asset last came back to IT: its newest return entry (a return, or the leg of a replace that took it
 * back — the one whose assignee went to nobody). Reads at most ten entries.
 */
export async function backOnFor(db: Db, assetId: string): Promise<Date | null> {
  const rows = await db.auditEntry.findMany({
    where: { entityType: "asset", entityId: assetId, action: { in: RETURN_ACTIONS } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 10,
    select: { diff: true, createdAt: true },
  });
  for (const r of rows) {
    const assignee = (r.diff as { assignee?: { to?: unknown } } | null)?.assignee;
    if (assignee && assignee.to === null) return r.createdAt;
  }
  return null;
}

/** An asset as a card shows it: tag, model, serial, type, warranty end and when it came back. */
export async function readAsset(db: Db, assetId: string): Promise<(AssetSnapshot & { typeId: string | null }) | null> {
  const a = await db.asset.findUnique({
    where: { id: assetId },
    select: { id: true, tag: true, model: true, serial: true, typeId: true, warrantyUntil: true, type: { select: { name: true } } },
  });
  if (!a) return null;
  return {
    id: a.id, tag: a.tag, model: a.model, serial: a.serial, typeId: a.typeId, typeName: a.type?.name ?? null,
    warrantyUntil: a.warrantyUntil, backOn: await backOnFor(db, a.id),
  };
}

/** Spec §4: the pick list shows three at a time; "None of these — show 3 more" asks for the next offset. */
export const SPARES_PAGE = 3;

/**
 * The pick list: the same pool the profile's Replace picker reads (`spareCandidates` with `pickable: true` — so
 * spares held or queued for someone else never show), the given type first, then by tag; `SPARES_PAGE` from
 * `offset`, and whether more follow.
 */
export async function sparesCard(
  db: Db, employeeId: string, opts: { typeId?: string | null; offset?: number } = {},
): Promise<SparesCard> {
  const offset = Math.max(0, opts.offset ?? 0);
  const typeId = opts.typeId ?? null;
  const pool = spareCandidatesWhere(employeeId, undefined, true);
  const find = (narrow: Prisma.AssetWhereInput) => db.asset.findMany({
    where: { AND: [pool, narrow] },
    include: { ...SPARE_INCLUDE, type: { select: { name: true } } },
    orderBy: { tag: "asc" },
    take: SPARE_LIMIT,
  });
  // Two bounded reads, as spareCandidates does, so the wanted type is never crowded out by others earlier in the alphabet.
  const [sameType, others] = await Promise.all([
    typeId ? find({ typeId }) : Promise.resolve([]),
    find(typeId ? { OR: [{ typeId: null }, { typeId: { not: typeId } }] } : {}),
  ]);
  const ordered = orderSpareCandidates([...sameType, ...others], typeId);
  const page = ordered.slice(offset, offset + SPARES_PAGE);
  const options = await Promise.all(page.map(async (r) => toSpareRef({
    id: r.id, tag: r.tag, model: r.model, serial: r.serial, typeName: r.type?.name ?? null,
    warrantyUntil: r.warrantyUntil, backOn: await backOnFor(db, r.id),
  })));
  return { type: "spares", employeeId, options, offset, more: ordered.length > offset + SPARES_PAGE };
}
