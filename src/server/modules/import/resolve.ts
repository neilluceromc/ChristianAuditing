import { prisma } from "@/server/db/client";
import { refKey } from "@/lib/import-assets";
import type { AssetRecordRef, AssetRefs, EmployeeRef } from "@/lib/import-assets";
import type { EmploymentStatus } from "@prisma/client";

/** Every field `AssetRecordRef` needs, straight off the Prisma select. */
const RECORD_SELECT = {
  id: true,
  tag: true,
  status: true,
  assigneeId: true,
  categoryId: true,
  typeId: true,
} as const;

interface RawRecord {
  id: string;
  tag: string;
  status: AssetRecordRef["status"];
  assigneeId: string | null;
  categoryId: string;
  typeId: string | null;
}

function toRecordRef(a: RawRecord): AssetRecordRef {
  return {
    id: a.id,
    tag: a.tag,
    status: a.status,
    assigneeId: a.assigneeId,
    categoryId: a.categoryId,
    typeId: a.typeId,
  };
}

interface CategoryRow {
  id: string;
  name: string;
}
interface TypeRow {
  id: string;
  name: string;
  categoryId: string;
}
interface EmployeeRow {
  id: string;
  name: string;
  employeeNo: string;
  employment: EmploymentStatus;
}
interface VendorRow {
  id: string;
  name: string;
}

/**
 * Two-pass name → id resolution shared by categories, types (within their
 * own category, via `keyOf`) and vendors (R-1, round 2): count `keyOf`
 * collisions first, then resolve each key to its id, or `null` when more
 * than one row shares it. `AssetCategory.name` and `Vendor.name` are
 * `@unique`, and `AssetType` is `@@unique([categoryId, name])` — but
 * Postgres unique is CASE-SENSITIVE, and nothing in `reference-actions.ts`
 * checks case-insensitively, so the admin UI happily accepts "Laptop" and
 * "laptop" as two distinct rows. Without this guard, every sheet row naming
 * either would resolve to whichever the UNORDERED query happened to return
 * last — no block, no P2002, no signal, just every one of them silently
 * filed under the wrong id. `null` makes that undecidable state block
 * instead of guessing. (`resolveAssetRefs` also orders these queries by
 * name for determinism — belt-and-suspenders once this two-pass count is in
 * place, since the OUTCOME here no longer depends on row order: a key with
 * exactly one row is never ambiguous regardless of where it lands, and a
 * key with more than one is always `null` regardless of order.)
 */
function buildCollisionMap<T extends { id: string }>(
  rows: T[],
  keyOf: (row: T) => string,
): Map<string, string | null> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const map = new Map<string, string | null>();
  for (const row of rows) {
    const key = keyOf(row);
    map.set(key, (counts.get(key) ?? 0) > 1 ? null : row.id);
  }
  return map;
}

/**
 * The pure half of asset-ref resolution (R-3, round 2). `resolveAssetRefs`
 * below is six Prisma calls and one call to this; every defect this review
 * found — the composite type key, the two-pass employee ambiguity, the
 * employeeNo-over-name overwrite, `refKey`'s whitespace handling, R-1's
 * collision guard — lives here, in ~40 lines of pure map-building, not in
 * the queries. Extracted so it can be unit-tested with hand-built arrays
 * (`resolve.test.ts`) instead of needing a database for every one of those
 * defects — before this, the banner claimed "the unit suite cannot see any
 * of this," which was true only because the two were welded together.
 */
export function buildAssetRefs(
  categories: CategoryRow[],
  types: TypeRow[],
  employees: EmployeeRow[],
  vendors: VendorRow[],
  byTagRows: RawRecord[],
  bySerialRows: (RawRecord & { serial: string | null })[],
): AssetRefs {
  // Employee.name is NOT unique (only employeeNo is), so a name matching more
  // than one employee must resolve `ambiguous: true` and block, rather than
  // silently keeping whichever row the map happened to insert last. Two
  // passes: count refKey'd names first, then set each name key with
  // `ambiguous` decided from that count.
  //
  // Ambiguity is counted across ALL employees regardless of `employment` —
  // deliberately, not an oversight (Minor, round 2): narrowing the count to
  // ACTIVE-only would silently GUESS which of several same-named people was
  // meant (an OFFBOARDED record sharing a name with an ACTIVE one might be
  // the one actually intended), and two records sharing a name may simply be
  // two different people who happen to share it. Either way the ambiguity is
  // real and must block, not be resolved by discarding a candidate.
  const nameCounts = new Map<string, number>();
  for (const e of employees) {
    const key = refKey(e.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const employeeMap = new Map<string, EmployeeRef>();
  for (const e of employees) {
    const key = refKey(e.name);
    employeeMap.set(key, { id: e.id, employment: e.employment, ambiguous: (nameCounts.get(key) ?? 0) > 1 });
  }
  // employeeNo keys are never ambiguous, and set AFTER names so a number that
  // collides with someone else's name wins over the name key it collided with.
  for (const e of employees) {
    employeeMap.set(refKey(e.employeeNo), { id: e.id, employment: e.employment, ambiguous: false });
  }

  return {
    categories: buildCollisionMap(categories, (c) => refKey(c.name)),
    // Composite key: `${categoryId}:${refKey(name)}` — AssetType is only
    // unique PER CATEGORY, so the collision guard is scoped the same way:
    // "Standard" under two different categories is not a collision, but
    // "Standard"/"standard" under the SAME category is.
    types: buildCollisionMap(types, (t) => `${t.categoryId}:${refKey(t.name)}`),
    employees: employeeMap,
    vendors: buildCollisionMap(vendors, (v) => refKey(v.name)),
    // Tags and serials match EXACTLY, straight off the row the database
    // returned (tags are already upper-case in storage) — NOT `refKey()`'d,
    // unlike every map above. A case-insensitive match here would let two
    // visually distinct tags resolve to the same asset.
    byTag: new Map(byTagRows.map((a) => [a.tag, toRecordRef(a)])),
    bySerial: new Map(bySerialRows.flatMap((a) => (a.serial ? [[a.serial, toRecordRef(a)] as const] : []))),
  };
}

/**
 * Every lookup the row rules need, in six queries rather than six per row.
 *
 * The tag and serial lookups are scoped to what the FILE mentions: importing
 * 50 rows must not pull 20,000 assets into memory to discover none of them
 * collide. Reference tables (categories/types/employees/vendors) are small
 * and fetched whole, each ordered by name (R-1, round 2) — determinism, not
 * correctness, once `buildAssetRefs`'s two-pass count is in place, but cheap
 * and asked-for regardless: without it, the SAME sheet's dry run and T10's
 * re-validation could each see a same-name pair in a different heap order,
 * which is exactly the kind of divergence scope decision 3 promises can't
 * happen between a verdict and the write it authorises.
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
    prisma.assetCategory.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Categories AND names, never a flat name→id map: AssetType is
    // `@@unique([categoryId, name])`, not globally unique, so two categories
    // can each have their own same-named type and a flat key would silently
    // resolve to whichever was inserted last.
    prisma.assetType.findMany({
      select: { id: true, name: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
    // `employment` selected so an OFFBOARDED/non-ACTIVE holder can be seen
    // and refused the way `createAsset` refuses one (actions.ts:196).
    prisma.employee.findMany({
      select: { id: true, name: true, employeeNo: true, employment: true },
      orderBy: { name: "asc" },
    }),
    prisma.vendor.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    upperTags.length
      ? prisma.asset.findMany({ where: { tag: { in: upperTags } }, select: RECORD_SELECT })
      : Promise.resolve([]),
    serials.length
      ? prisma.asset.findMany({ where: { serial: { in: serials } }, select: { ...RECORD_SELECT, serial: true } })
      : Promise.resolve([]),
  ]);

  return buildAssetRefs(categories, types, employees, vendors, byTagRows, bySerialRows);
}
