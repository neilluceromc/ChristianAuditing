import { prisma } from "@/server/db/client";
import type { AssetRecordRef, AssetRefs, EmployeeRef } from "@/lib/import-assets";

const lower = (s: string) => s.trim().toLowerCase();

/** Every field `AssetRecordRef` needs, straight off the Prisma select. */
const RECORD_SELECT = {
  id: true,
  tag: true,
  status: true,
  assigneeId: true,
  categoryId: true,
  typeId: true,
} as const;

function toRecordRef(a: {
  id: string;
  tag: string;
  status: AssetRecordRef["status"];
  assigneeId: string | null;
  categoryId: string;
  typeId: string | null;
}): AssetRecordRef {
  return {
    id: a.id,
    tag: a.tag,
    status: a.status,
    assigneeId: a.assigneeId,
    categoryId: a.categoryId,
    typeId: a.typeId,
  };
}

/**
 * Every lookup the row rules need, in six queries rather than six per row.
 *
 * The tag and serial lookups are scoped to what the FILE mentions: importing
 * 50 rows must not pull 20,000 assets into memory to discover none of them
 * collide. Reference tables (categories/types/employees/vendors) are small
 * and fetched whole.
 *
 * Tags are UPPER-CASED before the `in` query (and before they key `byTag`):
 * `createSchema`'s tag is `.toUpperCase().regex(/^BR-[A-Z]{2}-\d{4}$/)`, every
 * tag stored in the database is already upper-case, and `planAssetRows`
 * upper-cases the sheet's tag before consulting this same map (its rule 2).
 * Querying with the sheet's raw-case text would miss a row like
 * "br-lt-0148", `byTag` would have no entry, the row would plan as a
 * CREATE, and Postgres's unique index on `tag` is case-sensitive — it would
 * happily accept a second record for the same physical machine. Serials are
 * matched EXACTLY as written (trimmed, not case-folded) — same convention
 * `planAssetRows` uses when it compares them — so they are not case-folded
 * here either.
 */
export async function resolveAssetRefs(tags: string[], serials: string[]): Promise<AssetRefs> {
  const upperTags = tags.map((t) => t.trim().toUpperCase());

  const [categories, types, employees, vendors, byTagRows, bySerialRows] = await Promise.all([
    prisma.assetCategory.findMany({ select: { id: true, name: true } }),
    // Categories AND names, never a flat name→id map: AssetType is
    // `@@unique([categoryId, name])`, not globally unique, so two categories
    // can each have their own same-named type and a flat key would silently
    // resolve to whichever was inserted last.
    prisma.assetType.findMany({ select: { id: true, name: true, categoryId: true } }),
    // `employment` selected so an OFFBOARDED/non-ACTIVE holder can be seen
    // and refused the way `createAsset` refuses one (actions.ts:196).
    prisma.employee.findMany({ select: { id: true, name: true, employeeNo: true, employment: true } }),
    prisma.vendor.findMany({ select: { id: true, name: true } }),
    upperTags.length
      ? prisma.asset.findMany({ where: { tag: { in: upperTags } }, select: RECORD_SELECT })
      : Promise.resolve([]),
    serials.length
      ? prisma.asset.findMany({ where: { serial: { in: serials } }, select: { ...RECORD_SELECT, serial: true } })
      : Promise.resolve([]),
  ]);

  // Employee.name is NOT unique (only employeeNo is), so a name matching more
  // than one employee must resolve `ambiguous: true` and block, rather than
  // silently keeping whichever row the map happened to insert last. Two
  // passes: count lowercased names first, then set each name key with
  // `ambiguous` decided from that count.
  const nameCounts = new Map<string, number>();
  for (const e of employees) {
    const key = lower(e.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const employeeMap = new Map<string, EmployeeRef>();
  for (const e of employees) {
    const key = lower(e.name);
    employeeMap.set(key, { id: e.id, employment: e.employment, ambiguous: (nameCounts.get(key) ?? 0) > 1 });
  }
  // employeeNo keys are never ambiguous, and set AFTER names so a number that
  // collides with someone else's name wins over the name key it collided with.
  for (const e of employees) {
    employeeMap.set(lower(e.employeeNo), { id: e.id, employment: e.employment, ambiguous: false });
  }

  return {
    categories: new Map(categories.map((c) => [lower(c.name), c.id])),
    types: new Map(types.map((t) => [`${t.categoryId}:${lower(t.name)}`, { id: t.id, categoryId: t.categoryId }])),
    employees: employeeMap,
    vendors: new Map(vendors.map((v) => [lower(v.name), v.id])),
    byTag: new Map(byTagRows.map((a) => [a.tag, toRecordRef(a)])),
    bySerial: new Map(bySerialRows.flatMap((a) => (a.serial ? [[a.serial, toRecordRef(a)] as const] : []))),
  };
}
