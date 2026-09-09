import { cellText, refKey, type HeaderMatch } from "./import-assets";
import { isBlank } from "./tag-key";
import { STOCK_CODE_SHAPE, parseStockCode } from "./stock-code";
import type { BlockCause, BlockedRow } from "./import-vocabulary";

/**
 * Phase 19 Task 6's own header spec, handed to the same generic
 * `matchHeaders` (`import-assets.ts`) every other importer uses — not a
 * second copy of the matching loop.
 *
 * `unitCost` is DELIBERATELY not a key any row here maps to: `StockField`
 * (below) includes it so the type documents every column the import
 * TEMPLATE writes (`STOCK_IMPORT_TEMPLATE_COLUMNS`, `export-columns.ts`),
 * but "Unit cost" has no entry in this array — it is never consumed by
 * `matchHeaders`, so it always falls into `unknown`, and
 * `STOCK_KNOWN_UNIMPORTED_COLUMNS` (`import-columns.ts`) is what tells the
 * wizard that is expected rather than a typo. Spec §6: unit cost is recorded
 * on a receipt (`StockLot.unitCost`, a per-lot figure), never on the item
 * itself, so there is no field here for a sheet value to land in even if it
 * were matched.
 *
 * `name`, `category` and `unit` are the three required columns — every one
 * of them is needed to create an item, and an update row that omits one
 * simply doesn't touch that field (the same "absent means don't touch"
 * convention `SupplierUpdatePatch` already uses). `code` is NOT required:
 * a sheet of brand-new items may have no Code column at all, every row
 * reading exactly like a blank cell would.
 */
export const STOCK_IMPORT_HEADERS = [
  { key: "code", labels: ["code", "item code"], required: false, title: "Code" },
  { key: "name", labels: ["name"], required: true, title: "Name" },
  { key: "category", labels: ["category"], required: true, title: "Category" },
  { key: "unit", labels: ["unit"], required: true, title: "Unit" },
  { key: "packSize", labels: ["pack size", "per pack"], required: false, title: "Pack size" },
  { key: "reorderLevel", labels: ["reorder level", "minimum"], required: false, title: "Reorder level" },
  { key: "openingQty", labels: ["opening quantity", "opening", "on hand"], required: false, title: "Opening quantity" },
  { key: "notes", labels: ["notes", "note"], required: false, title: "Notes" },
] as const;

export type StockField =
  | "code" | "name" | "category" | "unit" | "packSize" | "reorderLevel" | "openingQty" | "unitCost" | "notes";

/**
 * Reference data, pre-resolved by the server (`resolveStockRefs`,
 * `server/modules/import/resolve.ts`).
 *
 * `categoriesByKey`: BOTH `refKey(category.name)` and `refKey(category.prefix)`
 * map to the same category — spec's own rule that a category may be named
 * either way on a sheet ("Office supplies" or "OS"). `null` means the key
 * matched more than one category — the same R-1 collision guard
 * categories/types/vendors/departments already have, extended here to a
 * key namespace shared between two different columns of the SAME table
 * (`StockCategory.name` and `.prefix` are each `@unique` on their own, but
 * nothing stops one category's name from colliding case-insensitively with
 * another's prefix, or two categories' prefixes from colliding the way two
 * names already can).
 *
 * `itemsByCode`: exact match, NOT `refKey`'d — every stored code is already
 * upper-case (`formatStockCode`), and `planStockRows` upper-cases a sheet's
 * Code cell before consulting this map (the same convention `tagKey`
 * established for asset tags), so a case-insensitive collision here is not
 * a scenario this map needs to represent.
 */
export interface StockRefs {
  categoriesByKey: Map<string, { id: string; prefix: string } | null>;
  itemsByCode: Map<string, string>;
}

export interface StockCreateData {
  code: string | null;
  categoryId: string;
  prefix: string;
  name: string;
  unit: string;
  packSize: number | null;
  reorderLevel: number;
  notes: string | null;
  openingQty: number;
}

/**
 * `code` and `categoryId`/`prefix` are identity, never editable via an
 * update row (the same E-1 convention `EmployeeUpdatePatch` follows for
 * `employeeNo` — an item's category may only change through its own edit
 * form, and only while it has no movements, `item-actions.ts`'s
 * `updateStockItem`). `openingQty` has no place in an update at all — an
 * existing item already has a ledger, so `opening-on-existing` blocks the
 * row outright rather than this type quietly having nowhere to put the
 * value.
 */
export type StockUpdatePatch = Partial<Pick<StockCreateData, "name" | "unit" | "packSize" | "reorderLevel" | "notes">>;

export type StockRowVerdict =
  | { kind: "create"; row: number; data: StockCreateData }
  | { kind: "update"; row: number; itemId: string; data: StockUpdatePatch }
  | ({ kind: "blocked" } & BlockedRow);

export interface StockPlan {
  rows: StockRowVerdict[];
  counts: { create: number; update: number; blocked: number };
}

/** Every field of `StockUpdatePatch`, in the order the create side lists them. */
const PATCH_FIELDS = ["name", "unit", "packSize", "reorderLevel", "notes"] as const satisfies readonly StockField[];

function cellAt(headers: HeaderMatch<StockField>, cells: unknown[], field: StockField): unknown {
  const index = headers.map.get(field);
  return index === undefined ? undefined : cells[index];
}

function textAt(headers: HeaderMatch<StockField>, cells: unknown[], field: StockField): string {
  return cellText(cellAt(headers, cells, field));
}

function textOrNull(headers: HeaderMatch<StockField>, cells: unknown[], field: StockField): string | null {
  const t = textAt(headers, cells, field);
  return t === "" ? null : t;
}

/** The row's own identity key for the two-pass duplicate check: the code
 * when the row gives one, else category+name — the same pair that would
 * otherwise resolve to the same brand-new item. */
function identityKey(headers: HeaderMatch<StockField>, raw: unknown[]): string {
  const codeRaw = textAt(headers, raw, "code");
  if (codeRaw !== "") return `code:${refKey(codeRaw)}`;
  return `new:${refKey(textAt(headers, raw, "category"))}|${refKey(textAt(headers, raw, "name"))}`;
}

type IntResult = { ok: true; value: number } | { ok: false };

/** `Number(cellText)` with an `Number.isInteger` check (Step 4's own words) —
 * a plain non-negative whole number, nothing fancier. Blank is handled by
 * the caller (it means different things per field: 0 for a quantity, null
 * for a nullable one), not by this parser. */
function parseIntCell(text: string): IntResult {
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

const UNIT_MAX = 20;

interface CategoryResolution {
  ok: boolean;
  category: { id: string; prefix: string } | null;
  detail: string;
}

/** `categoriesByKey.get(refKey(cell))`: absent → genuinely unknown (detail is
 * the cell's own text); `null` → two categories collide on this key, an
 * undecidable state (detail "ambiguous"); otherwise the resolved category. */
function resolveCategory(refs: StockRefs, categoryRaw: string): CategoryResolution {
  const found = refs.categoriesByKey.get(refKey(categoryRaw));
  if (found === undefined) return { ok: false, category: null, detail: categoryRaw };
  if (found === null) return { ok: false, category: null, detail: "ambiguous" };
  return { ok: true, category: found, detail: "" };
}

/**
 * The per-row rules (Phase 19 Task 6, spec §6). First failing check wins:
 * exactly one cause per row, the same discipline every other importer's
 * planner follows.
 *
 * Two passes, the same shape `planSupplierRows` uses: a code, or a
 * category+name pair, claimed by more than one row of this file blocks BOTH
 * rows, not just the second to appear.
 */
export function planStockRows(headers: HeaderMatch<StockField>, cells: unknown[][], refs: StockRefs): StockPlan {
  const rows: StockRowVerdict[] = [];
  const counts = { create: 0, update: 0, blocked: 0 };

  const keyCounts = new Map<string, number>();
  for (const raw of cells) {
    if (raw.every(isBlank)) continue;
    const key = identityKey(headers, raw);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  const present = (field: StockField) => headers.map.has(field);

  cells.forEach((raw, i) => {
    const sheetRow = i + 2; // header is row 1

    // Rule 1: a wholly blank row is skipped entirely, not blocked.
    if (raw.every(isBlank)) return;

    const block = (cause: BlockCause, detail: string) => {
      rows.push({ kind: "blocked", row: sheetRow, cause, detail });
      counts.blocked += 1;
    };

    const codeRaw = textAt(headers, raw, "code");
    const nameRaw = textAt(headers, raw, "name");
    const categoryRaw = textAt(headers, raw, "category");

    // Rule 2 (two-pass, this file): a code — or, absent one, a category+name
    // pair — claimed by more than one row here blocks BOTH, before either
    // is allowed to resolve against the database.
    if ((keyCounts.get(identityKey(headers, raw)) ?? 0) > 1) {
      block("duplicate-in-file", codeRaw || nameRaw);
      return;
    }

    const codeKey = codeRaw === "" ? "" : codeRaw.toUpperCase();
    const existingId = codeKey === "" ? undefined : refs.itemsByCode.get(codeKey);

    if (existingId) {
      // UPDATE: identity is the code; category is not re-checked (it isn't
      // editable via an import row at all — item-actions.ts's own edit form
      // is the one place a category can move, and only while the item has
      // no movements yet).
      const openingRaw = textAt(headers, raw, "openingQty");
      if (openingRaw !== "") {
        const opening = parseIntCell(openingRaw);
        if (!opening.ok) {
          block("bad-number", openingRaw);
          return;
        }
        if (opening.value > 0) {
          block("opening-on-existing", codeRaw);
          return;
        }
      }

      const data: StockUpdatePatch = {};
      for (const field of PATCH_FIELDS) {
        if (!present(field)) continue;
        if (field === "name") {
          if (nameRaw === "") {
            block("missing-required", "Name");
            return;
          }
          data.name = nameRaw;
        } else if (field === "unit") {
          const unitRaw = textAt(headers, raw, "unit");
          if (unitRaw.length < 1 || unitRaw.length > UNIT_MAX) {
            block("bad-unit", unitRaw);
            return;
          }
          data.unit = unitRaw;
        } else if (field === "packSize") {
          const packRaw = textAt(headers, raw, "packSize");
          if (packRaw === "") {
            data.packSize = null;
          } else {
            const parsed = parseIntCell(packRaw);
            if (!parsed.ok) {
              block("bad-number", packRaw);
              return;
            }
            data.packSize = parsed.value;
          }
        } else if (field === "reorderLevel") {
          const reorderRaw = textAt(headers, raw, "reorderLevel");
          if (reorderRaw === "") {
            data.reorderLevel = 0;
          } else {
            const parsed = parseIntCell(reorderRaw);
            if (!parsed.ok) {
              block("bad-number", reorderRaw);
              return;
            }
            data.reorderLevel = parsed.value;
          }
        } else if (field === "notes") {
          data.notes = textOrNull(headers, raw, "notes");
        }
      }
      // A row that fell through to here without an early `return` inside
      // the loop above succeeded on every present column.
      rows.push({ kind: "update", row: sheetRow, itemId: existingId, data });
      counts.update += 1;
      return;
    }

    // CREATE from here down — either a blank Code cell (assigned a code at
    // apply time) or a Code cell naming no existing item (an explicit code
    // for a brand-new one).
    let code: string | null = null;
    let category: { id: string; prefix: string };

    if (codeKey !== "") {
      if (!STOCK_CODE_SHAPE.test(codeKey)) {
        block("bad-stock-code", codeRaw);
        return;
      }
      const resolved = resolveCategory(refs, categoryRaw);
      if (!resolved.ok) {
        block("unknown-stock-category", resolved.detail);
        return;
      }
      const parsed = parseStockCode(codeKey)!;
      if (parsed.prefix !== resolved.category!.prefix) {
        block("bad-stock-code", codeRaw);
        return;
      }
      code = codeKey;
      category = resolved.category!;
    } else {
      const resolved = resolveCategory(refs, categoryRaw);
      if (!resolved.ok) {
        block("unknown-stock-category", resolved.detail);
        return;
      }
      category = resolved.category!;
    }

    if (nameRaw === "") {
      block("missing-required", "Name");
      return;
    }

    const unitRaw = textAt(headers, raw, "unit");
    if (unitRaw.length < 1 || unitRaw.length > UNIT_MAX) {
      block("bad-unit", unitRaw);
      return;
    }

    const packRaw = textAt(headers, raw, "packSize");
    let packSize: number | null = null;
    if (packRaw !== "") {
      const parsed = parseIntCell(packRaw);
      if (!parsed.ok) {
        block("bad-number", packRaw);
        return;
      }
      packSize = parsed.value;
    }

    const reorderRaw = textAt(headers, raw, "reorderLevel");
    let reorderLevel = 0;
    if (reorderRaw !== "") {
      const parsed = parseIntCell(reorderRaw);
      if (!parsed.ok) {
        block("bad-number", reorderRaw);
        return;
      }
      reorderLevel = parsed.value;
    }

    const openingRaw = textAt(headers, raw, "openingQty");
    let openingQty = 0;
    if (openingRaw !== "") {
      const parsed = parseIntCell(openingRaw);
      if (!parsed.ok) {
        block("bad-number", openingRaw);
        return;
      }
      openingQty = parsed.value;
    }

    const data: StockCreateData = {
      code, categoryId: category.id, prefix: category.prefix, name: nameRaw, unit: unitRaw,
      packSize, reorderLevel, notes: textOrNull(headers, raw, "notes"), openingQty,
    };
    rows.push({ kind: "create", row: sheetRow, data });
    counts.create += 1;
  });

  return { rows, counts };
}
