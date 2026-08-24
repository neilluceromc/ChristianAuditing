import type { AssetStatus, EmploymentStatus } from "@prisma/client";
import { ASSET_STATUSES } from "./inventory-list";
import type { BlockCause, BlockedRow, ImportOption } from "./import-vocabulary";

/**
 * Sheet header label → canonical field key. Extra sheet columns are ignored.
 *
 * `assignee` and `employeeNo` are two SEPARATE columns (NI-1, round 2): the
 * asset EXPORT (`ASSET_EXPORT_COLUMNS` in `export-columns.ts`) writes the
 * assignee as two columns, "Assigned to" (name) and "Employee no"
 * (employeeNo), and row rule 8 makes employee number authoritative over name
 * at the CELL level already — this makes that true at the COLUMN level too.
 * Before this split, "employee no" was only an alias on the SAME field as
 * "assigned to", so on our own export "Assigned to" was consumed first and
 * "Employee no" fell out unconsumed — meaning an ambiguous name on our own
 * export could never be disambiguated by the employee-no column sitting
 * right next to it, the one thing `ambiguous-assignee`'s own explain tells
 * the operator to add or fill in. Splitting them means both are read, and
 * rule 8 prefers `employeeNo` when its cell is non-blank.
 */
export const ASSET_IMPORT_HEADERS = [
  { key: "tag", labels: ["tag", "asset tag"], required: true, title: "Tag" },
  { key: "model", labels: ["model"], required: true, title: "Model" },
  { key: "serial", labels: ["serial", "serial no", "serial number"], required: false, title: "Serial" },
  { key: "category", labels: ["category"], required: true, title: "Category" },
  { key: "type", labels: ["type", "asset type"], required: false, title: "Type" },
  { key: "status", labels: ["status"], required: false, title: "Status" },
  { key: "assignee", labels: ["assigned to", "assignee", "holder"], required: false, title: "Assigned to" },
  { key: "employeeNo", labels: ["employee no", "employee number", "emp no"], required: false, title: "Employee no" },
  { key: "purchasedAt", labels: ["purchased", "purchased at", "purchase date"], required: false, title: "Purchased" },
  { key: "cost", labels: ["cost", "price"], required: false, title: "Cost" },
  { key: "warrantyUntil", labels: ["warranty until", "warranty"], required: false, title: "Warranty until" },
  { key: "vendor", labels: ["vendor", "supplier"], required: false, title: "Vendor" },
  { key: "notes", labels: ["notes", "note"], required: false, title: "Notes" },
] as const;

export type AssetField = (typeof ASSET_IMPORT_HEADERS)[number]["key"];

/**
 * The shape `ASSET_IMPORT_HEADERS` and `EMPLOYEE_IMPORT_HEADERS`
 * (`import-employees.ts`) both already had, made explicit (Task 12) so
 * `matchHeaders` below can be generic over either instead of the employee
 * importer hand-rolling a second header-matching loop — the exact class of
 * twin this phase keeps finding and removing (`text()`/`cellText`, two tag
 * rules, two `toDay`s, a retyped `IMPORT_OPTIONS`).
 */
export interface HeaderSpec<F extends string> {
  key: F;
  labels: readonly string[];
  required: boolean;
  title: string;
}

export interface HeaderMatch<F extends string = AssetField> {
  map: Map<F, number>;
  /**
   * `title`s of required headers with no column — reported all at once. When
   * a header accepts more than one spelling (round 2 Minor: "Asset tag" for
   * Tag), the accepted spellings are named alongside the title — a refusal
   * naming only "Tag" is TRUE but unhelpful if the operator doesn't know
   * "Asset tag" would also have matched.
   */
  missing: string[];
  unknown: string[];
}

/**
 * Exported (Task 11 round two, V-7) so a column split done outside this
 * module — `import-columns.ts`'s known-vs-unknown wording — can match a
 * header the exact same way `matchHeaders` itself does, rather than hand-
 * rolling a second, looser comparison that a differently-cased re-saved
 * sheet could slip past.
 */
export function normalizeHeader(cell: unknown): string {
  return String(cell ?? "").trim().toLowerCase();
}

function missingColumnLabel<F extends string>(spec: HeaderSpec<F>): string {
  return spec.labels.length > 1 ? `${spec.title} (accepted headers: ${spec.labels.join(", ")})` : spec.title;
}

/**
 * Generic over the header spec array (Task 12, E-9): every existing call
 * site passes no second argument and gets `ASSET_IMPORT_HEADERS` exactly as
 * before (the default), so this is a behaviour-preserving widening, not a
 * rewrite. `import-employees.ts` calls this with `EMPLOYEE_IMPORT_HEADERS`
 * instead of hand-rolling a second copy of the same consume-as-you-match
 * loop — the employee sheet has no email column and a different required
 * set, but the MATCHING algorithm (case/space-insensitive, first-match-wins,
 * each sheet column consumed at most once) is identical.
 */
export function matchHeaders<F extends string = AssetField>(
  header: unknown[],
  headers?: readonly HeaderSpec<F>[],
): HeaderMatch<F> {
  // A default VALUE (`headers: ... = ASSET_IMPORT_HEADERS`) is checked
  // against the generic `HeaderSpec<F>[]` at the declaration site, where `F`
  // is unresolved — that fails to typecheck even though every call site
  // resolves `F` concretely. An optional parameter defaulted inside the body
  // (with an explicit assertion, since TS cannot otherwise know
  // `ASSET_IMPORT_HEADERS`'s literal-keyed shape matches whatever `F` a
  // caller infers when it omits this argument entirely — which only ever
  // happens when `F` is `AssetField`, its own declared default) keeps every
  // existing single-argument call site byte-identical.
  const specs = headers ?? (ASSET_IMPORT_HEADERS as unknown as readonly HeaderSpec<F>[]);
  const map = new Map<F, number>();
  const consumed = new Set<number>();
  for (const spec of specs) {
    const labels: readonly string[] = spec.labels;
    const index = header.findIndex((cell, i) => !consumed.has(i) && labels.includes(normalizeHeader(cell)));
    if (index !== -1) {
      map.set(spec.key, index);
      consumed.add(index);
    }
  }
  const missing = specs.filter((spec) => spec.required && !map.has(spec.key)).map(missingColumnLabel);
  const unknown = header
    .map((cell, i) => ({ cell, i }))
    .filter(({ i }) => !consumed.has(i))
    .map(({ cell }) => String(cell ?? "").trim())
    .filter((label) => label.length > 0);
  return { map, missing, unknown };
}

/** A resolved employee: `ambiguous` when the KEY (a name) matches more than one record. */
export interface EmployeeRef {
  id: string;
  employment: EmploymentStatus;
  ambiguous: boolean;
}

/**
 * An existing asset's current record, as far as the import rules need it.
 * Unified shape (round 2, the fix the three Criticals converge on): `byTag`
 * and `bySerial` used to carry two near-identical but distinct shapes whose
 * only difference was a field nothing read (`byTag`'s `serial`, dead since
 * `8c4e8c0`). One exported type now backs both maps, and T9 can name it in a
 * helper signature instead of re-deriving it from a map's value type.
 *
 * - `tag`: the record's OWN tag — NOT the sheet row's. This is what lets a
 *   serial-rescued update (rule 5) say WHICH asset it will edit in the
 *   verdict (`RowVerdict`'s `assetTag`) even when the sheet row is tagged
 *   something else entirely; naming it only by a cuid tells the operator
 *   nothing they can check against the file.
 * - `categoryId` / `typeId`: the record's OWN, currently-stored values —
 *   needed so rule 7 can tell whether a category change with no Type column
 *   would strand the stored type outside the newly-written category (NC-3).
 */
export interface AssetRecordRef {
  id: string;
  tag: string;
  status: AssetStatus;
  assigneeId: string | null;
  categoryId: string;
  typeId: string | null;
}

/**
 * Reference data, pre-resolved by the server. Name keys are `refKey()`'d
 * (trimmed, lower-cased, internal whitespace runs collapsed — see `refKey`
 * below). A map value of `null` (categories/types/vendors) means the key
 * matched MORE THAN ONE row — R-1, round 2: `AssetCategory.name` and
 * `Vendor.name` are `@unique`, and `AssetType` is `@@unique([categoryId,
 * name])`, but Postgres unique is CASE-SENSITIVE and nothing else in this
 * app checks case-insensitively, so the admin UI happily accepts "Laptop"
 * and "laptop" as two distinct rows. Without this, every sheet row naming
 * either resolved to whichever the unordered query returned last — no
 * block, no error, no signal, just silently filed under the wrong id. `null`
 * makes that undecidable state block instead of guessing.
 */
export interface AssetRefs {
  categories: Map<string, string | null>;
  /**
   * Keyed `${categoryId}:${refKey(type name)}` — composite, not a flat name
   * key. `AssetType` is `@@unique([categoryId, name])`, NOT globally unique,
   * so two categories can each have their own "Standard" type; a flat
   * name→id map can hold only one of them and silently resolves to whichever
   * happened to be inserted last. The composite key is what makes "resolve
   * the type within the row's own category" (rule 7) actually correct rather
   * than lossy by construction. The value carries only the id (round 2
   * Minor: it used to also carry `categoryId`, which nothing read — the
   * composite key already embeds it) or `null` for a same-category
   * case-collision (R-1).
   */
  types: Map<string, string | null>;
  /**
   * employeeNo AND name, both `refKey()`'d, both → an employee ref.
   * `Employee.name` is NOT unique (only `employeeNo` is), so a name that
   * matches more than one employee is `ambiguous: true` and blocks rather
   * than silently resolving to whichever the map happened to keep; an
   * employeeNo key is never ambiguous. Ambiguity is counted across ALL
   * employees regardless of `employment` — deliberately (see
   * `buildAssetRefs` in `resolve.ts`, where this is computed, for why).
   */
  employees: Map<string, EmployeeRef>;
  vendors: Map<string, string | null>;
  /** existing assets by EXACT tag — the update path. */
  byTag: Map<string, AssetRecordRef>;
  /**
   * existing assets by EXACT serial — the duplicate/rescue path.
   * `treatDuplicateSerialAsUpdate` can resolve a row to THIS record instead of
   * `byTag`'s (rule 5), and rule 11's lifecycle-move check (D-A) needs a
   * current status/assigneeId to compare against no matter which map found
   * the asset — so this carries the same shape as `byTag`, not a bare id.
   */
  bySerial: Map<string, AssetRecordRef>;
}

/**
 * D-A (2026-08-22): import may set status/assignee on CREATE — an import's
 * job is entering a fleet that is already deployed, and all eight statuses
 * are legitimate there. `CREATABLE_STATUSES` (`asset-rules.ts`) is an
 * affordance of the New Asset form, not a database invariant, so it does not
 * constrain this type.
 */
export interface AssetCreateData {
  tag: string;
  model: string;
  serial: string | null;
  categoryId: string;
  typeId: string | null;
  status: AssetStatus;
  assigneeId: string | null;
  purchasedAt: Date | null;
  /** a decimal STRING — Prisma builds the Decimal, no float touches money */
  cost: string | null;
  warrantyUntil: Date | null;
  vendorId: string | null;
  notes: string | null;
}

/**
 * The update-branch contract (C-7, 2026-08-22). A single flat shape shared by
 * create and update was the defect: a row that only fills Tag/Model/Category
 * (the only required columns) would otherwise emit `null` for every OTHER
 * column, and an update writes exactly what it's given — so a partial
 * re-upload of a trimmed-down export would silently wipe cost, dates, vendor
 * and notes on every matched asset. That is why every optional field here is
 * `?:`, and why the distinction is load-bearing rather than decorative:
 *
 * - key ABSENT (`undefined`, i.e. not set on the object at all) — the sheet
 *   has no column for this field. Leave the existing value alone.
 * - key present with `null` — the column exists and this row's cell was
 *   empty. An intentional clear.
 * - key present with a value — write it.
 *
 * This is deliberately exactly Prisma's own update semantics (`undefined` in
 * a `data` object is "don't touch", `null` is "set to null"), so T10's write
 * is `prisma.asset.update({ where: { id }, data: patch })` with no
 * translation layer in between — do not "simplify" this back into one shape
 * that always carries every key, or the destructive-write bug comes back.
 *
 * No `tag` — `updateAsset` treats tag as immutable, and the update-by-serial
 * rescue path (rule 5) must not rename the matched asset to this row's tag.
 * No `status` / `assigneeId` — D-A: those move only through the approval
 * queue everywhere else in this app; update never carries them, not even
 * when the sheet's value already agrees with the record (there is nothing to
 * write in that case, so there is no reason to open the door).
 *
 * `vendorId` carries one more distinction than the "absent / null / value"
 * rule above states in general (NC-1, round 2): the column can be PRESENT
 * with the row's vendor cell UNRESOLVED, and the operator ticked
 * `dropUnknownVendor` to import anyway. That case must ALSO come out as key
 * ABSENT, not `null` — a dropped vendor is not an empty cell, it is a name
 * this run could not resolve, and writing `null` for it would erase whatever
 * vendor the record already had on file. Only a genuinely blank Vendor cell
 * writes `null`.
 */
export interface AssetUpdatePatch {
  model: string;
  categoryId: string;
  typeId?: string | null;
  serial?: string | null;
  purchasedAt?: Date | null;
  cost?: string | null;
  warrantyUntil?: Date | null;
  vendorId?: string | null;
  notes?: string | null;
}

export type RowVerdict =
  | { kind: "create"; row: number; data: AssetCreateData }
  /**
   * `assetTag` (round 2, `AssetRecordRef.tag`) is the MATCHED asset's own
   * tag, not the sheet row's — the two differ on a serial-rescued row, where
   * the sheet's tag didn't match anything and only the serial did. Without
   * it a rescued update named its target only by a cuid the operator has
   * never seen anywhere in this app.
   */
  | { kind: "update"; row: number; assetId: string; assetTag: string; data: AssetUpdatePatch }
  | ({ kind: "blocked" } & BlockedRow);

export interface AssetPlan {
  rows: RowVerdict[];
  counts: { create: number; update: number; blocked: number };
}

export type ImportOptions = Record<ImportOption, boolean>;

/**
 * Shared identity for every NAME-keyed lookup (category, type, vendor,
 * employee) — trims, lower-cases, AND collapses internal whitespace runs to
 * one space (R-4, round 2). `trim()` alone strips a SURROUNDING U+00A0 (it's
 * in the spec's WhiteSpace production, so padding was never the problem);
 * an INTERNAL non-breaking space is not touched by `trim()` or
 * `toLowerCase()` — and "Ramon Cruz" pasted from Outlook or a web page into
 * Excel, carrying one, is a routine artefact, not an edge case. Left
 * un-collapsed, that cell blocked as `unknown-assignee` naming a value that
 * was letter-for-letter an employee already in the system, with no visible
 * difference — the worst kind of silent failure, because the offered fix
 * ("Leave as spare") reads as the natural response to a genuinely unknown
 * name. `\s` in a JS RegExp matches U+00A0 (and the rest of Unicode's space
 * separators), so collapsing on that class handles it with no NBSP-specific
 * case. Used on BOTH sides of every lookup this module makes — the map
 * BUILT from the database (`buildAssetRefs`, `resolve.ts`) and the sheet
 * value that CONSULTS it (`planAssetRows` below); doing it on only one side
 * would just trade the old key-shape mismatch for a new one.
 */
export function refKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * A raw cell → trimmed text, blank/null/undefined all reading as "".
 * Exported so a caller outside this module's row loop — the dry-run action
 * building its tag/serial lookup arrays BEFORE headers are field-mapped —
 * shares this exact rule instead of hand-rolling a twin (round 2: found
 * drifting from this one in argument order, not behaviour, which is exactly
 * how two copies of one rule quietly stop agreeing).
 */
export function cellText(raw: unknown): string {
  return isBlank(raw) ? "" : String(raw).trim();
}

/**
 * The tag lookup key, shared the same way and for the same reason. A tag is
 * trimmed and UPPER-CASED because `createSchema` stores it that way
 * (`actions.ts:147`, `.trim().toUpperCase()`) and every tag in the database
 * is upper-case — while Postgres's unique index is case-sensitive, so a
 * lower-cased sheet tag that misses the map does not error, it plans a CREATE
 * and produces a SECOND record for one physical machine.
 *
 * This existed as two hand-written copies — one keying the `IN` query in
 * `resolve.ts`, one keying the lookup in `planAssetRows` — which is the exact
 * hazard `refKey` and `cellText` were extracted to remove, one level down.
 * Two copies of a key rule agree until the day they don't, and the failure is
 * silent on both sides.
 */
export function tagKey(raw: unknown): string {
  return cellText(raw).toUpperCase();
}

function cellAt(headers: HeaderMatch, cells: unknown[], field: AssetField): unknown {
  const index = headers.map.get(field);
  return index === undefined ? undefined : cells[index];
}

function textAt(headers: HeaderMatch, cells: unknown[], field: AssetField): string {
  return cellText(cellAt(headers, cells, field));
}

const TAG_SHAPE = /^BR-[A-Z]{2}-\d{4}$/;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type DateResult = { ok: true; value: Date | null } | { ok: false; raw: string };

/**
 * A real Date cell, or YYYY-MM-DD text that ROUND-TRIPS. The shape regex
 * alone let "2026-13-45" through as an Invalid Date (caught below by the NaN
 * check) — but, more dangerously, let "2026-02-30" through as a perfectly
 * valid Date, because `new Date(...)` normalises an out-of-range day into the
 * next month (March 2). Nothing downstream would ever flag that a row asked
 * for the 30th of February and silently got the 2nd of March instead, so the
 * fix is to require the text to describe the SAME calendar day it produces.
 * UTC midnight is correct and matches `toDate()` (`actions.ts:172`) — a
 * UTC-midnight instant renders as the same day at UTC+8 (Manila), so this is
 * safe by arithmetic (UTC+8 never crosses back a full day), not by luck.
 *
 * THE DATE CELL CONVENTION, MEASURED AND PINNED AT TASK 8 — do not change
 * these getters to their local counterparts without re-running that probe.
 * `readSheet` (`src/server/import/read-sheet.ts`, the only reader in the app)
 * hands back a real `Date` for a date-formatted cell, and the instant is
 * **UTC midnight**: a round trip through our own `ASSET_EXPORT_COLUMNS`
 * returns `2026-01-05T00:00:00.000Z` byte-identical under `Asia/Manila`,
 * `America/New_York` and `UTC`. Only the LOCAL calendar day read off that
 * instant moves with the offset — `getDate()` is 5 at UTC+8 and 4 at UTC-5.
 *
 * So this reads the cell's **UTC** year/month/day. For the conforming input
 * above that is a no-op, which is the point: the rule is now provably
 * independent of the process timezone rather than accidentally correct at
 * ours. It still does real work for a date cell carrying a time component,
 * which becomes UTC midnight of the same UTC day.
 *
 * Round 2 got this backwards, and the mistake is instructive: it reasoned
 * that "several xlsx readers hand back LOCAL midnight" and read local fields
 * accordingly — safe at Manila (UTC+8) by arithmetic, wrong at any negative
 * offset against the reader we actually have. A bare `Date` cannot say which
 * convention produced it, so the answer was never derivable here; it took
 * running the reader. **A local-midnight `Date` would now be read as the day
 * before at UTC+8 — that shape cannot reach this function through
 * `read-sheet.ts`, and if a second reader is ever added it must normalise to
 * this convention at the boundary rather than teaching this branch to guess.**
 *
 * Exported (Task 12, E-9): the employee importer's `joinedAt` is a date cell
 * read by the exact same `readSheet` this comment measured, so it needs the
 * exact same convention — a second, independently-reasoned `parseDateCell`
 * for `joinedAt` is precisely the class of twin (two `toDay`s, two tag rules)
 * this phase has spent three tasks removing, and a date rule that disagreed
 * with this one would be a bug report waiting to happen the day someone
 * compares an asset's `purchasedAt` against an employee's `joinedAt` in the
 * same spreadsheet round trip.
 */
export function parseDateCell(raw: unknown): DateResult {
  if (isBlank(raw)) return { ok: true, value: null };
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { ok: false, raw: String(raw) };
    const normalized = new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
    return { ok: true, value: normalized };
  }
  const text = String(raw).trim();
  if (!DATE_ONLY.test(text)) return { ok: false, raw: text };
  const value = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== text) {
    return { ok: false, raw: text };
  }
  return { ok: true, value };
}

const COST_SHAPE = /^\d+(\.\d{1,2})?$/;
const COST_MAX = 10_000_000;

type CostResult = { ok: true; value: string | null } | { ok: false; raw: string };

/**
 * Money stays a STRING all the way to Prisma, which builds the Decimal — no
 * float ever touches a peso amount. The NUMERIC branch used to just
 * stringify whatever it was handed, which is the path that actually matters:
 * Excel/xlsx hands back a JS `number` for every currency-formatted cell, so
 * that "rare" branch was the common one in practice, and it enforced NONE of
 * createSchema's constraints — a negative cost, a float artefact like
 * 0.1+0.2, a three-decimal amount silently rounded by `Decimal(12,2)`, or a
 * value big enough to be a Prisma parse error (1e21) all sailed through. Both
 * branches must now obey the identical contract: finite, >= 0, <= 10,000,000,
 * at most two decimal places — so the same value is never accepted as a
 * number and rejected as text, or vice versa.
 *
 * M4 (round 2): the TEXT branch's `Number(text)` also touches a float, which
 * this comment used to claim never happens. It is safe by arithmetic — an
 * amount at most 10,000,000.00 with 2dp is far inside 2^53 — and it usefully
 * NORMALISES a shape like "00051000.5" to "51000.50" via `.toFixed(2)`. So:
 * a float is used only to range-check and normalise, never to REPRESENT the
 * value that gets written — the string is what reaches Prisma either way.
 */
function parseCostCell(raw: unknown): CostResult {
  if (isBlank(raw)) return { ok: true, value: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > COST_MAX) return { ok: false, raw: String(raw) };
    if (Math.round(raw * 100) / 100 !== raw) return { ok: false, raw: String(raw) };
    return { ok: true, value: raw.toFixed(2) };
  }
  const text = String(raw).trim();
  if (!COST_SHAPE.test(text)) return { ok: false, raw: text };
  if (Number(text) > COST_MAX) return { ok: false, raw: text };
  return { ok: true, value: Number(text).toFixed(2) };
}

const LENGTH_LIMITS = { model: [2, 120], serial: [0, 120], notes: [0, 2000] } as const;

/**
 * The per-row rules, applied in this order (Task 7, amended 2026-08-22, and
 * round 2). First failing check wins: exactly one cause per row.
 */
export function planAssetRows(
  headers: HeaderMatch,
  cells: unknown[][],
  refs: AssetRefs,
  options: ImportOptions,
): AssetPlan {
  const rows: RowVerdict[] = [];
  const counts = { create: 0, update: 0, blocked: 0 };
  // C-2: earlier rows of THIS file, not just what the database already knows —
  // otherwise a copy-pasted duplicate inside one upload was structurally
  // invisible and both rows planned as separate creates.
  const seenTags = new Set<string>();
  const seenSerials = new Set<string>();

  cells.forEach((raw, i) => {
    const sheetRow = i + 2; // header is row 1

    // Rule 1: a wholly blank row is skipped entirely, not blocked.
    if (raw.every(isBlank)) return;

    const block = (cause: BlockCause, detail: string) => {
      rows.push({ kind: "blocked", row: sheetRow, cause, detail });
      counts.blocked += 1;
    };

    // Rule 2: trim AND upper-case before anything — createSchema does, and
    // every tag in the database is upper-case, so matching stayed
    // case-sensitive would let "br-lt-0148" plan as a second, duplicate
    // record for one physical machine (Postgres unique is case-sensitive
    // too, so it would not even error). Blank → missing-tag. Wrong shape
    // (not BR-XX-0000) → bad-tag.
    const tagRaw = cellAt(headers, raw, "tag");
    const tag = tagKey(tagRaw);
    if (tag === "") {
      block("missing-tag", "");
      return;
    }
    if (!TAG_SHAPE.test(tag)) {
      block("bad-tag", tag);
      return;
    }

    // Rule 3: a tag already claimed by an earlier row of this file.
    if (seenTags.has(tag)) {
      block("duplicate-in-file", tag);
      return;
    }
    seenTags.add(tag);

    // Rule 6 (resolved here so rule 5 can see it): a known tag is an update,
    // carrying the existing asset's current record.
    const existingByTag = refs.byTag.get(tag);
    let matched: AssetRecordRef | null = existingByTag ?? null;

    // Rule 5 (M3, round 2): serial is claimed at the SAME point as the tag —
    // right after the tag's own checks, before any later rule (model,
    // category, …) gets a chance to block the row for an unrelated reason.
    // Previously the tag was claimed here but the serial wasn't claimed
    // until after the model check, so a row with, say, a blank Model still
    // occupied its tag for the rest of the file but NOT its serial — whether
    // an identifier was "claimed" depended on which rule ended up blocking
    // the row. Now both are claimed together, so that is no longer a
    // question: every row that gets this far claims both, blocked or not.
    //
    // An earlier row of this file wins first (C-2); then, whether or not the
    // tag matched, a serial already belonging to a DIFFERENT asset blocks.
    // `treatDuplicateSerialAsUpdate` rescues only the no-tag-match case: when
    // tag→A and serial→B the two matches disagree about which asset the row
    // even is, and no option can resolve that (C-1).
    const serial = textAt(headers, raw, "serial") || null;
    if (serial) {
      if (seenSerials.has(serial)) {
        block("duplicate-in-file", serial);
        return;
      }
      seenSerials.add(serial);
      const existingBySerial = refs.bySerial.get(serial);
      if (existingBySerial && existingBySerial.id !== matched?.id) {
        if (!matched && options.treatDuplicateSerialAsUpdate) {
          matched = existingBySerial;
        } else {
          block("duplicate-serial", serial);
          return;
        }
      }
    }

    // Rule 4: `required: true` on a header spec governs the COLUMN, not the
    // cell — a blank Model cell must still block, or it plans as
    // `model: ""`, which createSchema's/updateSchema's `min(2)` forbids.
    const model = textAt(headers, raw, "model");
    if (model === "") {
      block("missing-model", "");
      return;
    }

    // Rule 7: category, type and vendor must resolve to reference data —
    // never created as a side effect of an upload (scope decision 12).
    // NI-5 (round 2): `required: true` on Category, same as Tag and Model,
    // governs the COLUMN, not the cell — a blank cell is `missing-category`,
    // not `unknown-category` with an empty (and thus example-less) detail.
    const categoryRaw = textAt(headers, raw, "category");
    if (categoryRaw === "") {
      block("missing-category", "");
      return;
    }
    const categoryId = refs.categories.get(refKey(categoryRaw));
    if (categoryId === undefined) {
      block("unknown-category", categoryRaw);
      return;
    }
    // R-1: two categories sharing this name case-insensitively — the id is
    // genuinely undecidable (see AssetRefs's own comment), so this blocks
    // rather than picking one.
    if (categoryId === null) {
      block("duplicate-category-name", categoryRaw);
      return;
    }

    // Type resolves WITHIN the row's own category, because AssetType is only
    // unique per category — pairing e.g. "Laptops" with a "Furniture" type
    // would otherwise produce an asset its own edit form can't save
    // (actions.ts:189 and :296 both check `type.categoryId !== d.categoryId`).
    // The composite map key already embeds `categoryId`, so a hit can never
    // carry a mismatched one back out — no separate check needed for that.
    const typeRaw = textAt(headers, raw, "type");
    let typeId: string | null = null;
    if (typeRaw) {
      const resolvedType = refs.types.get(`${categoryId}:${refKey(typeRaw)}`);
      if (resolvedType === undefined) {
        block("unknown-type", typeRaw);
        return;
      }
      // R-1: two types under THIS category sharing the name case-insensitively.
      if (resolvedType === null) {
        block("duplicate-type-name", typeRaw);
        return;
      }
      typeId = resolvedType;
    } else if (matched && matched.typeId && matched.categoryId !== categoryId && !headers.map.has("type")) {
      // NC-3 (round 2): this row moves an EXISTING asset to a new category
      // with no Type column in the sheet at all. Without this check, the
      // update patch would carry no `typeId` key, Prisma would leave the
      // record's STORED type untouched, and that stored type belongs to the
      // OLD category — stranding a type outside its category, exactly the
      // state `updateAsset` (actions.ts:294) itself refuses to save. This
      // fires only when the Type column is wholly ABSENT: a present-but-blank
      // Type cell already clears `typeId` in the patch below, which is safe.
      //
      // This test is CONSERVATIVE, not exact, and the difference matters to
      // whoever reads it next. It infers "the stored type cannot belong to
      // the new category" from the record's own `(categoryId, typeId)` pair
      // having been consistent to begin with — and NOTHING IN THE DATABASE
      // ENFORCES THAT. There is no FK or CHECK tying `Asset.categoryId` to
      // its type's category; only `createAsset` and `updateAsset` maintain
      // it, in application code. So an asset already stored inconsistently
      // (by seed, by raw SQL, by some future write path) is blocked even by
      // the row that would REPAIR it, and is left alone by a row that keeps
      // it broken. Both directions are safe — this module never writes an
      // inconsistency, and the explain's advice (add a Type column naming a
      // type of the new category) does resolve the false positive. Catching
      // it exactly would need the stored type's own categoryId in
      // `AssetRecordRef`: a T9 contract addition to detect a state this
      // application cannot currently produce. Declined deliberately.
      block("type-outside-category", categoryRaw);
      return;
    }

    const vendorRaw = textAt(headers, raw, "vendor");
    let vendorId: string | null = null;
    // NC-1 (round 2): tracked separately from `vendorId` itself, because a
    // DROPPED vendor and a genuinely BLANK cell both leave `vendorId: null`
    // here, but they must not both write `null` to the update patch below —
    // see AssetUpdatePatch's own comment on `vendorId` for why.
    let vendorDropped = false;
    if (vendorRaw) {
      const resolvedVendor = refs.vendors.get(refKey(vendorRaw));
      // R-1: two vendors sharing this name case-insensitively. Vendor is
      // nullable and decorative (D-B), and `/admin/vendors` does not exist
      // and nothing in this app can create or rename a Vendor — so, unlike
      // the category/type collisions, there is no page to send the operator
      // to. The rescue this cause needs already exists: the same drop that
      // rescues an unresolved vendor name.
      if (resolvedVendor === null) {
        if (options.dropUnknownVendor) {
          vendorDropped = true;
        } else {
          block("duplicate-vendor-name", vendorRaw);
          return;
        }
      } else if (resolvedVendor === undefined) {
        if (options.dropUnknownVendor) {
          vendorDropped = true;
        } else {
          block("unknown-vendor", vendorRaw);
          return;
        }
      } else {
        vendorId = resolvedVendor;
      }
    }

    // Rule 8: an assignee must resolve, unambiguously, to an ACTIVE employee
    // — by employee number (always authoritative) or by name (ambiguous when
    // it matches more than one employee, since Employee.name isn't unique).
    // NI-1 (round 2): "Employee no" is now its own column (see
    // `ASSET_IMPORT_HEADERS`'s comment), and a non-blank cell there wins over
    // "Assigned to" — making that authority true at the column level, not
    // just when both happen to name the same person. This is exactly what
    // lets a re-upload of this app's OWN export disambiguate a name that
    // matches more than one employee.
    // `dropUnknownAssignee` rescues an unresolved or inactive match to
    // unassigned; it does NOT rescue ambiguous — dropping loses which of
    // several employees was meant, which is a different problem than "not
    // found". `createAsset` itself refuses a non-ACTIVE assignee ("assignments
    // are frozen", actions.ts:196); this mirrors that rule at import time —
    // EXCEPT on an update whose sheet holder already IS the record's own
    // holder (NC-2): that row moves nothing, so there is nothing to freeze.
    const assigneeNoRaw = textAt(headers, raw, "employeeNo");
    const assigneeNameRaw = textAt(headers, raw, "assignee");
    const assigneeRaw = assigneeNoRaw || assigneeNameRaw;
    let assigneeId: string | null = null;
    let assigneeDropped = false;
    if (assigneeRaw) {
      const resolved = refs.employees.get(refKey(assigneeRaw));
      if (!resolved) {
        if (options.dropUnknownAssignee) {
          assigneeDropped = true;
        } else {
          block("unknown-assignee", assigneeRaw);
          return;
        }
      } else if (resolved.ambiguous) {
        block("ambiguous-assignee", assigneeRaw);
        return;
      } else if (resolved.employment !== "ACTIVE") {
        if (matched && resolved.id === matched.assigneeId) {
          // NC-2: the sheet's holder already IS the record's holder — this
          // update makes no assignment, so the ACTIVE freeze (which guards
          // MAKING one) does not apply. Any OTHER holder still blocks below.
          assigneeId = resolved.id;
        } else if (options.dropUnknownAssignee) {
          assigneeDropped = true;
        } else {
          block("inactive-assignee", assigneeRaw);
          return;
        }
      } else {
        assigneeId = resolved.id;
      }
    }

    // Rule 9: status format — blank reads as "no opinion" here; what that
    // means is branch-specific (rules 10/11 below). Non-blank must be one of
    // the eight, upper-cased.
    const statusRaw = textAt(headers, raw, "status");
    let parsedStatus: AssetStatus | null = null;
    if (statusRaw !== "") {
      const upper = statusRaw.toUpperCase();
      const match = (ASSET_STATUSES as readonly string[]).find((s) => s === upper);
      if (!match) {
        block("bad-status", statusRaw);
        return;
      }
      parsedStatus = match as AssetStatus;
    }

    let finalStatus: AssetStatus = "SPARE";

    if (matched) {
      // Rule 11 (update only, D-A): status/assignee never move via import. A
      // PRESENT (non-blank) Status or Assigned-to cell that disagrees with
      // the record's current value blocks, unless the operator explicitly
      // chose to keep the current lifecycle and apply just the rest of the row.
      const record = matched;
      const statusConflict = parsedStatus !== null && parsedStatus !== record.status;
      const assigneeConflict = assigneeRaw !== "" && assigneeId !== record.assigneeId;
      if (statusConflict || assigneeConflict) {
        if (!options.keepCurrentLifecycle) {
          const fields = [statusConflict && "Status", assigneeConflict && "Assigned to"]
            .filter((v): v is string => Boolean(v))
            .join(", ");
          block("lifecycle-via-import", fields);
          return;
        }
      }
    } else {
      // Rule 9 cont'd (create only): blank → SPARE.
      finalStatus = parsedStatus ?? "SPARE";
      // Rule 10 (create only, D-A): Deployed/Temporary needs a holder. If the
      // only reason there isn't one is that `dropUnknownAssignee` just
      // dropped it, OR the operator ticked `importUnheldAsSpare` (the fifth
      // option, round 2 — the identical end state, DEPLOYED requested with
      // no holder available, should not be auto-resolved on one path and
      // hard-blocked on the other, differing only in WHY there is no
      // holder), downgrade to SPARE instead of blocking — producing DEPLOYED
      // with no assignee from a button labelled "leave as spare" would be
      // exactly backwards.
      if (finalStatus === "DEPLOYED" || finalStatus === "TEMPORARY") {
        if (assigneeId === null) {
          if (assigneeDropped || options.importUnheldAsSpare) {
            finalStatus = "SPARE";
          } else {
            block("deployed-without-holder", finalStatus);
            return;
          }
        }
      }
    }

    // Rule 12: dates.
    const purchasedAtResult = parseDateCell(cellAt(headers, raw, "purchasedAt"));
    if (!purchasedAtResult.ok) {
      block("bad-date", purchasedAtResult.raw);
      return;
    }
    const warrantyUntilResult = parseDateCell(cellAt(headers, raw, "warrantyUntil"));
    if (!warrantyUntilResult.ok) {
      block("bad-date", warrantyUntilResult.raw);
      return;
    }

    // Rule 13: cost.
    const costResult = parseCostCell(cellAt(headers, raw, "cost"));
    if (!costResult.ok) {
      block("bad-number", costResult.raw);
      return;
    }

    // Rule 14: ceilings the app already enforces and this module didn't.
    // NI-6 (round 2): this cause used to be named `value-too-long`, but it
    // also fires on a Model that is too SHORT — a label stating the opposite
    // of the actual problem. Renamed to `value-out-of-range`.
    //
    // Task 11 round two minor: `detail` is collected into `CauseGroup.examples`
    // and rendered as "e.g. <value>" — every OTHER `block()` call in this
    // function passes the offending cell's own value (the bad tag, the
    // unreadable date, the raw cost text). This one used to pass the COLUMN
    // NAME ("Model", "Serial", "Notes") instead, so the page read "e.g.
    // Model, Notes" — field names presented as example values. Passing the
    // actual value matches every sibling cause and the row numbers still let
    // the operator find it in the file.
    const notesRaw = textAt(headers, raw, "notes");
    if (model.length < LENGTH_LIMITS.model[0] || model.length > LENGTH_LIMITS.model[1]) {
      block("value-out-of-range", model);
      return;
    }
    if (serial && serial.length > LENGTH_LIMITS.serial[1]) {
      block("value-out-of-range", serial);
      return;
    }
    if (notesRaw.length > LENGTH_LIMITS.notes[1]) {
      block("value-out-of-range", notesRaw);
      return;
    }

    if (matched) {
      // C-7: only include a key when the SHEET has that column at all —
      // absent (no such header) leaves the field untouched; present with a
      // blank cell clears it. tag/status/assigneeId are never in the patch
      // (see AssetUpdatePatch's own comment for why).
      const patch: AssetUpdatePatch = { model, categoryId };
      if (headers.map.has("type")) patch.typeId = typeId;
      if (headers.map.has("serial")) patch.serial = serial;
      if (headers.map.has("purchasedAt")) patch.purchasedAt = purchasedAtResult.value;
      if (headers.map.has("cost")) patch.cost = costResult.value;
      if (headers.map.has("warrantyUntil")) patch.warrantyUntil = warrantyUntilResult.value;
      // NC-1: a DROPPED vendor omits the key entirely (leave the record's
      // stored vendor alone) — only a genuinely blank cell clears it to null.
      if (headers.map.has("vendor") && !vendorDropped) patch.vendorId = vendorId;
      if (headers.map.has("notes")) patch.notes = notesRaw || null;

      rows.push({ kind: "update", row: sheetRow, assetId: matched.id, assetTag: matched.tag, data: patch });
      counts.update += 1;
    } else {
      const data: AssetCreateData = {
        tag,
        model,
        serial,
        categoryId,
        typeId,
        status: finalStatus,
        assigneeId,
        purchasedAt: purchasedAtResult.value,
        cost: costResult.value,
        warrantyUntil: warrantyUntilResult.value,
        vendorId,
        notes: notesRaw || null,
      };
      rows.push({ kind: "create", row: sheetRow, data });
      counts.create += 1;
    }
  });

  return { rows, counts };
}
