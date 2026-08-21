import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { toXlsxBuffer, type XlsxColumn } from "./write";

interface Row { tag: string; cost: number | null; purchasedAt: Date | null }

const COLUMNS: XlsxColumn<Row>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Cost", width: 12, cell: (r) => ({ value: r.cost, type: Number, format: "#,##0.00" }) },
  { label: "Purchased", width: 14, cell: (r) => ({ value: r.purchasedAt, type: Date, format: "yyyy-mm-dd" }) },
];

describe("toXlsxBuffer", () => {
  it("round-trips a header row and typed cells", async () => {
    const buffer = await toXlsxBuffer(COLUMNS, [
      { tag: "BR-LT-0148", cost: 51234.56, purchasedAt: new Date("2024-03-01T00:00:00Z") },
    ]);
    const grid = await readSheet(buffer);
    expect(grid[0]).toEqual(["Tag", "Cost", "Purchased"]);
    expect(grid[1][0]).toBe("BR-LT-0148");
    expect(grid[1][1]).toBe(51234.56);
    expect(grid[1][2]).toBeInstanceOf(Date);
  });

  // A null cell must be an EMPTY cell, not the string "null" — every nullable
  // column in this app (cost, serial, assignee) hits this on the first export.
  it("writes a null as an empty cell, never as text", async () => {
    const buffer = await toXlsxBuffer(COLUMNS, [{ tag: "BR-LT-0001", cost: null, purchasedAt: null }]);
    const grid = await readSheet(buffer);
    expect(grid[1][1] ?? null).toBeNull();
    expect(grid[1][2] ?? null).toBeNull();
  });

  it("writes a header even when there are no rows, so an empty export is still a valid sheet", async () => {
    const buffer = await toXlsxBuffer(COLUMNS, []);
    const grid = await readSheet(buffer);
    expect(grid[0]).toEqual(["Tag", "Cost", "Purchased"]);
    expect(grid).toHaveLength(1);
  });
});
