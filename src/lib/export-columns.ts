import type { XlsxColumn } from "@/server/xlsx/write";

export const EXPORT_CAP = 10_000;

/**
 * A `?ids=` selection is a bulk selection from the list screen, so it is bounded
 * by what that screen can select. It used to be silently sliced here, which is
 * the same defect the row cap exists to prevent, one layer down (§8).
 */
export const IDS_CAP = 500;

export function capRefusalText(count: number): string {
  return (
    `Export refused: ${count} rows exceeds the ${EXPORT_CAP}-row cap. ` +
    "Narrow the filters — splitting by purchase year works well, and the year chips above the list do " +
    "exactly that — then try again. Nothing was exported."
  );
}

export function idsRefusalText(count: number): string {
  return (
    `Export refused: ${count} selected rows exceeds the ${IDS_CAP}-row selection cap. ` +
    "Export the filtered list instead of a selection, or select fewer. Nothing was exported."
  );
}

/**
 * The asset sheet. Order is the order a human reads, not the schema's order.
 *
 * `employeeNo` and `rmaRef` are carried over from the CSV export this route
 * replaces (`src/lib/csv.ts`'s caller) — they are real columns of today's
 * download, not something this conversion gets to drop silently.
 */
export const ASSET_EXPORT_COLUMNS: XlsxColumn<{
  tag: string; model: string; serial: string | null; categoryName: string; typeName: string | null;
  status: string; assigneeName: string | null; assigneeNo: string | null; purchasedAt: Date | null;
  cost: number | null; warrantyUntil: Date | null; vendorName: string | null; rmaRef: string | null;
  notes: string | null;
}>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: r.model }) },
  { label: "Serial", width: 20, cell: (r) => ({ value: r.serial }) },
  { label: "Category", width: 18, cell: (r) => ({ value: r.categoryName }) },
  { label: "Type", width: 18, cell: (r) => ({ value: r.typeName }) },
  { label: "Status", width: 14, cell: (r) => ({ value: r.status }) },
  { label: "Assigned to", width: 24, cell: (r) => ({ value: r.assigneeName }) },
  { label: "Employee no", width: 14, cell: (r) => ({ value: r.assigneeNo }) },
  { label: "Purchased", width: 13, cell: (r) => ({ value: r.purchasedAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Cost", width: 13, cell: (r) => ({ value: r.cost, type: Number, format: "#,##0.00" }) },
  { label: "Warranty until", width: 14, cell: (r) => ({ value: r.warrantyUntil, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Vendor", width: 20, cell: (r) => ({ value: r.vendorName }) },
  { label: "RMA ref", width: 16, cell: (r) => ({ value: r.rmaRef }) },
  { label: "Notes", width: 40, cell: (r) => ({ value: r.notes }) },
];
