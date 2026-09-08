import type { VendorContractStatus } from "@prisma/client";
import { VENDOR_CONTRACT_STATUSES } from "./supplier-schema";
import { cellText, parseDateCell, refKey, type HeaderMatch } from "./import-assets";
import { isBlank } from "./tag-key";
import type { AuditDiff } from "./audit-diff";
import type { BlockCause, BlockedRow } from "./import-vocabulary";

/**
 * The supplier importer's own header spec (Phase 18 Task 5). Mirrors
 * `EMPLOYEE_IMPORT_HEADERS`'s shape (`import-employees.ts`) — handed to the
 * same generic `matchHeaders` (`import-assets.ts`), not a second copy of the
 * matching loop.
 *
 * `name` is the only required column: a supplier sheet otherwise round-trips
 * this app's own optional-everything `Vendor` shape (`supplier-schema.ts`'s
 * `supplierSchema` has no other required field either).
 */
export const SUPPLIER_IMPORT_HEADERS = [
  { key: "name", labels: ["name", "supplier", "supplier name", "vendor", "company"], required: true, title: "Name" },
  { key: "registeredName", labels: ["registered name", "legal name"], required: false, title: "Registered name" },
  { key: "category", labels: ["category"], required: false, title: "Category" },
  { key: "contactPerson", labels: ["contact person", "contact"], required: false, title: "Contact person" },
  { key: "phone", labels: ["phone", "telephone", "mobile"], required: false, title: "Phone" },
  { key: "email", labels: ["email", "e-mail"], required: false, title: "Email" },
  { key: "address", labels: ["address"], required: false, title: "Address" },
  { key: "registrationNo", labels: ["registration no", "registration number", "reg no", "tin"], required: false, title: "Registration no" },
  { key: "contractStatus", labels: ["contract status", "contract"], required: false, title: "Contract status" },
  { key: "contractStart", labels: ["contract start", "start date"], required: false, title: "Contract start" },
  { key: "contractEnd", labels: ["contract end", "end date", "expiry"], required: false, title: "Contract end" },
  { key: "notes", labels: ["notes"], required: false, title: "Notes" },
] as const;

export type SupplierField = (typeof SUPPLIER_IMPORT_HEADERS)[number]["key"];

/**
 * P-3: the bank-column refusal is FILE-level (a `conflict`, in
 * `supplier-actions.ts`), never a row cause — bank details are entered on
 * the supplier's own page, never imported, so a sheet carrying one is wrong
 * in its entirety rather than row by row. Word-boundary matched so a column
 * merely containing the letters ("Bankside Road") is not mistaken for one.
 */
export const BANK_HEADER = /\b(bank|iban|account\s*(no|number|#))\b/i;

export function findBankColumns(header: unknown[]): string[] {
  return header.map(cellText).filter((h) => BANK_HEADER.test(h));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `name`'s ceiling matches `supplierSchema`'s own `.max(120)` — the create
 * schema this importer's validation stands in for. */
const LENGTH_LIMITS = { name: 120 } as const;

/**
 * Reference data, pre-resolved by the server (`resolveSupplierRefs`,
 * `server/modules/import/resolve.ts`). Name-keyed via `refKey`, `null`
 * meaning the key matched MORE THAN ONE vendor — the same R-1 case-collision
 * guard categories/types/vendors/departments already have (`Vendor.name` is
 * `@unique`, but Postgres's index is case-sensitive and nothing upper- or
 * lower-cases it on the way in).
 */
export interface SupplierRefs {
  byName: Map<string, string | null>;
}

export interface SupplierCreateData {
  name: string;
  registeredName: string | null;
  category: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  registrationNo: string | null;
  contractStatus: VendorContractStatus;
  contractStart: Date | null;
  contractEnd: Date | null;
  notes: string | null;
}

/**
 * No `name` (identity, never editable via an update row — the same E-1
 * convention `EmployeeUpdatePatch` follows for `employeeNo`). Every other
 * field is optional here, and deliberately so: unlike the employee importer
 * (every required column is required on every row), a supplier update row
 * carries a patch of ONLY the columns present in THIS sheet — a reduced
 * export (say, just Name/Phone/Contract status) must not blank out every
 * other field the full export would have carried.
 */
export type SupplierUpdatePatch = Partial<Omit<SupplierCreateData, "name">>;

export type SupplierRowVerdict =
  | { kind: "create"; row: number; data: SupplierCreateData }
  | { kind: "update"; row: number; vendorId: string; data: SupplierUpdatePatch }
  | ({ kind: "blocked" } & BlockedRow);

export interface SupplierPlan {
  rows: SupplierRowVerdict[];
  counts: { create: number; update: number; blocked: number };
}

/** Every text field of `SupplierCreateData` besides `name` (identity) and
 * the three fields (`contractStatus`/`contractStart`/`contractEnd`) that
 * need their own parsing rather than a plain blank-to-null read. */
const TEXT_FIELDS = [
  "registeredName", "category", "contactPerson", "phone", "email", "address", "registrationNo", "notes",
] as const satisfies readonly SupplierField[];

function cellAt(headers: HeaderMatch<SupplierField>, cells: unknown[], field: SupplierField): unknown {
  const index = headers.map.get(field);
  return index === undefined ? undefined : cells[index];
}

function textAt(headers: HeaderMatch<SupplierField>, cells: unknown[], field: SupplierField): string {
  return cellText(cellAt(headers, cells, field));
}

/** A blank cell — or a column the sheet doesn't even carry — both read as
 * `null`, the same "absent behaves like blank" rule the contract-status and
 * date parsing below get for free from `cellText`/`parseDateCell`. */
function textOrNull(headers: HeaderMatch<SupplierField>, cells: unknown[], field: SupplierField): string | null {
  const t = textAt(headers, cells, field);
  return t === "" ? null : t;
}

/**
 * The per-row rules (Phase 18 Task 5). First failing check wins: exactly one
 * cause per row, the same discipline `planEmployeeRows`/`planAssetRows`
 * follow.
 *
 * Two passes, deliberately UNLIKE the employee importer's single-pass
 * seen-set: a name claimed by more than one row of this file blocks BOTH
 * rows, not just the second one to appear — the file itself is ambiguous
 * about which one the operator meant, and keeping "the first" would guess.
 */
export function planSupplierRows(
  headers: HeaderMatch<SupplierField>,
  cells: unknown[][],
  refs: SupplierRefs,
): SupplierPlan {
  const rows: SupplierRowVerdict[] = [];
  const counts = { create: 0, update: 0, blocked: 0 };

  // Pass 1: count refKey(name) over every non-wholly-blank row.
  const keyCounts = new Map<string, number>();
  for (const raw of cells) {
    if (raw.every(isBlank)) continue;
    const key = refKey(textAt(headers, raw, "name"));
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  const present = (field: SupplierField) => headers.map.has(field);

  cells.forEach((raw, i) => {
    const sheetRow = i + 2; // header is row 1

    // Rule 1: a wholly blank row is skipped entirely, not blocked.
    if (raw.every(isBlank)) return;

    const block = (cause: BlockCause, detail: string) => {
      rows.push({ kind: "blocked", row: sheetRow, cause, detail });
      counts.blocked += 1;
    };

    const nameRaw = textAt(headers, raw, "name");

    // Rule 2: the one required column.
    if (nameRaw === "") {
      block("missing-required", "Name");
      return;
    }

    // Rule 3: the ceiling `supplierSchema` enforces — `.max(120)`, with no
    // separate minimum beyond "non-blank" (already checked above).
    if (nameRaw.length > LENGTH_LIMITS.name) {
      block("name-or-title-length", nameRaw);
      return;
    }

    // Rule 4 (two-pass, this file): a name claimed by more than one row here
    // blocks BOTH, before either is allowed to resolve against the database.
    const key = refKey(nameRaw);
    if ((keyCounts.get(key) ?? 0) > 1) {
      block("duplicate-in-file", nameRaw);
      return;
    }

    // Rule 5 (R-1): two stored vendors whose names differ only by case —
    // undecidable, so this blocks rather than guessing.
    const existing = refs.byName.get(key);
    if (existing === null) {
      block("duplicate-vendor-name", nameRaw);
      return;
    }

    // Rule 6: contract status — blank (or absent) reads as NONE, anything
    // else must be one of the four, upper-cased.
    const statusRaw = textAt(headers, raw, "contractStatus");
    let contractStatus: VendorContractStatus = "NONE";
    if (statusRaw !== "") {
      const upper = statusRaw.toUpperCase();
      const match = (VENDOR_CONTRACT_STATUSES as readonly string[]).find((s) => s === upper);
      if (!match) {
        block("bad-contract-status", statusRaw);
        return;
      }
      contractStatus = match as VendorContractStatus;
    }

    // Rule 7: the two date columns, sharing `parseDateCell` with every other
    // date column in this app (E-9's UTC-midnight convention, measured
    // against `readSheet`) rather than a third independently-reasoned rule.
    const startResult = parseDateCell(cellAt(headers, raw, "contractStart"));
    if (!startResult.ok) {
      block("bad-date", startResult.raw);
      return;
    }
    const endResult = parseDateCell(cellAt(headers, raw, "contractEnd"));
    if (!endResult.ok) {
      block("bad-date", endResult.raw);
      return;
    }
    const contractStart = startResult.value;
    const contractEnd = endResult.value;

    // Rule 8: both present and the end predates the start — one of the two
    // is wrong, and this importer can't tell which.
    if (contractStart && contractEnd && contractEnd.getTime() < contractStart.getTime()) {
      block("contract-dates-order", `${textAt(headers, raw, "contractStart")} → ${textAt(headers, raw, "contractEnd")}`);
      return;
    }

    // Rule 9: Email, non-blank, must look like an address.
    const emailRaw = textAt(headers, raw, "email");
    if (emailRaw !== "" && !EMAIL.test(emailRaw)) {
      block("bad-email", emailRaw);
      return;
    }

    if (typeof existing === "string") {
      // UPDATE: the patch carries ONLY the columns this sheet has — a
      // reduced export must not blank out fields it never mentioned.
      const patch: SupplierUpdatePatch = {};
      for (const field of TEXT_FIELDS) {
        if (present(field)) patch[field] = textOrNull(headers, raw, field);
      }
      if (present("contractStatus")) patch.contractStatus = contractStatus;
      if (present("contractStart")) patch.contractStart = contractStart;
      if (present("contractEnd")) patch.contractEnd = contractEnd;
      rows.push({ kind: "update", row: sheetRow, vendorId: existing, data: patch });
      counts.update += 1;
    } else {
      // CREATE: every field is written, an absent column reading exactly
      // like a blank one already (both `textOrNull` and `parseDateCell`
      // treat "no cell" and "blank cell" identically).
      const data: SupplierCreateData = {
        name: nameRaw,
        registeredName: textOrNull(headers, raw, "registeredName"),
        category: textOrNull(headers, raw, "category"),
        contactPerson: textOrNull(headers, raw, "contactPerson"),
        phone: textOrNull(headers, raw, "phone"),
        email: textOrNull(headers, raw, "email"),
        address: textOrNull(headers, raw, "address"),
        registrationNo: textOrNull(headers, raw, "registrationNo"),
        contractStatus,
        contractStart,
        contractEnd,
        notes: textOrNull(headers, raw, "notes"),
      };
      rows.push({ kind: "create", row: sheetRow, data });
      counts.create += 1;
    }
  });

  return { rows, counts };
}

/**
 * The update-write's comparison-and-write-set function — mirroring
 * `employeeDiff`'s shape (`src/lib/employee-diff.ts`), but over the PATCH's
 * own keys rather than every key of `after`: `SupplierUpdatePatch` is
 * already narrowed to the columns this sheet carries, so there is nothing
 * further to filter down to.
 *
 * No day-precision truncation (unlike `employeeDiff`'s `toDay`): a Date
 * compared by `.getTime()` is enough here because both sides of every
 * comparison this importer ever makes trace back to the same UTC-midnight
 * convention — `parseDateCell` on the sheet side, `toSupplierData`'s
 * `T00:00:00Z` construction (`supplier-schema.ts`) on the database side —
 * so there is no whole-time-of-day artefact (like `prisma/seed.ts`'s
 * un-truncated `day()`) to normalise away here the way `joinedAt` needs.
 */
export function supplierChanges(
  before: Record<string, unknown>,
  patch: SupplierUpdatePatch,
): { diff: AuditDiff; changed: SupplierUpdatePatch } {
  const diff: AuditDiff = {};
  const changedEntries: [string, unknown][] = [];
  for (const [key, b] of Object.entries(patch)) {
    const a = before[key];
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) {
      diff[key] = { from: a, to: b };
      changedEntries.push([key, b]);
    }
  }
  return { diff, changed: Object.fromEntries(changedEntries) as SupplierUpdatePatch };
}
