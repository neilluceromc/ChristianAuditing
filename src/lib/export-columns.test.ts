import { describe, expect, it } from "vitest";
import {
  ASSET_EXPORT_COLUMNS, AUDIT_EXPORT_COLUMNS, EMPLOYEE_EXPORT_COLUMNS, EXPORT_CAP,
  FAREWELL_EXPORT_COLUMNS, IDS_CAP, capRefusalText, idsRefusalText,
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
  it("carries all fourteen columns, in this exact order", () => {
    expect(ASSET_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Tag",
      "Model",
      "Serial",
      "Category",
      "Type",
      "Status",
      "Assigned to",
      "Employee no",
      "Purchased",
      "Cost",
      "Warranty until",
      "Vendor",
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

// The plan for this sheet named "Decided by" and "Decided" columns. Neither
// exists: `Decision` (src/lib/offboarding.ts) carries only `refNo`, `outcome`,
// `state` and `reason` — no approver actor, no timestamp. Rather than invent
// them (the same mistake this plan already made twice, on the asset and
// employee specs), the sheet carries the two real fields the printed report
// shows in its "Request" column instead — see this task's commit for the
// full account.
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
    ]);
  });

  it("does not claim a 'Decided by' or 'Decided' column the underlying Decision has no data for", () => {
    const labels = FAREWELL_EXPORT_COLUMNS.map((c) => c.label);
    expect(labels.some((l) => /decided/i.test(l))).toBe(false);
  });
});
