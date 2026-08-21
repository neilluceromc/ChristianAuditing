import writeExcelFile, { getSheetData } from "write-excel-file/node";
import type { CellObject, Column, Value } from "write-excel-file/node";

/**
 * One column of an export sheet. `cell` returns almost write-excel-file's own
 * cell shape (`Value`/`CellObject["type"]` come straight from the library, so
 * a caller can set a real `type`/`format` without this module knowing
 * anything about the domain) — except `value` may be `null`, because every
 * nullable column in this app (cost, serial, assignee) needs to say "no
 * value" and the library's own type only allows `undefined` for that. The
 * translation happens once, below, rather than in every caller.
 *
 * The header is always bold: these files are opened in Excel by people, and a
 * sheet whose first row looks like data is one AutoFilter away from being
 * sorted into nonsense.
 */
export interface XlsxColumn<T> {
  label: string;
  width?: number;
  cell: (row: T) => { value: Value | null; type?: CellObject["type"]; format?: string };
}

/**
 * The ONLY `write-excel-file` import in the app. Everything else passes
 * columns and rows. Returns a Buffer rather than writing a file: these are
 * HTTP downloads and nothing should touch the filesystem to serve one.
 */
export async function toXlsxBuffer<T>(columns: XlsxColumn<T>[], rows: T[]): Promise<Buffer> {
  const libColumns: Column<T>[] = columns.map((c) => ({
    header: { value: c.label, fontWeight: "bold" as const },
    width: c.width,
    // `value ?? undefined`: at runtime write-excel-file treats `null` and
    // `undefined` identically (both become an empty cell — see its
    // `row.js`'s `isEmpty()`), but its published type only allows
    // `undefined` in `CellObject.value`. This coercion exists to satisfy
    // that type, not to work around a real behavioural difference — do not
    // read it as one.
    cell: (row: T): CellObject => {
      const out = c.cell(row);
      return { value: out.value ?? undefined, type: out.type, format: out.format };
    },
  }));

  // `writeExcelFile(rows, { columns })` cannot tell an empty *objects* array
  // apart from an already-empty *sheet*: its own dispatcher treats a
  // zero-length first argument as pre-built SheetData and never calls
  // `columns[].cell`/`header` at all, so a zero-row export would silently
  // come out with no header row either. Building the grid ourselves with
  // `getSheetData` sidesteps that ambiguity — the header row is always
  // present, so the grid this hands to `writeExcelFile` is never actually
  // empty, even when `rows` is.
  const sheetData = getSheetData(rows, libColumns);
  return writeExcelFile(sheetData, {
    columns: libColumns.map((c) => ({ width: c.width })),
  }).toBuffer();
}
