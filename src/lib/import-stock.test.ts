import { describe, expect, it } from "vitest";
import { matchHeaders } from "./import-assets";
import { refKey } from "./tag-key";
import { STOCK_IMPORT_HEADERS, planStockRows, stockChanges, type StockRefs, type StockUpdatePatch } from "./import-stock";

// The real 9-column import TEMPLATE header (`STOCK_IMPORT_TEMPLATE_COLUMNS`,
// export-columns.ts) — not a subset. The flagship workflow (re-uploading an
// unedited template/export) exercises every column at once, "Unit cost"
// included — it must be a RECOGNISED column (review fix round 1, Minor #1),
// never break header matching, and never land in a planned row's data.
const HEADER = [
  "Code", "Name", "Category", "Unit", "Pack size", "Reorder level", "Opening quantity", "Unit cost", "Notes",
];

const COL = {
  code: 0, name: 1, category: 2, unit: 3, packSize: 4, reorderLevel: 5, openingQty: 6, unitCost: 7, notes: 8,
};

/** A 9-cell row, blank by default, with the given columns filled in. */
function cells(over: Partial<Record<keyof typeof COL, unknown>>): unknown[] {
  const row: unknown[] = Array(HEADER.length).fill("");
  for (const [key, value] of Object.entries(over)) row[COL[key as keyof typeof COL]] = value;
  return row;
}

const OS = { id: "cat-os", prefix: "OS" };
const CM = { id: "cat-cm", prefix: "CM" };

const REFS: StockRefs = {
  categoriesByKey: new Map([
    [refKey("Office supplies"), OS],
    [refKey("OS"), OS],
    [refKey("Cleaning materials"), CM],
    [refKey("CM"), CM],
    // A name/prefix collision: two different categories' keys land on the
    // same refKey — undecidable, so this must read as `null`.
    [refKey("Twin"), null],
  ]),
  itemsByCode: new Map([
    ["OS-0001", "item-os-1"],
    ["OS-0002", "item-os-2"],
  ]),
};

describe("matchHeaders(STOCK_IMPORT_HEADERS)", () => {
  it("matches every accepted header alias", () => {
    const m = matchHeaders(
      ["item code", "name", "category", "unit", "per pack", "minimum", "opening", "notes"],
      STOCK_IMPORT_HEADERS,
    );
    expect(m.map.get("code")).toBe(0);
    expect(m.map.get("packSize")).toBe(4);
    expect(m.map.get("reorderLevel")).toBe(5);
    expect(m.map.get("openingQty")).toBe(6);
  });

  it("also matches the 'on hand' alias for opening quantity", () => {
    const m = matchHeaders(["name", "category", "unit", "on hand"], STOCK_IMPORT_HEADERS);
    expect(m.map.get("openingQty")).toBe(3);
  });

  // Minor #1 (review fix round 1): spec §6's literal alias list, the three
  // that were missing before this round.
  it("also matches 'stock code' as an alias for code", () => {
    const m = matchHeaders(["stock code", "name", "category", "unit"], STOCK_IMPORT_HEADERS);
    expect(m.map.get("code")).toBe(0);
  });

  it("also matches 'reorder' as an alias for reorder level", () => {
    const m = matchHeaders(["name", "category", "unit", "reorder"], STOCK_IMPORT_HEADERS);
    expect(m.map.get("reorderLevel")).toBe(3);
  });

  it("also matches 'quantity' and 'available' as aliases for opening quantity", () => {
    const qty = matchHeaders(["name", "category", "unit", "quantity"], STOCK_IMPORT_HEADERS);
    expect(qty.map.get("openingQty")).toBe(3);
    const available = matchHeaders(["name", "category", "unit", "available"], STOCK_IMPORT_HEADERS);
    expect(available.map.get("openingQty")).toBe(3);
  });

  // Minor #1: `unitCost` had no header entry at all before this round, so
  // "Unit cost"/"Cost" always fell into `unknown` and needed
  // `STOCK_KNOWN_UNIMPORTED_COLUMNS` to keep the wizard from calling it a
  // typo. It is now a recognised field key — matched, not unknown — even
  // though nothing in the planner ever reads it (see `STOCK_IMPORT_HEADERS`'s
  // own comment).
  it("matches 'unit cost' and 'cost' to the unitCost field", () => {
    const uc = matchHeaders(["name", "category", "unit", "unit cost"], STOCK_IMPORT_HEADERS);
    expect(uc.map.get("unitCost")).toBe(3);
    expect(uc.unknown).toEqual([]);
    const cost = matchHeaders(["name", "category", "unit", "cost"], STOCK_IMPORT_HEADERS);
    expect(cost.map.get("unitCost")).toBe(3);
  });

  // Spec §6 / Minor #1: on the real template, "Unit cost" is now recognised
  // — it must NOT be reported as an unrecognised column (the wizard's
  // "check for a typo" line) any more than any other known column is.
  it("matches the real template header with Unit cost recognised, nothing missing or unknown", () => {
    const m = matchHeaders(HEADER, STOCK_IMPORT_HEADERS);
    expect(m.missing).toEqual([]);
    expect(m.map.get("unitCost")).toBe(COL.unitCost);
    expect(m.unknown).toEqual([]);
  });
});

describe("planStockRows", () => {
  const headers = matchHeaders(HEADER, STOCK_IMPORT_HEADERS);

  it("a row without a code creates, with code null", () => {
    const row = [cells({ name: "Whiteboard marker", category: "Office supplies", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ kind: "create", row: 2 });
    const data = (plan.rows[0] as { data: Record<string, unknown> }).data;
    expect(data.code).toBeNull();
    expect(data.categoryId).toBe(OS.id);
    expect(data.prefix).toBe(OS.prefix);
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 0 });
  });

  // Minor #1: `unitCost` is now a recognised header (matched into
  // `headers.map`), but `STOCK_IMPORT_HEADERS`'s own comment promises it is
  // consumed by nothing — pin that at the planner level too, not just at
  // the header-matching level above.
  it("never writes the unitCost column into planned row data, even though the header is recognised", () => {
    const row = [cells({ name: "x", category: "OS", unit: "piece", unitCost: 12.5 })];
    const plan = planStockRows(headers, row, REFS);
    const data = (plan.rows[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("unitCost");
  });

  it("a code matching the category's prefix creates with that code", () => {
    const row = [cells({ code: "OS-0009", name: "Bond paper legal", category: "Office supplies", unit: "ream" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "create" });
    const data = (plan.rows[0] as { data: Record<string, unknown> }).data;
    expect(data.code).toBe("OS-0009");
  });

  it("accepts a lower-case code, upper-casing it", () => {
    const row = [cells({ code: "os-0009", name: "Bond paper legal", category: "Office supplies", unit: "ream" })];
    const plan = planStockRows(headers, row, REFS);
    const data = (plan.rows[0] as { data: Record<string, unknown> }).data;
    expect(data.code).toBe("OS-0009");
  });

  it("blocks a code whose prefix doesn't match its row's category as bad-stock-code", () => {
    const row = [cells({ code: "PN-0009", name: "Something", category: "Office supplies", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-stock-code", detail: "PN-0009" });
  });

  it("blocks a code with too few digits as bad-stock-code, before category is even considered", () => {
    const row = [cells({ code: "OS-9", name: "Something", category: "Nonexistent", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-stock-code", detail: "OS-9" });
  });

  it("matches an existing code as an update carrying the item id", () => {
    const row = [cells({ code: "OS-0001", name: "Bond paper A4", category: "Office supplies", unit: "ream", reorderLevel: 12 })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "update", itemId: "item-os-1" });
    const patch = (plan.rows[0] as { data: Record<string, unknown> }).data;
    expect(patch.reorderLevel).toBe(12);
    expect(plan.counts).toEqual({ create: 0, update: 1, blocked: 0 });
  });

  it("matches an existing code case-insensitively", () => {
    const row = [cells({ code: "os-0001", name: "Bond paper A4", category: "Office supplies", unit: "ream" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "update", itemId: "item-os-1" });
  });

  it("blocks an existing code with a positive opening quantity as opening-on-existing", () => {
    const row = [cells({ code: "OS-0001", name: "Bond paper A4", category: "Office supplies", unit: "ream", openingQty: 5 })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "opening-on-existing", detail: "OS-0001" });
  });

  it("does not block an existing code with a blank or zero opening quantity", () => {
    const blank = planStockRows(headers, [cells({ code: "OS-0001", name: "x", category: "OS", unit: "ream" })], REFS);
    expect(blank.rows[0]).toMatchObject({ kind: "update" });
    const zero = planStockRows(headers, [cells({ code: "OS-0001", name: "x", category: "OS", unit: "ream", openingQty: 0 })], REFS);
    expect(zero.rows[0]).toMatchObject({ kind: "update" });
  });

  describe("update patch shape", () => {
    // A reduced sheet (Code, Reorder level only) — the patch must carry ONLY
    // that field, never touching name/unit/packSize/notes it never mentioned.
    const reducedHeader = matchHeaders(["Code", "Reorder level"], STOCK_IMPORT_HEADERS);
    it("carries only the fields whose column is present", () => {
      const row = [["OS-0001", "15"]];
      const plan = planStockRows(reducedHeader, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "update", itemId: "item-os-1" });
      const patch = (plan.rows[0] as { data: Record<string, unknown> }).data;
      expect(Object.keys(patch)).toEqual(["reorderLevel"]);
      expect(patch.reorderLevel).toBe(15);
    });
  });

  // Important (review fix round 1): the same missing-required discipline on
  // an UPDATE row's present columns — a blank Name or Unit cell must not
  // silently write "" (or, for Unit, block as `bad-unit` with an empty
  // detail) onto an existing item.
  describe("update rows: blank required cells", () => {
    it("blocks a blank name on an update row as missing-required, detail Name", () => {
      const row = [cells({ code: "OS-0001", category: "OS", unit: "ream" })]; // name blank
      const plan = planStockRows(headers, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Name" });
    });

    it("blocks a blank unit on an update row as missing-required, detail Unit", () => {
      const row = [cells({ code: "OS-0001", name: "Bond paper A4", category: "OS" })]; // unit blank
      const plan = planStockRows(headers, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Unit" });
    });

    it("joins Name and Unit when both are blank on an update row", () => {
      const row = [cells({ code: "OS-0001", category: "OS" })]; // name and unit both blank
      const plan = planStockRows(headers, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Name, Unit" });
    });

    it("does not block a blank name/unit when those columns are absent from the sheet", () => {
      const reducedHeader = matchHeaders(["Code", "Reorder level"], STOCK_IMPORT_HEADERS);
      const row = [["OS-0001", "15"]];
      const plan = planStockRows(reducedHeader, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "update", itemId: "item-os-1" });
    });
  });

  it("resolves a category by prefix as well as by name", () => {
    const byName = planStockRows(headers, [cells({ name: "x", category: "Office supplies", unit: "piece" })], REFS);
    const byPrefix = planStockRows(headers, [cells({ name: "x", category: "os", unit: "piece" })], REFS);
    expect((byName.rows[0] as { data: { categoryId: string } }).data.categoryId).toBe(OS.id);
    expect((byPrefix.rows[0] as { data: { categoryId: string } }).data.categoryId).toBe(OS.id);
  });

  it("blocks an unknown category as unknown-stock-category", () => {
    const row = [cells({ name: "x", category: "Garden", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "unknown-stock-category", detail: "Garden" });
  });

  it("blocks a category colliding case-insensitively as unknown-stock-category, detail ambiguous", () => {
    const row = [cells({ name: "x", category: "Twin", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "unknown-stock-category", detail: "ambiguous" });
  });

  // Important (review fix round 1): a blank Category cell is a MISSING
  // value, not an unknown one — `resolveCategory` has no way to tell those
  // apart on its own (an empty-string key is a defined map lookup, just one
  // that never resolves), so the planner must check blankness before ever
  // calling it. Mirrors `import-assets.ts`'s own NI-5 (round 2) fix for
  // exactly this defect class on its own Category column.
  it("blocks a blank category as missing-required, detail Category — never unknown-stock-category", () => {
    const row = [cells({ name: "x", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Category" });
  });

  // The explicit-code branch resolves category too (for the prefix cross-
  // check) — a blank Category cell must be caught there just as early, before
  // that cross-check ever runs, even though the code itself is well-formed.
  it("blocks a blank category as missing-required even behind an otherwise-valid explicit code", () => {
    const row = [cells({ code: "OS-0009", name: "x", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Category" });
  });

  // Important: a blank Name or Unit cell reports the SAME cause, with the
  // missing field named in the detail — not `bad-unit` with an empty (and
  // thus example-less) detail the way it did before this round.
  it("blocks a blank unit as missing-required, detail Unit", () => {
    const row = [cells({ name: "x", category: "OS" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Unit" });
  });

  // E-5 style: more than one blank required cell in the same row reports
  // ONE missing-required cause, naming every blank column — not just the
  // first one found — the same lumping import-employees.ts uses for its own
  // five required columns.
  it("joins every blank required field into one missing-required detail", () => {
    const row = [cells({ packSize: 5 })]; // name, category and unit all blank; row isn't wholly blank
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Name, Category, Unit" });
  });

  it("blocks a unit over 20 characters as bad-unit", () => {
    const row = [cells({ name: "x", category: "OS", unit: "x".repeat(21) })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-unit" });
  });

  it("blocks a non-numeric pack size as bad-number", () => {
    const row = [cells({ name: "x", category: "OS", unit: "piece", packSize: "abc" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number", detail: "abc" });
  });

  it("blocks a negative pack size as bad-number", () => {
    const row = [cells({ name: "x", category: "OS", unit: "piece", packSize: -2 })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number" });
  });

  it("blocks a non-integer opening quantity as bad-number", () => {
    const row = [cells({ name: "x", category: "OS", unit: "piece", openingQty: 1.5 })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number" });
  });

  it("reads a blank opening quantity as 0 on create", () => {
    const row = [cells({ name: "x", category: "OS", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    const data = (plan.rows[0] as { data: { openingQty: number } }).data;
    expect(data.openingQty).toBe(0);
  });

  it("reads a blank pack size as null and a blank reorder level as 0", () => {
    const row = [cells({ name: "x", category: "OS", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    const data = (plan.rows[0] as { data: { packSize: number | null; reorderLevel: number } }).data;
    expect(data.packSize).toBeNull();
    expect(data.reorderLevel).toBe(0);
  });

  it("carries a present notes cell through, and null for a blank one", () => {
    const withNotes = planStockRows(headers, [cells({ name: "x", category: "OS", unit: "piece", notes: "fragile" })], REFS);
    expect((withNotes.rows[0] as { data: { notes: string | null } }).data.notes).toBe("fragile");
    const blank = planStockRows(headers, [cells({ name: "x", category: "OS", unit: "piece" })], REFS);
    expect((blank.rows[0] as { data: { notes: string | null } }).data.notes).toBeNull();
  });

  it("blocks a blank name as missing-required, detail Name", () => {
    const row = [cells({ category: "OS", unit: "piece" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Name" });
  });

  it("blocks two rows sharing the same code as duplicate-in-file", () => {
    const rows = [
      cells({ code: "OS-0009", name: "A", category: "OS", unit: "piece" }),
      cells({ code: "OS-0009", name: "B", category: "OS", unit: "piece" }),
    ];
    const plan = planStockRows(headers, rows, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file" });
    expect(plan.rows[1]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file" });
    expect(plan.counts).toEqual({ create: 0, update: 0, blocked: 2 });
  });

  it("blocks two codeless rows sharing the same name and category as duplicate-in-file", () => {
    const rows = [
      cells({ name: "Dup Item", category: "OS", unit: "piece" }),
      cells({ name: "Dup Item", category: "os", unit: "piece" }),
    ];
    const plan = planStockRows(headers, rows, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file" });
    expect(plan.rows[1]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file" });
  });

  it("does not treat two codeless rows with the same name in DIFFERENT categories as duplicates", () => {
    const rows = [
      cells({ name: "Dup Item", category: "OS", unit: "piece" }),
      cells({ name: "Dup Item", category: "CM", unit: "piece" }),
    ];
    const plan = planStockRows(headers, rows, REFS);
    expect(plan.counts).toEqual({ create: 2, update: 0, blocked: 0 });
  });

  it("skips a wholly blank row, counted nowhere", () => {
    const rows = [cells({}), cells({ name: "New item", category: "OS", unit: "piece" })];
    const plan = planStockRows(headers, rows, REFS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].row).toBe(3);
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 0 });
  });

  it("keeps good rows even when other rows in the same file block", () => {
    const rows = [
      cells({ name: "New item", category: "OS", unit: "piece" }),
      cells({ name: "Bad item", category: "Garden", unit: "piece" }),
    ];
    const plan = planStockRows(headers, rows, REFS);
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 1 });
  });

  it("counts a full mixed file correctly", () => {
    const rows = [
      cells({ code: "OS-0001", name: "Bond paper A4", category: "OS", unit: "ream", reorderLevel: 12 }), // update
      cells({ code: "OS-0009", name: "New OS item", category: "Office supplies", unit: "ream" }), // create
      cells({ name: "Another new item", category: "Cleaning materials", unit: "bottle" }), // create
      cells({ code: "PN-0009", name: "Bad code", category: "OS", unit: "piece" }), // blocked: bad-stock-code
      cells({ name: "Bad category", category: "Garden", unit: "piece" }), // blocked: unknown-stock-category
      cells({ code: "OS-0002", name: "Bond paper", category: "OS", unit: "ream", openingQty: 5 }), // blocked: opening-on-existing
    ];
    const plan = planStockRows(headers, rows, REFS);
    expect(plan.counts).toEqual({ create: 2, update: 1, blocked: 3 });
  });
});

// Minor #3 (review fix round 1): mirrors `import-suppliers.test.ts`'s own
// `supplierChanges` suite, minus the Date cases — `StockUpdatePatch` has no
// date-typed field for a row to ever patch.
describe("stockChanges", () => {
  it("returns an empty diff and changed set when nothing differs", () => {
    const before = { name: "Bond paper A4", unit: "ream", packSize: 5, reorderLevel: 10, notes: null };
    const patch: StockUpdatePatch = { name: "Bond paper A4", unit: "ream", packSize: 5, reorderLevel: 10, notes: null };
    const { diff, changed } = stockChanges(before, patch);
    expect(diff).toEqual({});
    expect(changed).toEqual({});
  });

  it("reports a changed field in both diff and changed", () => {
    const before = { name: "Bond paper A4", reorderLevel: 10 };
    const patch: StockUpdatePatch = { name: "Bond paper A4", reorderLevel: 24 };
    const { diff, changed } = stockChanges(before, patch);
    expect(diff).toEqual({ reorderLevel: { from: 10, to: 24 } });
    expect(changed).toEqual({ reorderLevel: 24 });
  });

  it("only inspects keys present in the patch, ignoring other columns on `before`", () => {
    const before = { name: "Bond paper A4", unit: "ream", notes: "old" };
    const patch: StockUpdatePatch = { name: "Bond paper A4" };
    const { diff, changed } = stockChanges(before, patch);
    expect(diff).toEqual({});
    expect(changed).toEqual({});
  });

  it("reports a packSize changing to/from null", () => {
    const before = { packSize: 5 };
    const patch: StockUpdatePatch = { packSize: null };
    const { diff, changed } = stockChanges(before, patch);
    expect(diff).toEqual({ packSize: { from: 5, to: null } });
    expect(changed).toEqual({ packSize: null });
  });
});
