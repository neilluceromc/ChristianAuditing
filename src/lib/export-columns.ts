import type { XlsxColumn } from "@/server/xlsx/write";
import type { DepAssetRow } from "@/server/modules/finance/depreciation-queries";
import { monthLabel, type YearRow } from "@/lib/depreciation";
import { localDateISO } from "@/lib/format";
import { REG_LABEL_FINANCE } from "@/lib/registration";

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
  tag: string; model: string; brand: string | null; serial: string | null; categoryName: string; typeName: string | null;
  status: string; assigneeName: string | null; assigneeNo: string | null; purchasedAt: Date | null;
  cost: number | null; warrantyUntil: Date | null; loanDueAt: Date | null; vendorName: string | null;
  invoiceRef: string | null; rmaRef: string | null; notes: string | null; provenance: string;
}>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: r.model }) },
  { label: "Brand", width: 16, cell: (r) => ({ value: r.brand }) },
  { label: "Serial", width: 20, cell: (r) => ({ value: r.serial }) },
  { label: "Category", width: 18, cell: (r) => ({ value: r.categoryName }) },
  { label: "Type", width: 18, cell: (r) => ({ value: r.typeName }) },
  { label: "Status", width: 14, cell: (r) => ({ value: r.status }) },
  { label: "Assigned to", width: 24, cell: (r) => ({ value: r.assigneeName }) },
  { label: "Employee no", width: 14, cell: (r) => ({ value: r.assigneeNo }) },
  { label: "Purchased", width: 13, cell: (r) => ({ value: r.purchasedAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Cost", width: 13, cell: (r) => ({ value: r.cost, type: Number, format: "#,##0.00" }) },
  { label: "Warranty until", width: 14, cell: (r) => ({ value: r.warrantyUntil, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Loan until", width: 14, cell: (r) => ({ value: r.loanDueAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Vendor", width: 20, cell: (r) => ({ value: r.vendorName }) },
  { label: "Provenance", width: 24, cell: (r) => ({ value: r.provenance }) },
  { label: "Invoice / receipt no.", width: 18, cell: (r) => ({ value: r.invoiceRef }) },
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
  employeeNo: string; name: string; department: string; kind: "INTERNAL" | "CLIENT"; title: string;
  employment: string; m365Status: string | null; joinedAt: Date; itemsHeld: number;
}>[] = [
  { label: "Employee no", width: 14, cell: (r) => ({ value: r.employeeNo }) },
  { label: "Name", width: 26, cell: (r) => ({ value: r.name }) },
  // Phase 37 (spec §2.3): the group's name, then whether it is a department or a client.
  { label: "Works for", width: 20, cell: (r) => ({ value: r.department }) },
  { label: "Staff", width: 10, cell: (r) => ({ value: r.kind === "CLIENT" ? "Client" : "Internal" }) },
  { label: "Title", width: 24, cell: (r) => ({ value: r.title }) },
  { label: "Employment", width: 16, cell: (r) => ({ value: r.employment }) },
  // Nullable and deliberately last of the text columns: null means "never
  // synced", which is a real and common state, not a gap to be filled in.
  { label: "M365", width: 14, cell: (r) => ({ value: r.m365Status }) },
  { label: "Joined", width: 13, cell: (r) => ({ value: r.joinedAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Items held", width: 12, cell: (r) => ({ value: r.itemsHeld, type: Number }) },
];

/**
 * The farewell report, as a sheet. Row shape is `DecidedItem` from
 * `src/server/modules/offboarding/queries.ts` — the same rows the printable
 * report prints, via that module's `decidedItems`, never re-derived here.
 *
 * `Request` and `Status` are the two facts the printed page's own "Request"
 * column shows (`refNo` and `state`), just as two cells instead of one.
 * `Reason` is the plan's "Note" column under its actual name, matching the
 * page's header.
 *
 * Phase 20 (spec §4.1): `Decision` now carries `decidedBy`/`decidedAt` (the
 * approval's claimer and resolved time), so the "Decided by" / "Decided on"
 * columns this sheet's own comment used to say could not exist here now can
 * — added after "Status", the same order the printable report and the
 * wizard rows carry them in.
 */
/** Phase 18 (plan P-4): the supplier sheet shape — the import template, and what make.ts writes fixtures with. */
export const SUPPLIER_EXPORT_COLUMNS: XlsxColumn<{
  name: string; registeredName: string | null; category: string | null; contactPerson: string | null; phone: string | null;
  email: string | null; address: string | null; registrationNo: string | null; contractStatus: string;
  contractStart: Date | null; contractEnd: Date | null; notes: string | null;
}>[] = [
  { label: "Name", width: 26, cell: (r) => ({ value: r.name }) },
  { label: "Registered name", width: 30, cell: (r) => ({ value: r.registeredName }) },
  { label: "Category", width: 18, cell: (r) => ({ value: r.category }) },
  { label: "Contact person", width: 22, cell: (r) => ({ value: r.contactPerson }) },
  { label: "Phone", width: 18, cell: (r) => ({ value: r.phone }) },
  { label: "Email", width: 26, cell: (r) => ({ value: r.email }) },
  { label: "Address", width: 36, cell: (r) => ({ value: r.address }) },
  { label: "Registration no", width: 18, cell: (r) => ({ value: r.registrationNo }) },
  { label: "Contract status", width: 16, cell: (r) => ({ value: r.contractStatus }) },
  { label: "Contract start", width: 14, cell: (r) => ({ value: r.contractStart, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Contract end", width: 14, cell: (r) => ({ value: r.contractEnd, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Notes", width: 40, cell: (r) => ({ value: r.notes }) },
];

/**
 * Phase 19 Task 6 (plan P-2): the stock IMPORT template — what `make.ts`
 * writes the import fixtures with, and what an operator downloads to fill
 * in. Deliberately a SEPARATE spec from `STOCK_EXPORT_COLUMNS` below (the
 * balances export): that sheet carries `balance`/`low`/`lastMovementAt`,
 * none of which is a writable field, while this one carries `code` (blank to
 * assign) and `openingQty`, neither of which the balances export has any use
 * for. M-2 correction: "Unit cost" IS matched by `STOCK_IMPORT_HEADERS`
 * (`import-stock.ts`, since D-11) — recognised, never reported as an
 * unrecognised column — but its value is accepted and then consumed by
 * nothing on write (spec §6: unit cost is recorded on receipts, not opening
 * stock). Because it's matched, it never reaches `matchHeaders`'s `unknown`
 * array in the first place, so `import-columns.ts`'s
 * `STOCK_KNOWN_UNIMPORTED_COLUMNS` has nothing to excuse — it stays `[]`.
 */
export const STOCK_IMPORT_TEMPLATE_COLUMNS: XlsxColumn<{
  code: string | null; name: string; category: string; unit: string; packSize: number | null;
  reorderLevel: number; openingQty: number; unitCost: number | null; notes: string | null;
}>[] = [
  { label: "Code", width: 12, cell: (r) => ({ value: r.code }) },
  { label: "Name", width: 30, cell: (r) => ({ value: r.name }) },
  { label: "Category", width: 20, cell: (r) => ({ value: r.category }) },
  { label: "Unit", width: 10, cell: (r) => ({ value: r.unit }) },
  { label: "Pack size", width: 10, cell: (r) => ({ value: r.packSize, type: Number }) },
  { label: "Reorder level", width: 12, cell: (r) => ({ value: r.reorderLevel, type: Number }) },
  { label: "Opening quantity", width: 14, cell: (r) => ({ value: r.openingQty, type: Number }) },
  { label: "Unit cost", width: 12, cell: (r) => ({ value: r.unitCost, type: Number, format: "#,##0.00" }) },
  { label: "Notes", width: 40, cell: (r) => ({ value: r.notes }) },
];

/** Phase 19 (spec §5.4): the stock balances export — same columns the `/stock` list shows. */
export const STOCK_EXPORT_COLUMNS: XlsxColumn<{
  code: string; name: string; category: string; unit: string; packSize: number | null; reorderLevel: number;
  balance: number; low: string; lastMovementAt: Date | null;
}>[] = [
  { label: "Code", width: 12, cell: (r) => ({ value: r.code }) },
  { label: "Name", width: 30, cell: (r) => ({ value: r.name }) },
  { label: "Category", width: 20, cell: (r) => ({ value: r.category }) },
  { label: "Unit", width: 10, cell: (r) => ({ value: r.unit }) },
  { label: "Pack size", width: 10, cell: (r) => ({ value: r.packSize, type: Number }) },
  { label: "Reorder level", width: 12, cell: (r) => ({ value: r.reorderLevel, type: Number }) },
  { label: "Balance", width: 10, cell: (r) => ({ value: r.balance, type: Number }) },
  { label: "Low", width: 6, cell: (r) => ({ value: r.low }) },
  { label: "Last movement", width: 14, cell: (r) => ({ value: r.lastMovementAt, type: Date, format: "yyyy-mm-dd" }) },
];

/**
 * Phase 22 (spec §4.4): the `/stock/reports/on-hand` export — one row per
 * item, grouped by category on screen but flat here (the same "flatten the
 * grouped screen into one sheet" convention `CONSUMPTION_EXPORT_COLUMNS`
 * below follows too). `valueOnHand`/`oldestLot`/`nearestExpiry` are `null`
 * for an item with no open lots at all (never created a receipt, or
 * everything issued) — the money and date cell shapes both already treat
 * `null` as an empty cell, so no special-casing is needed here.
 */
export interface OnHandExportRow {
  code: string;
  name: string;
  category: string;
  unit: string;
  balance: number;
  openLots: number;
  costedUnits: number;
  uncostedUnits: number;
  valueOnHand: number | null;
  oldestLot: Date | null;
  nearestExpiry: Date | null;
}

export const ON_HAND_EXPORT_COLUMNS: XlsxColumn<OnHandExportRow>[] = [
  { label: "Code", width: 12, cell: (r) => ({ value: r.code }) },
  { label: "Name", width: 30, cell: (r) => ({ value: r.name }) },
  { label: "Category", width: 20, cell: (r) => ({ value: r.category }) },
  { label: "Unit", width: 10, cell: (r) => ({ value: r.unit }) },
  { label: "Balance", width: 10, cell: (r) => ({ value: r.balance, type: Number }) },
  { label: "Open lots", width: 10, cell: (r) => ({ value: r.openLots, type: Number }) },
  { label: "Costed units", width: 12, cell: (r) => ({ value: r.costedUnits, type: Number }) },
  { label: "Uncosted units", width: 14, cell: (r) => ({ value: r.uncostedUnits, type: Number }) },
  { label: "Value on hand", width: 14, cell: (r) => ({ value: r.valueOnHand, type: Number, format: "#,##0.00" }) },
  { label: "Oldest lot", width: 13, cell: (r) => ({ value: r.oldestLot, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Nearest expiry", width: 14, cell: (r) => ({ value: r.nearestExpiry, type: Date, format: "yyyy-mm-dd" }) },
];

/**
 * Phase 22 (spec §4.4): the `/stock/reports/consumption` export — the flat
 * sheet behind the on-screen department × month grid (spec §6.2), one row
 * per department × month × item so a pivot-minded reader can re-slice it
 * however they like; `month` is the `monthKey` string (`stock-reports.ts`),
 * not a `Date` — there is no single day a month-grain figure falls on.
 */
export interface ConsumptionExportRow {
  department: string;
  month: string;
  category: string;
  code: string;
  item: string;
  units: number;
  cost: number | null;
  uncostedUnits: number;
}

export const CONSUMPTION_EXPORT_COLUMNS: XlsxColumn<ConsumptionExportRow>[] = [
  { label: "Department", width: 20, cell: (r) => ({ value: r.department }) },
  { label: "Month", width: 10, cell: (r) => ({ value: r.month }) },
  { label: "Category", width: 18, cell: (r) => ({ value: r.category }) },
  { label: "Code", width: 12, cell: (r) => ({ value: r.code }) },
  { label: "Item", width: 28, cell: (r) => ({ value: r.item }) },
  { label: "Units", width: 10, cell: (r) => ({ value: r.units, type: Number }) },
  { label: "Cost", width: 13, cell: (r) => ({ value: r.cost, type: Number, format: "#,##0.00" }) },
  { label: "Uncosted units", width: 14, cell: (r) => ({ value: r.uncostedUnits, type: Number }) },
];

/**
 * Phase 22 (spec §4.4): the `/stock/reports/expiry` export — both tabs on
 * screen (Expired, Expiring within N days; Phase 39 pages each 50 at a time,
 * the export is not paged) flattened into one sheet, told apart by `status`
 * ("Expired" / "Expiring"), each in the screen's order (`compareByExpiry`). `days` is `expiryLabel`'s own
 * display string (`stock-allocation.ts`) — "expired 2 days ago" reads
 * better in a downloaded sheet than a bare signed integer, and the screen's
 * own "Days" column shows the same text (spec §6.3).
 */
export interface ExpiryExportRow {
  status: string;
  code: string;
  item: string;
  lotDate: Date;
  reference: string | null;
  supplier: string | null;
  expires: Date;
  days: string;
  remaining: number;
  unitCost: number | null;
  valueAtRisk: number | null;
}

export const EXPIRY_EXPORT_COLUMNS: XlsxColumn<ExpiryExportRow>[] = [
  { label: "Status", width: 12, cell: (r) => ({ value: r.status }) },
  { label: "Code", width: 12, cell: (r) => ({ value: r.code }) },
  { label: "Item", width: 28, cell: (r) => ({ value: r.item }) },
  { label: "Lot date", width: 13, cell: (r) => ({ value: r.lotDate, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Reference", width: 16, cell: (r) => ({ value: r.reference }) },
  { label: "Supplier", width: 20, cell: (r) => ({ value: r.supplier }) },
  { label: "Expires", width: 13, cell: (r) => ({ value: r.expires, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Days", width: 20, cell: (r) => ({ value: r.days }) },
  { label: "Remaining", width: 10, cell: (r) => ({ value: r.remaining, type: Number }) },
  { label: "Unit cost", width: 12, cell: (r) => ({ value: r.unitCost, type: Number, format: "#,##0.00" }) },
  { label: "Value at risk", width: 14, cell: (r) => ({ value: r.valueAtRisk, type: Number, format: "#,##0.00" }) },
];

export const FAREWELL_EXPORT_COLUMNS: XlsxColumn<{
  tag: string; model: string; outcome: string | null; reason: string | null;
  cost: number | null; refNo: string | null; state: string | null;
  decidedBy: string | null; decidedAt: Date | null;
}>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: r.model }) },
  { label: "Outcome", width: 16, cell: (r) => ({ value: r.outcome }) },
  { label: "Reason", width: 30, cell: (r) => ({ value: r.reason }) },
  { label: "Value", width: 13, cell: (r) => ({ value: r.cost, type: Number, format: "#,##0.00" }) },
  { label: "Request", width: 16, cell: (r) => ({ value: r.refNo }) },
  { label: "Status", width: 16, cell: (r) => ({ value: r.state }) },
  { label: "Decided by", width: 20, cell: (r) => ({ value: r.decidedBy }) },
  { label: "Decided on", width: 14, cell: (r) => ({ value: r.decidedAt, type: Date, format: "yyyy-mm-dd" }) },
];

/**
 * Phase 20 (spec §5, plan P-3): the `/employees/[id]/holdings` export — one
 * sheet, two blocks. `section` is the discriminator every cell checks:
 * `"asset"` and `"reservation"` rows carry their own real values, while
 * `"blank"` (the spacer row between blocks) and `"header"` (the
 * "Reservations" row that opens the second block) render every column empty
 * except the header row's own first cell. This keeps one `XlsxColumn` spec
 * for what is, on the page, two differently-shaped tables — the route
 * (Task 5/P-3) builds the reservation rows with `type`/`status`/`loanDue`
 * already blank, so this spec only needs to special-case the spacer and
 * header rows, never the two "real" row kinds against each other.
 */
export type HoldingsExportSection = "asset" | "reservation" | "blank" | "header";

export interface HoldingsExportRow {
  section: HoldingsExportSection;
  tag: string;
  model: string;
  type: string;
  status: string;
  /** "Held since" for an asset row, "Reserved on" for a reservation row — one column, two meanings by section. */
  since: Date | null;
  loanDue: Date | null;
}

const isHoldingsFillerRow = (r: HoldingsExportRow) => r.section === "blank" || r.section === "header";

export const HOLDINGS_EXPORT_COLUMNS: XlsxColumn<HoldingsExportRow>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.section === "header" ? "Reservations" : isHoldingsFillerRow(r) ? "" : r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: isHoldingsFillerRow(r) ? "" : r.model }) },
  { label: "Type", width: 18, cell: (r) => ({ value: isHoldingsFillerRow(r) ? "" : r.type }) },
  { label: "Status", width: 14, cell: (r) => ({ value: isHoldingsFillerRow(r) ? "" : r.status }) },
  {
    label: "Held since", width: 14,
    cell: (r) => (isHoldingsFillerRow(r) ? { value: "" } : { value: r.since, type: Date, format: "yyyy-mm-dd" }),
  },
  {
    label: "Loan due", width: 14,
    cell: (r) => (isHoldingsFillerRow(r) ? { value: "" } : { value: r.loanDue, type: Date, format: "yyyy-mm-dd" }),
  },
];

/** Phase 25 (spec §6.5): one row of the offboarding queue export. */
export interface OffboardingExportRow {
  employeeNo: string; name: string; department: string;
  started: Date | null; dueAt: Date | null; undecided: number; progress: "Open" | "Complete";
}

export const OFFBOARDING_EXPORT_COLUMNS: XlsxColumn<OffboardingExportRow>[] = [
  { label: "Employee no", width: 14, cell: (r) => ({ value: r.employeeNo }) },
  { label: "Name", width: 26, cell: (r) => ({ value: r.name }) },
  { label: "Department", width: 20, cell: (r) => ({ value: r.department }) },
  { label: "Started", width: 13, cell: (r) => ({ value: r.started, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Complete by", width: 13, cell: (r) => ({ value: r.dueAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Undecided", width: 11, cell: (r) => ({ value: r.undecided, type: Number }) },
  { label: "Progress", width: 11, cell: (r) => ({ value: r.progress }) },
];

/** Phase 35 (spec 4.1): Finance's register sheet. Money is a number cell (centavos / 100), never text. */
const peso = (c: number | null | undefined) =>
  ({ value: c === null || c === undefined ? null : c / 100, type: Number, format: "#,##0.00" }) as const;

export const FINANCE_ASSETS_EXPORT_COLUMNS: XlsxColumn<DepAssetRow>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: r.model }) },
  { label: "Category", width: 18, cell: (r) => ({ value: r.category }) },
  { label: "Class", width: 12, cell: (r) => ({ value: r.cls }) },
  { label: "Status", width: 14, cell: (r) => ({ value: r.status }) },
  { label: "Holder", width: 24, cell: (r) => ({ value: r.holder }) },
  { label: "Registration", width: 18, cell: (r) => ({ value: r.reg === "registered" && r.notCapitalised ? "Not capitalised" : REG_LABEL_FINANCE[r.reg] }) },
  { label: "Cost", width: 14, cell: (r) => peso(r.costC) },
  { label: "Confirmed on", width: 14, cell: (r) => ({ value: r.confirmedAt ? localDateISO(r.confirmedAt) : null }) },
  { label: "Starts", width: 16, cell: (r) => ({ value: r.result?.startMonth == null ? null : monthLabel(r.result.startMonth) }) },
  { label: "Life (months)", width: 13, cell: (r) => ({ value: r.result?.policy?.lifeMonths ?? null, type: Number, format: "0" }) },
  { label: "Salvage", width: 14, cell: (r) => peso(r.result?.policy?.salvage) },
  { label: "Monthly amount", width: 15, cell: (r) => peso(r.result?.monthly) },
  { label: "Depreciation to date", width: 20, cell: (r) => peso(r.result?.accumulated) },
  { label: "Book value", width: 14, cell: (r) => peso(r.result?.bookValue) },
  { label: "Basis", width: 11, cell: (r) => ({ value: r.result?.policy ? (r.custom ? "Custom" : "Category") : "" }) },
  { label: "Note", width: 40, cell: (r) => ({
    // a custom row shows its reason AND, when the override is wrong, the warning (final review M-5)
    value: r.custom ? [r.overrideNote, r.result?.state === "bad-salvage" ? r.note : null].filter(Boolean).join(" · ") : r.note,
  }) },
];

/** Phase 35 (plan P-11): one asset's money summary (label + figure in "Book value at end") over its month-by-month schedule. */
export const ASSET_SCHEDULE_EXPORT_COLUMNS: XlsxColumn<{
  label: string; opening: number | null; charge: number | null; closing: number | null; projected: string;
}>[] = [
  { label: "Month", width: 22, cell: (r) => ({ value: r.label }) },
  { label: "Book value at start", width: 20, cell: (r) => peso(r.opening) },
  { label: "Depreciation", width: 16, cell: (r) => peso(r.charge) },
  { label: "Book value at end", width: 20, cell: (r) => peso(r.closing) },
  { label: "Projected", width: 11, cell: (r) => ({ value: r.projected }) },
];

/** Phase 35 (spec §5.6): the year schedule. Subtotal and total rows carry an empty tag/model and a null cost. */
export interface ScheduleSheetRow { tag: string; model: string; category: string; costC: number | null; grid: YearRow }

const SCHEDULE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const SCHEDULE_EXPORT_COLUMNS: XlsxColumn<ScheduleSheetRow>[] = [
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: r.model }) },
  { label: "Category", width: 26, cell: (r) => ({ value: r.category }) },
  { label: "Cost", width: 14, cell: (r) => peso(r.costC) },
  { label: "Book value 1 Jan", width: 16, cell: (r) => peso(r.grid.opening) },
  ...SCHEDULE_MONTHS.map((m, i): XlsxColumn<ScheduleSheetRow> => ({
    label: m, width: 12, cell: (r) => peso(r.grid.months[i]),
  })),
  { label: "Year total", width: 14, cell: (r) => peso(r.grid.total) },
  { label: "Book value 31 Dec", width: 16, cell: (r) => peso(r.grid.closing) },
];

/**
 * Phase 38 (spec §3.5): one row per IT-class item held by a counted person. `costC` and `bookC` (centavos) exist only
 * when the export was built for a money role — for anyone else the rows never carry them and the two columns are absent.
 */
export interface EquipmentExportRow {
  worksFor: string; kind: "INTERNAL" | "CLIENT"; person: string; employeeNo: string;
  category: string; type: string | null; tag: string; model: string; serial: string | null; status: string;
  purchasedAt: Date | null; heldSince: Date | null; loanDueAt: Date | null;
  costC?: number | null; bookC?: number;
}

export const EQUIPMENT_EXPORT_COLUMNS: XlsxColumn<EquipmentExportRow>[] = [
  { label: "Works for", width: 22, cell: (r) => ({ value: r.worksFor }) },
  { label: "Staff", width: 10, cell: (r) => ({ value: r.kind === "CLIENT" ? "Client" : "Internal" }) },
  { label: "Person", width: 26, cell: (r) => ({ value: r.person }) },
  { label: "Employee no.", width: 14, cell: (r) => ({ value: r.employeeNo }) },
  { label: "Category", width: 18, cell: (r) => ({ value: r.category }) },
  { label: "Type", width: 18, cell: (r) => ({ value: r.type }) },
  { label: "Tag", width: 16, cell: (r) => ({ value: r.tag }) },
  { label: "Model", width: 28, cell: (r) => ({ value: r.model }) },
  { label: "Serial", width: 20, cell: (r) => ({ value: r.serial }) },
  { label: "Status", width: 14, cell: (r) => ({ value: r.status }) },
  { label: "Purchased", width: 13, cell: (r) => ({ value: r.purchasedAt, type: Date, format: "yyyy-mm-dd" }) },
  { label: "Held since", width: 13, cell: (r) => ({ value: r.heldSince, type: Date, format: "yyyy-mm-dd" }) },
  { label: "On loan until", width: 14, cell: (r) => ({ value: r.loanDueAt, type: Date, format: "yyyy-mm-dd" }) },
];

/** Appended for Finance and Admin only. An item with no cost is a blank Cost and a ₱0 Book value. */
export const EQUIPMENT_MONEY_COLUMNS: XlsxColumn<EquipmentExportRow>[] = [
  { label: "Cost", width: 13, cell: (r) => peso(r.costC) },
  { label: "Book value", width: 13, cell: (r) => peso(r.bookC) },
];

export const equipmentExportColumns = (withMoney: boolean): XlsxColumn<EquipmentExportRow>[] =>
  withMoney ? [...EQUIPMENT_EXPORT_COLUMNS, ...EQUIPMENT_MONEY_COLUMNS] : EQUIPMENT_EXPORT_COLUMNS;

/** `Bluepeak Telecom` -> `equipment-bluepeak-telecom`; the whole-report file is `equipment-by-client`. */
export function equipmentFilePrefix(groupName?: string): string {
  if (groupName === undefined) return "equipment-by-client";
  const slug = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `equipment-${slug || "group"}`;
}
