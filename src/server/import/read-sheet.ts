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
 * under both `Asia/Manila` and `America/New_York`):
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
 * `parseDateCell` (`src/lib/import-assets.ts`) currently assumes for a `Date`
 * cell: it reads the cell's LOCAL year/month/day and rebuilds it as UTC
 * midnight, which is correct for a local-midnight `Date` and correct for a
 * UTC-midnight `Date` only at a non-negative UTC offset. Fed a genuine
 * UTC-midnight `Date` — which is what this reader actually produces — that
 * rule reads the wrong calendar day at any negative offset. This is a T7
 * contract defect this task surfaced, not one this module can fix (a raw
 * `Date` value can't carry its own convention, and `read-sheet.ts` is not the
 * owner of `parseDateCell`); see the phase-9 handover for the pinned finding
 * and the fix it calls for on the T7 side (read the cell's UTC, not local,
 * year/month/day).
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
