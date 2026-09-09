import { describe, expect, it } from "vitest";
import { matchHeaders } from "./import-assets";
import { refKey } from "./tag-key";
import { STOCK_IMPORT_HEADERS, planStockRows, type StockRefs } from "./import-stock";

// The real 9-column import TEMPLATE header (`STOCK_IMPORT_TEMPLATE_COLUMNS`,
// export-columns.ts) — not a subset. The flagship workflow (re-uploading an
// unedited template/export) exercises every column at once, "Unit cost"
// included — it must land in `unknown`, never break header matching.
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

  // Spec §6: "Unit cost" is deliberately unmapped — it must fall into
  // `unknown`, not silently vanish into a field nothing reads.
  it("matches the real template header with Unit cost landing in unknown, nothing missing", () => {
    const m = matchHeaders(HEADER, STOCK_IMPORT_HEADERS);
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual(["Unit cost"]);
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

  it("blocks a blank unit as bad-unit", () => {
    const row = [cells({ name: "x", category: "OS" })];
    const plan = planStockRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-unit" });
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
