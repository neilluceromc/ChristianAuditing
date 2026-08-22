import { describe, expect, it } from "vitest";
import { IMPORT_ROW_CAP } from "@/lib/import-vocabulary";
import { toXlsxBuffer, type XlsxColumn } from "@/server/xlsx/write";
import { readGrid } from "./read-sheet";

/**
 * The plan said "no unit test here, deliberately", on the grounds that mocking
 * `readSheet` would only assert the mock. That is true of the library call —
 * and it is not true of the other two branches, which a REAL buffer exercises
 * with no mock anywhere: the row cap (a refusal that stands between one click
 * and 2,000 rows in an append-only audit table) and the catch (the only thing
 * an operator ever sees when an upload is not a spreadsheet). Both are cheap
 * to write honestly, so they are written honestly. The date convention this
 * module pins is asserted on the `parseDateCell` side, where the rule lives.
 */

const COLUMNS: XlsxColumn<{ tag: string }>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
];

async function sheet(rowCount: number): Promise<File> {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ tag: `BR-LT-${String(i).padStart(4, "0")}` }));
  const buffer = await toXlsxBuffer(COLUMNS, rows);
  // Buffer is not a `BlobPart` under this tsconfig — a Uint8Array view over the
  // same bytes is, and copies nothing.
  return new File([new Uint8Array(buffer)], "upload.xlsx");
}

describe("readGrid", () => {
  it("returns the header separately from the data rows", async () => {
    const result = await readGrid(await sheet(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header).toEqual(["Tag"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0][0]).toBe("BR-LT-0000");
  });

  // A file someone exported and then emptied. Not an error: `matchHeaders`
  // still has something to check, and "0 rows" is a truthful verdict.
  it("reads a header-only sheet as zero rows rather than an error", async () => {
    const result = await readGrid(await sheet(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header).toEqual(["Tag"]);
    expect(result.rows).toEqual([]);
  });

  it("accepts a file exactly at the row cap", async () => {
    const result = await readGrid(await sheet(IMPORT_ROW_CAP));
    expect(result.ok).toBe(true);
  });

  // The cap counts DATA rows, not sheet rows — an off-by-one here either
  // refuses a legal file or lets one row past the ceiling.
  it("refuses one row past the cap, naming the count and writing nothing", async () => {
    const result = await readGrid(await sheet(IMPORT_ROW_CAP + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(String(IMPORT_ROW_CAP + 1));
    expect(result.reason).toContain("Nothing was imported");
  });

  it("refuses a file that is not a spreadsheet, without quoting the library's error", async () => {
    const result = await readGrid(new File([new TextEncoder().encode("this is not xlsx")], "notes.txt"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(".xlsx");
    // The library throws stack-shaped strings that tell an operator nothing.
    expect(result.reason).not.toMatch(/error|stack|zip|undefined/i);
  });
});
