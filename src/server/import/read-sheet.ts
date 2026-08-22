import { readSheet } from "read-excel-file/node";
import { IMPORT_ROW_CAP, rowCapRefusal } from "@/lib/import-vocabulary";

export type ReadResult =
  | { ok: true; header: unknown[]; rows: unknown[][] }
  | { ok: false; reason: string };

/**
 * The ONLY `read-excel-file` import in the app, and deliberately schema-less:
 * `readSheet(file, { schema })` returns EITHER objects OR errors, never both, so
 * it cannot express the partial success this feature is built around (scope
 * decision 2). We take the grid and validate it ourselves.
 *
 * The row cap is enforced HERE, before any row is examined, so an oversized
 * file costs one length check rather than 4,000 validations.
 *
 * A wholly blank trailing row still counts toward the cap here, even though
 * `planAssetRows` skips it once it gets there (its rule 1). Left that way
 * deliberately: this module reads a grid, not a business rule, and knowing
 * which rows are "meaningfully" blank is `planAssetRows`'s call, not this
 * one's. The cost is a rare false-positive refusal on a sheet whose Excel
 * "used range" runs thousands of formatted-but-empty rows past its last real
 * one — recoverable by trimming the sheet and re-uploading, which is exactly
 * the fix `rowCapRefusal` already tells the operator to do.
 *
 * DATE CONVENTION (T8, pinned by running the round trip through our own
 * export — `toXlsxBuffer` / `ASSET_EXPORT_COLUMNS`, both writing
 * `{ type: Date, format: "yyyy-mm-dd" }` — and back through this `readSheet`,
 * under `Asia/Manila`, `America/New_York` and `UTC`):
 *
 * `readSheet` hands back a real `Date` instance for a date-formatted cell,
 * and that instant is **UTC midnight** of the calendar day the cell shows —
 * not local midnight. Proof: a cell written from `2026-01-05T00:00:00.000Z`
 * reads back with `toISOString() === "2026-01-05T00:00:00.000Z"` regardless
 * of `TZ`, i.e. the exact same instant every time; only the LOCAL calendar
 * day read off that instant moves with the offset (Manila: 2026-01-05;
 * New York, UTC-5: 2026-01-04 — one day early).
 *
 * That makes this reader's Date convention the OPPOSITE of what
 * `parseDateCell` (`src/lib/import-assets.ts`) assumed when this probe ran: it
 * read the cell's LOCAL year/month/day, which is correct for a local-midnight
 * `Date` and correct for a UTC-midnight one only at a non-negative UTC
 * offset — so against this reader it was a day early everywhere west of
 * Greenwich. **Fixed in the same breath as this module landed** (`df04742`):
 * that branch now reads the cell's UTC year/month/day, which is a no-op for
 * what this reader produces, and its suite asserts the contract under
 * `Asia/Manila`, `America/New_York` and `UTC`.
 *
 * So the two sides agree, and they agree BY MEASUREMENT rather than by
 * reasoning — which is the point, because three review rounds reasoned about
 * that branch from first principles and settled on the wrong convention. **If
 * this reader is ever swapped, or a second one is added, re-run the round trip
 * before trusting `parseDateCell`**: it is about fifteen lines under the
 * gitignored `backups/`, and a new reader that emits local midnight must
 * normalise here, at the boundary, rather than teaching that branch to guess
 * which convention it was handed.
 */
export async function readGrid(file: File): Promise<ReadResult> {
  let grid: unknown[][];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    grid = (await readSheet(buffer)) as unknown[][];
  } catch {
    // A corrupt or non-xlsx upload. The library's own error is a stack-shaped
    // string that tells an operator nothing, so it is never quoted.
    return {
      ok: false,
      reason: "That file could not be read as a spreadsheet. Save it as .xlsx and try again.",
    };
  }
  if (grid.length === 0) return { ok: false, reason: "That spreadsheet is empty." };

  const [header, ...rows] = grid;
  if (rows.length > IMPORT_ROW_CAP) return { ok: false, reason: rowCapRefusal(rows.length) };
  return { ok: true, header, rows };
}
