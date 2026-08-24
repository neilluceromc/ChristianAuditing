import { prisma } from "@/server/db/client";
import { refKey, tagKey } from "@/lib/import-assets";
import type { AssetRecordRef, AssetRefs, EmployeeRef } from "@/lib/import-assets";
import type { EmployeeRecordRef, EmployeeRefs } from "@/lib/import-employees";
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
 * and fetched whole, each ordered by name.
 *
 * That `orderBy` is deliberately NOT load-bearing, and the comment here used
 * to claim it was. R-1 (round 2) prescribed the ordering AND the collision
 * guard as if both were needed; the guard subsumes it. `buildAssetRefs`
 * counts keys before it assigns, so a key matching one row yields that row's
 * id and a key matching several yields `null` — the same answer in any
 * iteration order, which is why removing all four `orderBy` clauses leaves
 * the suite green. It stays because it costs nothing at these row counts and
 * makes debugging output stable, not because correctness rests on it.
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
  const upperTags = tags.map(tagKey);

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

interface DepartmentRow {
  id: string;
  name: string;
}
interface EmployeeIdentityRow {
  id: string;
  employeeNo: string;
  employment: EmploymentStatus;
}

/**
 * The pure half of employee-ref resolution (Task 12, mirroring
 * `buildAssetRefs`'s own extraction — unit-testable with hand-built arrays
 * from the start, rather than found unreachable by a review later, the
 * single most repeated structural defect this phase keeps finding).
 *
 * `departments` reuses `buildCollisionMap` (E-6) — the SAME R-1 guard
 * categories/types/vendors already have: `Department.name` is `@unique`,
 * but Postgres's unique index is case-sensitive, and `reference-actions.ts`'s
 * `createRefRow` never checks case, so "Finance" and "finance" can coexist.
 *
 * `byEmployeeNo` gets the SAME collision guard, and the argument for leaving
 * it off did not survive review. That argument was: nothing but the seed and
 * this importer creates an Employee, and this importer's own case-insensitive
 * match resolves a differently-cased row to an UPDATE, so no second variant
 * can arise. It is self-referential, and there is a live path it misses —
 * TWO CONCURRENT APPLIES. File A carries `EMP-0100`, file B carries
 * `emp-0100`, neither exists yet, so both plans say CREATE. Each row writes
 * in its own transaction (scope decision 4), and `Employee.employeeNo`'s
 * unique index is CASE-SENSITIVE, so neither insert collides and no P2002 is
 * raised. The database now holds two case-variants, and from then on a plain
 * map keys both to one entry and the last row read silently wins — every
 * later row naming that number updates whichever person the query happened to
 * return second. That is a wrong WRITE rather than a refusal, which is the
 * one defect class this phase ranks worst.
 *
 * The asset importer is immune only because `tagKey` upper-cases, so the
 * database index catches the race for it. Nothing upper-cases `employeeNo` —
 * E-2 forbids inventing a format rule for a column that has none — so the
 * guard is what stands in for the index here.
 */
export function buildEmployeeRefs(
  departments: DepartmentRow[],
  employees: EmployeeIdentityRow[],
): EmployeeRefs {
  // Same two-pass shape as `buildCollisionMap`: count the keys first, so a
  // key claimed by more than one row resolves to `null` (collision) rather
  // than to whichever row was read last.
  const counts = new Map<string, number>();
  for (const e of employees) {
    const key = refKey(e.employeeNo);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const byEmployeeNo = new Map<string, EmployeeRecordRef | null>();
  for (const e of employees) {
    const key = refKey(e.employeeNo);
    byEmployeeNo.set(key, (counts.get(key) ?? 0) > 1 ? null : { id: e.id, employment: e.employment });
  }
  return {
    departments: buildCollisionMap(departments, (d) => refKey(d.name)),
    byEmployeeNo,
  };
}

/**
 * Both reference tables are fetched WHOLE, not scoped to the file — the same
 * convention `resolveAssetRefs` already uses for categories/types/vendors
 * (and, notably, for employees too: the asset importer's own assignee
 * resolution already pulls every Employee row for its ambiguous-name check).
 * An organisation's headcount and department count are both small relative
 * to the asset fleet, so there is no analogue of the tag/serial scoping that
 * matters at thousands of rows.
 */
export async function resolveEmployeeRefs(): Promise<EmployeeRefs> {
  const [departments, employees] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({
      select: { id: true, employeeNo: true, employment: true },
      orderBy: { employeeNo: "asc" },
    }),
  ]);
  return buildEmployeeRefs(departments, employees);
}
