import { describe, expect, it } from "vitest";
import {
  ASSET_EXPORT_COLUMNS, AUDIT_EXPORT_COLUMNS, CONSUMPTION_EXPORT_COLUMNS, EMPLOYEE_EXPORT_COLUMNS,
  EXPIRY_EXPORT_COLUMNS, EXPORT_CAP, FAREWELL_EXPORT_COLUMNS, HOLDINGS_EXPORT_COLUMNS, IDS_CAP,
  ON_HAND_EXPORT_COLUMNS, capRefusalText, idsRefusalText,
  type ConsumptionExportRow, type ExpiryExportRow, type HoldingsExportRow, type OnHandExportRow,
} from "./export-columns";

describe("export column specs", () => {
  it("gives every column a label and no duplicates — a repeated header breaks Excel's AutoFilter", () => {
    const labels = ASSET_EXPORT_COLUMNS.map((c) => c.label);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("names the tag first, because that is the column a human scans for", () => {
    expect(ASSET_EXPORT_COLUMNS[0].label).toBe("Tag");
  });

  // Pins the full shape — count, order and every label in one assertion — so
  // a dropped, renamed or reordered column fails the suite instead of only
  // being caught by diffing against the deleted CSV route by hand, which is
  // how "Employee no" and "RMA ref" going missing was actually found.
  it("carries all eighteen columns, in this exact order", () => {
    expect(ASSET_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Tag",
      "Model",
      "Brand",
      "Serial",
      "Category",
      "Type",
      "Status",
      "Assigned to",
      "Employee no",
      "Purchased",
      "Cost",
      "Warranty until",
      "Loan until",
      "Vendor",
      "Provenance",
      "Invoice / receipt no.",
      "RMA ref",
      "Notes",
    ]);
  });
});

describe("capRefusalText", () => {
  // The number is the ONE thing the operator needs and the one thing a
  // truncating export would never tell them (§6a rule 26 — one owner).
  it("states the actual count, the cap, and that nothing was exported", () => {
    const text = capRefusalText(12_403);
    expect(text).toContain("12403");
    expect(text).toContain(String(EXPORT_CAP));
    expect(text).toContain("Nothing was exported");
  });

  it("suggests the split that the UI actually offers", () => {
    expect(capRefusalText(20_000)).toContain("year");
  });
});

describe("idsRefusalText", () => {
  // Was a silent .slice(0, 500). A refusal has to read as a refusal.
  it("states the selection size and the cap, and does not read as the row-cap message", () => {
    const text = idsRefusalText(900);
    expect(text).toContain("900");
    expect(text).toContain(String(IDS_CAP));
    expect(text).not.toContain(String(EXPORT_CAP));
  });
});

describe("audit and employee column specs", () => {
  it("gives each sheet unique labels", () => {
    for (const spec of [AUDIT_EXPORT_COLUMNS, EMPLOYEE_EXPORT_COLUMNS]) {
      const labels = spec.map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  // The audit sheet must carry the resolved entity LABEL, not the raw id —
  // /audit renders labels and an export that regressed to cuids would be
  // useless for the thing exports are for (§6a rule 20's spirit).
  it("the audit sheet names an entity label column, not an id", () => {
    const labels = AUDIT_EXPORT_COLUMNS.map((c) => c.label);
    expect(labels).toContain("Entity");
    expect(labels.some((l) => /id/i.test(l))).toBe(false);
  });

  // Checked against prisma/schema.prisma's Employee — no email column exists,
  // so an Email header here would name a column nothing could ever fill.
  it("the employee sheet does not claim an email column that the schema has no data for", () => {
    const labels = EMPLOYEE_EXPORT_COLUMNS.map((c) => c.label);
    expect(labels.some((l) => /email/i.test(l))).toBe(false);
  });
});

// Phase 20 (spec §4.1): `Decision` now carries `decidedBy`/`decidedAt`, so
// this sheet gains the two columns naming who decided and when.
describe("farewell column spec", () => {
  it("gives every column a label and no duplicates", () => {
    const labels = FAREWELL_EXPORT_COLUMNS.map((c) => c.label);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("pins the full ordered label list, so a dropped or invented column fails loudly", () => {
    expect(FAREWELL_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Tag",
      "Model",
      "Outcome",
      "Reason",
      "Value",
      "Request",
      "Status",
      "Decided by",
      "Decided on",
    ]);
  });

  it("renders the decider's name and resolved date after Status", () => {
    const row = {
      tag: "BR-LT-0001", model: "Latitude", outcome: "Returned", reason: null, cost: 55_000,
      refNo: "APR-2100", state: "EXECUTED", decidedBy: "A. Reyes", decidedAt: new Date("2026-08-01T00:00:00Z"),
    };
    const values = FAREWELL_EXPORT_COLUMNS.map((c) => c.cell(row).value);
    expect(values[7]).toBe("A. Reyes");
    expect(values[8]).toEqual(row.decidedAt);
  });

  it("renders both as empty for a still-PENDING (undecided) item", () => {
    const row = {
      tag: "BR-LT-0001", model: "Latitude", outcome: "Returned", reason: null, cost: null,
      refNo: "APR-2100", state: "PENDING", decidedBy: null, decidedAt: null,
    };
    const values = FAREWELL_EXPORT_COLUMNS.map((c) => c.cell(row).value);
    expect(values[7]).toBeNull();
    expect(values[8]).toBeNull();
  });
});

describe("holdings export column spec (Phase 20 spec §5, plan P-3)", () => {
  const row = (section: HoldingsExportRow["section"], over: Partial<HoldingsExportRow> = {}): HoldingsExportRow => ({
    section, tag: "BR-LT-0001", model: "Latitude", type: "Laptop", status: "DEPLOYED",
    since: new Date("2026-01-01T00:00:00Z"), loanDue: null, ...over,
  });
  const values = (r: HoldingsExportRow) => HOLDINGS_EXPORT_COLUMNS.map((c) => c.cell(r).value);

  it("gives every column a label and no duplicates", () => {
    const labels = HOLDINGS_EXPORT_COLUMNS.map((c) => c.label);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("renders an asset row's real values", () => {
    const r = row("asset");
    expect(values(r)).toEqual(["BR-LT-0001", "Latitude", "Laptop", "DEPLOYED", r.since, null]);
  });

  it("renders a blank row as empty across every column", () => {
    expect(values(row("blank"))).toEqual(["", "", "", "", "", ""]);
  });

  it("renders the header row with 'Reservations' in the first column only, blank elsewhere", () => {
    const cells = values(row("header"));
    expect(cells[0]).toBe("Reservations");
    expect(cells.slice(1)).toEqual(["", "", "", "", ""]);
  });

  it("renders a reservation row's tag, model and reserved-on date, with no type/status/loan due", () => {
    const r = row("reservation", { type: "", status: "", loanDue: null, since: new Date("2026-02-01T00:00:00Z") });
    expect(values(r)).toEqual(["BR-LT-0001", "Latitude", "", "", r.since, null]);
  });
});

describe("ON_HAND_EXPORT_COLUMNS (Phase 22 spec §4.4)", () => {
  it("carries the eleven columns in this exact order", () => {
    expect(ON_HAND_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Code", "Name", "Category", "Unit", "Balance", "Open lots", "Costed units", "Uncosted units",
      "Value on hand", "Oldest lot", "Nearest expiry",
    ]);
  });

  it("renders a row's real values, money and date cells shaped like every other sheet's", () => {
    const row: OnHandExportRow = {
      code: "OS-0003", name: "Sticky pad", category: "Office supplies", unit: "pad", balance: 24,
      openLots: 1, costedUnits: 0, uncostedUnits: 24, valueOnHand: 0,
      oldestLot: new Date("2026-09-07T00:00:00Z"), nearestExpiry: null,
    };
    const cells = ON_HAND_EXPORT_COLUMNS.map((c) => c.cell(row));
    expect(cells.map((c) => c.value)).toEqual([
      "OS-0003", "Sticky pad", "Office supplies", "pad", 24, 1, 0, 24, 0, row.oldestLot, null,
    ]);
    const valueCell = cells[8];
    expect(valueCell.type).toBe(Number);
    expect(valueCell.format).toBe("#,##0.00");
    const oldestLotCell = cells[9];
    expect(oldestLotCell.type).toBe(Date);
    expect(oldestLotCell.format).toBe("yyyy-mm-dd");
  });

  it("renders null for an item with no open lots at all", () => {
    const row: OnHandExportRow = {
      code: "OS-0009", name: "New item", category: "Office supplies", unit: "piece", balance: 0,
      openLots: 0, costedUnits: 0, uncostedUnits: 0, valueOnHand: null, oldestLot: null, nearestExpiry: null,
    };
    const values = ON_HAND_EXPORT_COLUMNS.map((c) => c.cell(row).value);
    expect(values.slice(-3)).toEqual([null, null, null]);
  });
});

describe("CONSUMPTION_EXPORT_COLUMNS (Phase 22 spec §4.4)", () => {
  it("carries the eight columns in this exact order", () => {
    expect(CONSUMPTION_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Department", "Month", "Category", "Code", "Item", "Units", "Cost", "Uncosted units",
    ]);
  });

  it("renders a row's real values, month as the plain monthKey string, not a Date", () => {
    const row: ConsumptionExportRow = {
      department: "HR", month: "2026-08", category: "Pantry", code: "PN-0001", item: "Sugar sachet",
      units: 60, cost: 54, uncostedUnits: 0,
    };
    const cells = CONSUMPTION_EXPORT_COLUMNS.map((c) => c.cell(row));
    expect(cells.map((c) => c.value)).toEqual(["HR", "2026-08", "Pantry", "PN-0001", "Sugar sachet", 60, 54, 0]);
    expect(typeof cells[1].value).toBe("string");
    const costCell = cells[6];
    expect(costCell.type).toBe(Number);
    expect(costCell.format).toBe("#,##0.00");
  });

  it("renders a null cost for a fully-uncosted row", () => {
    const row: ConsumptionExportRow = {
      department: "HR", month: "2026-08", category: "Pantry", code: "PN-0002", item: "Something",
      units: 6, cost: null, uncostedUnits: 6,
    };
    expect(CONSUMPTION_EXPORT_COLUMNS.find((c) => c.label === "Cost")!.cell(row).value).toBeNull();
  });
});

describe("EXPIRY_EXPORT_COLUMNS (Phase 22 spec §4.4)", () => {
  it("carries the eleven columns in this exact order", () => {
    expect(EXPIRY_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Status", "Code", "Item", "Lot date", "Reference", "Supplier", "Expires", "Days", "Remaining",
      "Unit cost", "Value at risk",
    ]);
  });

  it("renders a row's real values, Days as expiryLabel's own display string", () => {
    const row: ExpiryExportRow = {
      status: "Expired", code: "PN-0003", item: "Sugar sachet", lotDate: new Date("2026-08-27T00:00:00Z"),
      reference: "DR-1103", supplier: "Acme Trading", expires: new Date("2026-09-11T00:00:00Z"),
      days: "expired 5 days ago", remaining: 100, unitCost: 0.9, valueAtRisk: 90,
    };
    const cells = EXPIRY_EXPORT_COLUMNS.map((c) => c.cell(row));
    expect(cells.map((c) => c.value)).toEqual([
      "Expired", "PN-0003", "Sugar sachet", row.lotDate, "DR-1103", "Acme Trading", row.expires,
      "expired 5 days ago", 100, 0.9, 90,
    ]);
    const unitCostCell = cells[9];
    expect(unitCostCell.type).toBe(Number);
    expect(unitCostCell.format).toBe("#,##0.00");
  });

  it("renders null reference/supplier/unit cost/value at risk when unset", () => {
    const row: ExpiryExportRow = {
      status: "Expiring", code: "OS-0003", item: "Sticky pad", lotDate: new Date("2026-09-07T00:00:00Z"),
      reference: null, supplier: null, expires: new Date("2026-10-01T00:00:00Z"), days: "expires in 15 days",
      remaining: 24, unitCost: null, valueAtRisk: null,
    };
    const values = EXPIRY_EXPORT_COLUMNS.map((c) => c.cell(row).value);
    expect(values[4]).toBeNull();
    expect(values[5]).toBeNull();
    expect(values[9]).toBeNull();
    expect(values[10]).toBeNull();
  });
});
