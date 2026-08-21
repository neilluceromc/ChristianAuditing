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

/**
 * The audit sheet. `entityLabel` is the resolved label `entityLabels()`
 * produces for the page (asset tag, employee name, …) — never the raw
 * `entityId` — so the export reads the same way the screen does; see
 * `src/server/modules/audit/queries.ts`'s `entityLabels`.
 */
export const AUDIT_EXPORT_COLUMNS: XlsxColumn<{
  when: Date; actor: string; entityType: string; entityLabel: string; action: string; fields: string;
}>[] = [
  { label: "When", width: 18, cell: (r) => ({ value: r.when, type: Date, format: "yyyy-mm-dd hh:mm" }) },
  { label: "Actor", width: 26, cell: (r) => ({ value: r.actor }) },
  { label: "Entity type", width: 18, cell: (r) => ({ value: r.entityType }) },
  { label: "Entity", width: 32, cell: (r) => ({ value: r.entityLabel }) },
  { label: "Action", width: 20, cell: (r) => ({ value: r.action }) },
  { label: "Fields changed", width: 30, cell: (r) => ({ value: r.fields }) },
];

/**
 * Checked against `prisma/schema.prisma`'s `Employee`, which is narrower than
 * you might assume: there is **no email column**, the date is `joinedAt` not
 * `startedAt`, and `title` and `departmentId` are both REQUIRED. Do not add an
 * Email column here — nothing would fill it.
 */
export const EMPLOYEE_EXPORT_COLUMNS: XlsxColumn<{
  employeeNo: string; name: string; department: string; title: string;
  employment: string; m365Status: string | null; joinedAt: Date; itemsHeld: number;
}>[] = [
  { label: "Employee no", width: 14, cell: (r) => ({ value: r.employeeNo }) },
  { label: "Name", width: 26, cell: (r) => ({ value: r.name }) },
  { label: "Department", width: 20, cell: (r) => ({ value: r.department }) },
  { label: "Title", width: 24, cell: (r) => ({ value: r.title }) },
  { label: "Employment", width: 16, cell: (r) => ({ value: r.employment }) },
  // Nullable and deliberately last of the text columns: null means "never
  // synced", which is a real and common state, not a gap to be filled in.
  { label: "M365", width: 14, cell: (r) => ({ value: r.m365Status }) },
  { label: "Joined", width: 13, cell: (r) => ({ value: r.joinedAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Items held", width: 12, cell: (r) => ({ value: r.itemsHeld, type: Number }) },
];
