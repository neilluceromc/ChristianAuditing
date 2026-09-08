import { describe, expect, it } from "vitest";
import { matchHeaders } from "./import-assets";
import { refKey } from "./tag-key";
import {
  SUPPLIER_IMPORT_HEADERS, findBankColumns, planSupplierRows, supplierChanges, type SupplierRefs,
} from "./import-suppliers";

// The real 12-column export header (`SUPPLIER_EXPORT_COLUMNS`, export-columns.ts)
// — not a subset. The flagship workflow (re-uploading an unedited export)
// exercises every column at once.
const HEADER = [
  "Name", "Registered name", "Category", "Contact person", "Phone", "Email", "Address",
  "Registration no", "Contract status", "Contract start", "Contract end", "Notes",
];

const COL = {
  name: 0, registeredName: 1, category: 2, contactPerson: 3, phone: 4, email: 5, address: 6,
  registrationNo: 7, contractStatus: 8, contractStart: 9, contractEnd: 10, notes: 11,
};

/** A 12-cell row, blank by default, with the given columns filled in. */
function cells(over: Partial<Record<keyof typeof COL, unknown>>): unknown[] {
  const row: unknown[] = Array(HEADER.length).fill("");
  for (const [key, value] of Object.entries(over)) row[COL[key as keyof typeof COL]] = value;
  return row;
}

const REFS: SupplierRefs = {
  byName: new Map([
    [refKey("TechServe PH"), "v1"],
    [refKey("Twin Co"), null],
  ]),
};

describe("findBankColumns", () => {
  it("finds bank-shaped headers", () => {
    expect(findBankColumns(["Name", "Bank account", "IBAN", "Phone"])).toEqual(["Bank account", "IBAN"]);
  });

  it("does not match a word that merely contains 'bank' (word boundary)", () => {
    expect(findBankColumns(["Name", "Bankside Road"])).toEqual([]);
  });

  // Fix round 1, Important #1: the `#` alternative was dead — a trailing `\b`
  // cannot fire right after a non-word character at (or near) the end of a
  // string, so "Account #" (an extremely common real header) sailed straight
  // past the file-level bank refusal.
  it("catches 'Account #' and 'Account#', the realistic header the '#' branch exists for", () => {
    expect(findBankColumns(["Name", "Account #", "Phone"])).toEqual(["Account #"]);
    expect(findBankColumns(["Name", "Account#", "Phone"])).toEqual(["Account#"]);
  });

  it("does not match 'Accountant', which merely starts with 'account'", () => {
    expect(findBankColumns(["Name", "Accountant"])).toEqual([]);
  });

  it("still catches 'Bank account', 'IBAN', and 'Account no'", () => {
    expect(findBankColumns(["Bank account", "IBAN", "Account no"])).toEqual(["Bank account", "IBAN", "Account no"]);
  });
});

describe("matchHeaders(SUPPLIER_IMPORT_HEADERS)", () => {
  it("matches every accepted header alias", () => {
    const m = matchHeaders(
      ["supplier", "legal name", "contact", "telephone", "registration number", "contract", "expiry"],
      SUPPLIER_IMPORT_HEADERS,
    );
    expect(m.map.get("name")).toBe(0);
    expect(m.map.get("registeredName")).toBe(1);
    expect(m.map.get("contactPerson")).toBe(2);
    expect(m.map.get("phone")).toBe(3);
    expect(m.map.get("registrationNo")).toBe(4);
    expect(m.map.get("contractStatus")).toBe(5);
    expect(m.map.get("contractEnd")).toBe(6);
  });

  it("matches the real export header with no missing and no unknown columns", () => {
    const m = matchHeaders(HEADER, SUPPLIER_IMPORT_HEADERS);
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual([]);
  });
});

describe("planSupplierRows", () => {
  const headers = matchHeaders(HEADER, SUPPLIER_IMPORT_HEADERS);

  it("a new name creates, with blanks as null and contractStatus NONE", () => {
    const row = [cells({ name: "Harbor Logistics" })];
    const plan = planSupplierRows(headers, row, REFS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ kind: "create", row: 2 });
    const data = (plan.rows[0] as { data: Record<string, unknown> }).data;
    expect(data.registeredName).toBeNull();
    expect(data.category).toBeNull();
    expect(data.contactPerson).toBeNull();
    expect(data.phone).toBeNull();
    expect(data.email).toBeNull();
    expect(data.address).toBeNull();
    expect(data.registrationNo).toBeNull();
    expect(data.notes).toBeNull();
    expect(data.contractStatus).toBe("NONE");
    expect(data.contractStart).toBeNull();
    expect(data.contractEnd).toBeNull();
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 0 });
  });

  it("matches an existing name case-insensitively as an update carrying the vendor id", () => {
    const row = [cells({ name: "techserve ph", phone: "+63 2 8999 0000" })];
    const plan = planSupplierRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "update", vendorId: "v1" });
    expect(plan.counts).toEqual({ create: 0, update: 1, blocked: 0 });
  });

  describe("update patch shape", () => {
    // The reduced 3-column sheet `suppliers-mixed.xlsx` actually uses (Name,
    // Phone, Contract status) — the patch must carry ONLY those fields, never
    // the other nine the full export would, and a present-but-empty Phone
    // cell must write `null`, not be skipped.
    const reducedHeader = matchHeaders(["Name", "Phone", "Contract status"], SUPPLIER_IMPORT_HEADERS);
    function reducedCells(over: { name?: string; phone?: string; contractStatus?: string }): unknown[] {
      return [over.name ?? "", over.phone ?? "", over.contractStatus ?? ""];
    }

    it("carries only the fields whose column is present, and nulls a present-but-blank cell", () => {
      const row = [reducedCells({ name: "techserve ph", phone: "" })];
      const plan = planSupplierRows(reducedHeader, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "update", vendorId: "v1" });
      const patch = (plan.rows[0] as { data: Record<string, unknown> }).data;
      expect(Object.keys(patch).sort()).toEqual(["contractStatus", "phone"]);
      expect(patch.phone).toBeNull();
    });

    it("writes a present, non-blank phone cell straight through", () => {
      const row = [reducedCells({ name: "techserve ph", phone: "+63 2 8999 0000" })];
      const plan = planSupplierRows(reducedHeader, row, REFS);
      const patch = (plan.rows[0] as { data: Record<string, unknown> }).data;
      expect(patch.phone).toBe("+63 2 8999 0000");
    });
  });

  it("blocks BOTH rows sharing a name within the file (two-pass count, unlike the employee importer)", () => {
    const rows = [cells({ name: "Dup Co" }), cells({ name: "Dup Co" })];
    const plan = planSupplierRows(headers, rows, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file" });
    expect(plan.rows[1]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file" });
    expect(plan.counts).toEqual({ create: 0, update: 0, blocked: 2 });
  });

  // Fix round 1, Important #2: this cause used to be `duplicate-vendor-name`,
  // reused verbatim from the asset importer's own vendor-reference cause —
  // whose copy and "drop the vendor" fix are both false in this context
  // (the supplier's own `name` is required, not optional and droppable).
  // Supplier-import now gets its own cause with truthful copy.
  it("blocks a case-colliding supplier name as duplicate-supplier-name", () => {
    const row = [cells({ name: "Twin Co" })];
    const plan = planSupplierRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-supplier-name", detail: "Twin Co" });
  });

  describe("contract status", () => {
    it("blocks an unrecognised value as bad-contract-status", () => {
      const row = [cells({ name: "New Co", contractStatus: "sometimes" })];
      const plan = planSupplierRows(headers, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-contract-status", detail: "sometimes" });
    });

    it("accepts a lower-case value, upper-casing it", () => {
      const row = [cells({ name: "New Co", contractStatus: "active" })];
      const plan = planSupplierRows(headers, row, REFS);
      const data = (plan.rows[0] as { data: { contractStatus: string } }).data;
      expect(data.contractStatus).toBe("ACTIVE");
    });

    it("reads a blank cell as NONE on create", () => {
      const row = [cells({ name: "New Co" })];
      const plan = planSupplierRows(headers, row, REFS);
      const data = (plan.rows[0] as { data: { contractStatus: string } }).data;
      expect(data.contractStatus).toBe("NONE");
    });
  });

  describe("contract dates and email", () => {
    it("blocks an end date before the start as contract-dates-order", () => {
      const row = [cells({ name: "New Co", contractStart: "2026-06-01", contractEnd: "2026-01-01" })];
      const plan = planSupplierRows(headers, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "contract-dates-order" });
    });

    it("blocks an unparseable date as bad-date", () => {
      const row = [cells({ name: "New Co", contractStart: "2026-02-30" })];
      const plan = planSupplierRows(headers, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-date" });
    });

    it("blocks a non-address value in Email as bad-email", () => {
      const row = [cells({ name: "New Co", email: "not-an-email" })];
      const plan = planSupplierRows(headers, row, REFS);
      expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-email", detail: "not-an-email" });
    });
  });

  it("blocks a blank name as missing-required, detail Name", () => {
    // `name` blank but the row otherwise non-blank (a category cell) — a
    // wholly blank row is skipped entirely (rule 1), which is a different
    // outcome this test must not accidentally exercise instead.
    const row = [cells({ name: "", category: "IT hardware" })];
    const plan = planSupplierRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-required", detail: "Name" });
  });

  it("blocks a 121-character name as name-or-title-length", () => {
    const row = [cells({ name: "x".repeat(121) })];
    const plan = planSupplierRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "blocked", cause: "name-or-title-length" });
  });

  it("accepts a name at exactly the 120 character boundary", () => {
    const row = [cells({ name: "x".repeat(120) })];
    const plan = planSupplierRows(headers, row, REFS);
    expect(plan.rows[0]).toMatchObject({ kind: "create" });
  });

  it("skips a wholly blank row, counted nowhere", () => {
    const rows = [cells({}), cells({ name: "New Co" })];
    const plan = planSupplierRows(headers, rows, REFS);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].row).toBe(3);
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 0 });
  });

  it("keeps good rows even when other rows in the same file block", () => {
    const rows = [cells({ name: "New Co" }), cells({ name: "", category: "IT hardware" })];
    const plan = planSupplierRows(headers, rows, REFS);
    expect(plan.counts).toEqual({ create: 1, update: 0, blocked: 1 });
  });
});

describe("supplierChanges", () => {
  it("returns an empty diff and changed set when nothing differs", () => {
    const before = { phone: "111", contractStart: new Date("2026-01-01T00:00:00Z") };
    const patch = { phone: "111", contractStart: new Date("2026-01-01T00:00:00Z") };
    const { diff, changed } = supplierChanges(before, patch);
    expect(diff).toEqual({});
    expect(changed).toEqual({});
  });

  it("reports a changed phone in both diff and changed", () => {
    const before = { phone: "111" };
    const patch = { phone: "222" };
    const { diff, changed } = supplierChanges(before, patch);
    expect(diff.phone).toEqual({ from: "111", to: "222" });
    expect(changed.phone).toBe("222");
  });

  it("compares a Date by time, not object identity", () => {
    const before = { contractStart: new Date("2026-01-01T00:00:00.000Z") };
    const patch = { contractStart: new Date("2026-01-01T00:00:00.000Z") };
    const { diff, changed } = supplierChanges(before, patch);
    expect(diff).toEqual({});
    expect(changed).toEqual({});
  });

  it("still reports a genuinely different Date", () => {
    const before = { contractEnd: new Date("2026-01-01T00:00:00.000Z") };
    const patch = { contractEnd: new Date("2027-01-01T00:00:00.000Z") };
    const { diff, changed } = supplierChanges(before, patch);
    expect(diff.contractEnd).toEqual({ from: before.contractEnd, to: patch.contractEnd });
    expect(changed.contractEnd).toBe(patch.contractEnd);
  });
});
