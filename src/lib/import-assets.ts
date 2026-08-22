import type { AssetStatus } from "@prisma/client";
import { ASSET_STATUSES } from "./inventory-list";
import type { BlockCause, BlockedRow, ImportOption } from "./import-vocabulary";

/**
 * Sheet header label → canonical field key. Extra sheet columns are ignored.
 *
 * `assignee` also accepts "employee no": the asset EXPORT (`ASSET_EXPORT_COLUMNS`
 * in `export-columns.ts`) writes the assignee as two columns, "Assigned to"
 * (name) and "Employee no" (employeeNo), so an edited export re-uploaded here
 * must still resolve — row rule 6 already looks an assignee value up by
 * employee number OR by name, so this is a header alias, not a new field.
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

/** Reference data, pre-resolved by the server. Name keys are lower-cased. */
export interface AssetRefs {
  categories: Map<string, string>;
  types: Map<string, string>;
  /** employeeNo AND name, both lower-cased, both → employee id */
  employees: Map<string, string>;
  vendors: Map<string, string>;
  /** existing assets by EXACT tag — the update path */
  byTag: Map<string, { id: string; serial: string | null }>;
  /** existing assets by EXACT serial — the duplicate path */
  bySerial: Map<string, string>;
}

export interface AssetImportData {
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

export type RowVerdict =
  | { kind: "create"; row: number; data: AssetImportData }
  | { kind: "update"; row: number; assetId: string; data: AssetImportData }
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type DateResult = { ok: true; value: Date | null } | { ok: false; raw: string };

function parseDateCell(raw: unknown): DateResult {
  if (isBlank(raw)) return { ok: true, value: null };
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? { ok: false, raw: String(raw) } : { ok: true, value: raw };
  }
  const text = String(raw).trim();
  if (DATE_ONLY.test(text)) return { ok: true, value: new Date(`${text}T00:00:00.000Z`) };
  return { ok: false, raw: text };
}

const COST_SHAPE = /^\d+(\.\d{1,2})?$/;

type CostResult = { ok: true; value: string | null } | { ok: false; raw: string };

function parseCostCell(raw: unknown): CostResult {
  if (isBlank(raw)) return { ok: true, value: null };
  if (typeof raw === "number") return { ok: true, value: String(raw) };
  const text = String(raw).trim();
  return COST_SHAPE.test(text) ? { ok: true, value: text } : { ok: false, raw: String(raw) };
}

/**
 * The per-row rules, applied in this order — see step 7 of the plan. First
 * failing check wins: exactly one cause per row.
 */
export function planAssetRows(
  headers: HeaderMatch,
  cells: unknown[][],
  refs: AssetRefs,
  options: ImportOptions,
): AssetPlan {
  const rows: RowVerdict[] = [];
  const counts = { create: 0, update: 0, blocked: 0 };

  cells.forEach((raw, i) => {
    const sheetRow = i + 2; // header is row 1

    // Rule 1: a wholly blank row is skipped entirely, not blocked.
    if (raw.every(isBlank)) return;

    const block = (cause: BlockCause, detail: string) => {
      rows.push({ kind: "blocked", row: sheetRow, cause, detail });
      counts.blocked += 1;
    };

    // Rule 2: tag blank → missing-tag.
    const tag = textAt(headers, raw, "tag");
    if (tag === "") {
      block("missing-tag", "");
      return;
    }

    // Rule 3: a known tag is an update, carrying the existing asset id.
    const existingByTag = refs.byTag.get(tag);
    let updateAssetId: string | null = existingByTag ? existingByTag.id : null;

    // Rule 4: otherwise a serial that already belongs to a different asset is
    // blocked, unless the operator picked the "treat as update" fix.
    const serial = textAt(headers, raw, "serial") || null;
    if (!updateAssetId && serial) {
      const existingBySerial = refs.bySerial.get(serial);
      if (existingBySerial) {
        if (options.treatDuplicateSerialAsUpdate) {
          updateAssetId = existingBySerial;
        } else {
          block("duplicate-serial", serial);
          return;
        }
      }
    }

    // Rule 5: category, type and vendor must resolve to reference data — never
    // created as a side effect of an upload (scope decision 12).
    const categoryRaw = textAt(headers, raw, "category");
    const categoryId = refs.categories.get(categoryRaw.toLowerCase());
    if (!categoryId) {
      block("unknown-category", categoryRaw);
      return;
    }

    const typeRaw = textAt(headers, raw, "type");
    let typeId: string | null = null;
    if (typeRaw) {
      const resolved = refs.types.get(typeRaw.toLowerCase());
      if (!resolved) {
        block("unknown-type", typeRaw);
        return;
      }
      typeId = resolved;
    }

    const vendorRaw = textAt(headers, raw, "vendor");
    let vendorId: string | null = null;
    if (vendorRaw) {
      const resolved = refs.vendors.get(vendorRaw.toLowerCase());
      if (!resolved) {
        block("unknown-vendor", vendorRaw);
        return;
      }
      vendorId = resolved;
    }

    // Rule 6: an assignee must resolve by employee number or name, unless the
    // operator picked "leave as spare".
    const assigneeRaw = textAt(headers, raw, "assignee");
    let assigneeId: string | null = null;
    if (assigneeRaw) {
      const resolved = refs.employees.get(assigneeRaw.toLowerCase());
      if (!resolved) {
        if (options.dropUnknownAssignee) {
          assigneeId = null;
        } else {
          block("unknown-assignee", assigneeRaw);
          return;
        }
      } else {
        assigneeId = resolved;
      }
    }

    // Rule 7: status blank → SPARE; otherwise must be one of the eight.
    const statusRaw = textAt(headers, raw, "status");
    let status: AssetStatus;
    if (statusRaw === "") {
      status = "SPARE";
    } else {
      const upper = statusRaw.toUpperCase();
      const match = (ASSET_STATUSES as readonly string[]).find((s) => s === upper);
      if (!match) {
        block("bad-status", statusRaw);
        return;
      }
      status = match as AssetStatus;
    }

    // Rule 8: dates — a real Date cell or YYYY-MM-DD text; anything else is bad-date.
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

    // Rule 9: cost — a number is stringified; a string must be a plain amount.
    const costResult = parseCostCell(cellAt(headers, raw, "cost"));
    if (!costResult.ok) {
      block("bad-number", costResult.raw);
      return;
    }

    const model = textAt(headers, raw, "model");
    const notesRaw = textAt(headers, raw, "notes");

    const data: AssetImportData = {
      tag,
      model,
      serial,
      categoryId,
      typeId,
      status,
      assigneeId,
      purchasedAt: purchasedAtResult.value,
      cost: costResult.value,
      warrantyUntil: warrantyUntilResult.value,
      vendorId,
      notes: notesRaw || null,
    };

    if (updateAssetId) {
      rows.push({ kind: "update", row: sheetRow, assetId: updateAssetId, data });
      counts.update += 1;
    } else {
      rows.push({ kind: "create", row: sheetRow, data });
      counts.create += 1;
    }
  });

  return { rows, counts };
}
