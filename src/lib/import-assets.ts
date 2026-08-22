import type { AssetStatus, EmploymentStatus } from "@prisma/client";
import { ASSET_STATUSES } from "./inventory-list";
import type { BlockCause, BlockedRow, ImportOption } from "./import-vocabulary";

/**
 * Sheet header label → canonical field key. Extra sheet columns are ignored.
 *
 * `assignee` also accepts "employee no": the asset EXPORT (`ASSET_EXPORT_COLUMNS`
 * in `export-columns.ts`) writes the assignee as two columns, "Assigned to"
 * (name) and "Employee no" (employeeNo), so an edited export re-uploaded here
 * must still resolve — row rule 8 already looks an assignee value up by
 * employee number OR by name, so this is a header alias, not a new field.
 * "Assigned to" is tried first in `ASSET_IMPORT_HEADERS` order, so on our own
 * export "Employee no" is never consumed by this alias — it simply falls out
 * as an ignored, unknown column. That is expected, not a defect: T11 should
 * not warn about an unrecognised column this app itself wrote.
 */
export const ASSET_IMPORT_HEADERS = [
  { key: "tag", labels: ["tag", "asset tag"], required: true, title: "Tag" },
  { key: "model", labels: ["model"], required: true, title: "Model" },
  { key: "serial", labels: ["serial", "serial no", "serial number"], required: false, title: "Serial" },
  { key: "category", labels: ["category"], required: true, title: "Category" },
  { key: "type", labels: ["type", "asset type"], required: false, title: "Type" },
  { key: "status", labels: ["status"], required: false, title: "Status" },
  { key: "assignee", labels: ["assigned to", "assignee", "holder", "employee no"], required: false, title: "Assigned to" },
  { key: "purchasedAt", labels: ["purchased", "purchased at", "purchase date"], required: false, title: "Purchased" },
  { key: "cost", labels: ["cost", "price"], required: false, title: "Cost" },
  { key: "warrantyUntil", labels: ["warranty until", "warranty"], required: false, title: "Warranty until" },
  { key: "vendor", labels: ["vendor", "supplier"], required: false, title: "Vendor" },
  { key: "notes", labels: ["notes", "note"], required: false, title: "Notes" },
] as const;

export type AssetField = (typeof ASSET_IMPORT_HEADERS)[number]["key"];

export interface HeaderMatch {
  map: Map<AssetField, number>;
  /** `title`s of required headers with no column — reported all at once */
  missing: string[];
  unknown: string[];
}

function normalizeHeader(cell: unknown): string {
  return String(cell ?? "").trim().toLowerCase();
}

export function matchHeaders(header: unknown[]): HeaderMatch {
  const map = new Map<AssetField, number>();
  const consumed = new Set<number>();
  for (const spec of ASSET_IMPORT_HEADERS) {
    const labels: readonly string[] = spec.labels;
    const index = header.findIndex((cell, i) => !consumed.has(i) && labels.includes(normalizeHeader(cell)));
    if (index !== -1) {
      map.set(spec.key, index);
      consumed.add(index);
    }
  }
  const missing = ASSET_IMPORT_HEADERS.filter((spec) => spec.required && !map.has(spec.key)).map(
    (spec) => spec.title,
  );
  const unknown = header
    .map((cell, i) => ({ cell, i }))
    .filter(({ i }) => !consumed.has(i))
    .map(({ cell }) => String(cell ?? "").trim())
    .filter((label) => label.length > 0);
  return { map, missing, unknown };
}

/** A resolved employee: `ambiguous` when the KEY (a name) matches more than one record. */
interface EmployeeRef {
  id: string;
  employment: EmploymentStatus;
  ambiguous: boolean;
}

/** An existing asset's current record, as far as the import rules need it. */
interface AssetRecordRef {
  id: string;
  status: AssetStatus;
  assigneeId: string | null;
}

/** Reference data, pre-resolved by the server. Name keys are lower-cased. */
export interface AssetRefs {
  categories: Map<string, string>;
  /**
   * Keyed `${categoryId}:${lowercased type name}` — composite, not a flat
   * name key. `AssetType` is `@@unique([categoryId, name])`, NOT globally
   * unique, so two categories can each have their own "Standard" type; a flat
   * name→id map can hold only one of them and silently resolves to whichever
   * happened to be inserted last. The composite key is what makes "resolve
   * the type within the row's own category" (rule 7) actually correct rather
   * than lossy by construction.
   */
  types: Map<string, { id: string; categoryId: string }>;
  /**
   * employeeNo AND name, both lower-cased, both → an employee ref.
   * `Employee.name` is NOT unique (only `employeeNo` is), so a name that
   * matches more than one employee is `ambiguous: true` and blocks rather
   * than silently resolving to whichever the map happened to keep; an
   * employeeNo key is never ambiguous.
   */
  employees: Map<string, EmployeeRef>;
  vendors: Map<string, string>;
  /** existing assets by EXACT tag — the update path. */
  byTag: Map<string, { id: string; serial: string | null; status: AssetStatus; assigneeId: string | null }>;
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
  | { kind: "update"; row: number; assetId: string; data: AssetUpdatePatch }
  | ({ kind: "blocked" } & BlockedRow);

export interface AssetPlan {
  rows: RowVerdict[];
  counts: { create: number; update: number; blocked: number };
}

export type ImportOptions = Record<ImportOption, boolean>;

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function cellAt(headers: HeaderMatch, cells: unknown[], field: AssetField): unknown {
  const index = headers.map.get(field);
  return index === undefined ? undefined : cells[index];
}

function textAt(headers: HeaderMatch, cells: unknown[], field: AssetField): string {
  const raw = cellAt(headers, cells, field);
  return isBlank(raw) ? "" : String(raw).trim();
}

const TAG_SHAPE = /^BR-[A-Z]{2}-\d{4}$/;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type DateResult = { ok: true; value: Date | null } | { ok: false; raw: string };

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
 */
function parseDateCell(raw: unknown): DateResult {
  if (isBlank(raw)) return { ok: true, value: null };
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? { ok: false, raw: String(raw) } : { ok: true, value: raw };
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
 * The per-row rules, applied in this order (Task 7, amended 2026-08-22).
 * First failing check wins: exactly one cause per row.
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
    const tag = isBlank(tagRaw) ? "" : String(tagRaw).trim().toUpperCase();
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
    // carrying the existing asset's id and current values.
    const existingByTag = refs.byTag.get(tag);
    let updateAssetId: string | null = existingByTag ? existingByTag.id : null;
    let matchedRecord: AssetRecordRef | null = existingByTag ?? null;

    // Rule 4: `required: true` on a header spec governs the COLUMN, not the
    // cell — a blank Model cell must still block, or it plans as
    // `model: ""`, which createSchema's/updateSchema's `min(2)` forbids.
    const model = textAt(headers, raw, "model");
    if (model === "") {
      block("missing-model", "");
      return;
    }

    // Rule 5: serial — an earlier row of this file wins first (C-2); then,
    // whether or not the tag matched, a serial already belonging to a
    // DIFFERENT asset blocks. `treatDuplicateSerialAsUpdate` rescues only the
    // no-tag-match case: when tag→A and serial→B the two matches disagree
    // about which asset the row even is, and no option can resolve that (C-1).
    const serial = textAt(headers, raw, "serial") || null;
    if (serial) {
      if (seenSerials.has(serial)) {
        block("duplicate-in-file", serial);
        return;
      }
      seenSerials.add(serial);
      const existingBySerial = refs.bySerial.get(serial);
      if (existingBySerial && existingBySerial.id !== updateAssetId) {
        if (!updateAssetId && options.treatDuplicateSerialAsUpdate) {
          updateAssetId = existingBySerial.id;
          matchedRecord = existingBySerial;
        } else {
          block("duplicate-serial", serial);
          return;
        }
      }
    }

    // Rule 7: category, type and vendor must resolve to reference data —
    // never created as a side effect of an upload (scope decision 12). Type
    // resolves WITHIN the row's own category, because AssetType is only
    // unique per category — pairing e.g. "Laptops" with a "Furniture" type
    // would otherwise produce an asset its own edit form can't save
    // (actions.ts:189 and :296 both check `type.categoryId !== d.categoryId`).
    const categoryRaw = textAt(headers, raw, "category");
    const categoryId = refs.categories.get(categoryRaw.toLowerCase());
    if (!categoryId) {
      block("unknown-category", categoryRaw);
      return;
    }

    const typeRaw = textAt(headers, raw, "type");
    let typeId: string | null = null;
    if (typeRaw) {
      const resolvedType = refs.types.get(`${categoryId}:${typeRaw.toLowerCase()}`);
      if (!resolvedType || resolvedType.categoryId !== categoryId) {
        block("unknown-type", typeRaw);
        return;
      }
      typeId = resolvedType.id;
    }

    const vendorRaw = textAt(headers, raw, "vendor");
    let vendorId: string | null = null;
    if (vendorRaw) {
      const resolvedVendor = refs.vendors.get(vendorRaw.toLowerCase());
      if (!resolvedVendor) {
        if (options.dropUnknownVendor) {
          vendorId = null;
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
    // `dropUnknownAssignee` rescues an unresolved or inactive match to
    // unassigned; it does NOT rescue ambiguous — dropping loses which of
    // several employees was meant, which is a different problem than "not
    // found". `createAsset` itself refuses a non-ACTIVE assignee ("assignments
    // are frozen", actions.ts:196); this mirrors that rule at import time.
    const assigneeRaw = textAt(headers, raw, "assignee");
    let assigneeId: string | null = null;
    let assigneeDropped = false;
    if (assigneeRaw) {
      const resolved = refs.employees.get(assigneeRaw.toLowerCase());
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
        if (options.dropUnknownAssignee) {
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

    if (updateAssetId) {
      // Rule 11 (update only, D-A): status/assignee never move via import. A
      // PRESENT (non-blank) Status or Assigned-to cell that disagrees with
      // the record's current value blocks, unless the operator explicitly
      // chose to keep the current lifecycle and apply just the rest of the row.
      const record = matchedRecord!;
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
      // dropped it, downgrade to SPARE instead of blocking — producing
      // DEPLOYED with no assignee from a button labelled "leave as spare"
      // would be exactly backwards.
      if (finalStatus === "DEPLOYED" || finalStatus === "TEMPORARY") {
        if (assigneeId === null) {
          if (assigneeDropped) {
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
    const notesRaw = textAt(headers, raw, "notes");
    if (model.length < LENGTH_LIMITS.model[0] || model.length > LENGTH_LIMITS.model[1]) {
      block("value-too-long", "Model");
      return;
    }
    if (serial && serial.length > LENGTH_LIMITS.serial[1]) {
      block("value-too-long", "Serial");
      return;
    }
    if (notesRaw.length > LENGTH_LIMITS.notes[1]) {
      block("value-too-long", "Notes");
      return;
    }

    if (updateAssetId) {
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
      if (headers.map.has("vendor")) patch.vendorId = vendorId;
      if (headers.map.has("notes")) patch.notes = notesRaw || null;

      rows.push({ kind: "update", row: sheetRow, assetId: updateAssetId, data: patch });
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
