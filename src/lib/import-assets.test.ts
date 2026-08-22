import { describe, expect, it } from "vitest";
import { matchHeaders, planAssetRows, type AssetRefs, type ImportOptions } from "./import-assets";

// The real 14-column export header (`ASSET_EXPORT_COLUMNS`, export-columns.ts)
// — not a 9-column subset. Task 7 shipped with a 9-column test fixture that
// left Vendor, Warranty until and Notes entirely untested: deleting the whole
// vendor block, never parsing warrantyUntil, and nulling notes/model all left
// the old suite 19/19 green. Using the real header also exercises the round
// trip the feature exists for (export, edit, re-import).
const HEADER = [
  "Tag", "Model", "Serial", "Category", "Type", "Status", "Assigned to", "Employee no",
  "Purchased", "Cost", "Warranty until", "Vendor", "RMA ref", "Notes",
];

const COL = {
  tag: 0, model: 1, serial: 2, category: 3, type: 4, status: 5, assignedTo: 6, employeeNo: 7,
  purchased: 8, cost: 9, warranty: 10, vendor: 11, rmaRef: 12, notes: 13,
};

/** A 14-cell row, blank by default, with the given columns filled in. */
function cells(over: Partial<Record<keyof typeof COL, unknown>>): unknown[] {
  const row: unknown[] = Array(HEADER.length).fill("");
  for (const [key, value] of Object.entries(over)) row[COL[key as keyof typeof COL]] = value;
  return row;
}

const REFS: AssetRefs = {
  categories: new Map([["laptops", "cat-1"], ["furniture", "cat-2"]]),
  // Composite key: `${categoryId}:${name}` — two categories each have a type
  // named differently on purpose, plus a same-named trap ("standard") under
  // both, to prove a flat name key would be lossy.
  types: new Map([
    ["cat-1:macbook pro", { id: "typ-1", categoryId: "cat-1" }],
    ["cat-1:standard", { id: "typ-3", categoryId: "cat-1" }],
    ["cat-2:ergo chair", { id: "typ-2", categoryId: "cat-2" }],
    ["cat-2:standard", { id: "typ-4", categoryId: "cat-2" }],
  ]),
  employees: new Map([
    ["emp-0042", { id: "e-1", employment: "ACTIVE", ambiguous: false }],
    ["marites bautista", { id: "e-1", employment: "ACTIVE", ambiguous: false }],
    ["emp-0099", { id: "e-2", employment: "OFFBOARDED", ambiguous: false }],
    ["inactive ida", { id: "e-2", employment: "OFFBOARDED", ambiguous: false }],
    ["juan dela cruz", { id: "e-3", employment: "ACTIVE", ambiguous: true }],
  ]),
  vendors: new Map([["acme", "v-1"]]),
  byTag: new Map([
    ["BR-LT-0148", { id: "a-1", serial: "SN-OLD", status: "SPARE", assigneeId: null }],
    ["BR-LT-0200", { id: "a-2", serial: null, status: "DEPLOYED", assigneeId: "e-1" }],
  ]),
  bySerial: new Map([
    ["SN-TAKEN", { id: "a-9", status: "SPARE", assigneeId: null }],
    ["SN-OLD", { id: "a-1", status: "SPARE", assigneeId: null }],
  ]),
};

const OPTS: ImportOptions = {
  treatDuplicateSerialAsUpdate: false,
  dropUnknownAssignee: false,
  dropUnknownVendor: false,
  keepCurrentLifecycle: false,
};

describe("matchHeaders", () => {
  it("matches case- and space-insensitively, so '  asset tag ' still maps", () => {
    const m = matchHeaders(["  asset tag ", "MODEL"]);
    expect(m.map.get("tag")).toBe(0);
    expect(m.map.get("model")).toBe(1);
  });

  it("names every missing required header at once, not just the first", () => {
    const m = matchHeaders(["Tag"]);
    expect(m.missing).toContain("Model");
    expect(m.missing).toContain("Category");
  });

  // An unrecognised column is NOT an error: a client's own export carries
  // columns we don't want, and refusing the file over them is useless
  // pedantry. "Employee no" and "RMA ref" are ALSO unconsumed here —
  // "Assigned to" already claimed the assignee slot (so our own export's
  // second assignee column falls out the same way a genuinely foreign column
  // would; see the ASSET_IMPORT_HEADERS comment on this), and `rmaRef` has no
  // import field at all (carried, not fixed — see the amended spec).
  it("ignores columns it does not recognise, and reports them separately", () => {
    const m = matchHeaders([...HEADER, "Their internal ref"]);
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual(["Employee no", "RMA ref", "Their internal ref"]);
  });
});

describe("planAssetRows", () => {
  const plan = (rows: unknown[][], opts: ImportOptions = OPTS) =>
    planAssetRows(matchHeaders(HEADER), rows, REFS, opts);

  it("creates a clean new row, carrying every column through", () => {
    const p = plan([
      cells({ tag: "BR-LT-0900", model: "Dell XPS", serial: "SN-1", category: "Laptops", status: "SPARE", purchased: "2026-01-05", cost: "51000.50" }),
    ]);
    expect(p.counts).toEqual({ create: 1, update: 0, blocked: 0 });
    expect(p.rows[0]).toMatchObject({
      kind: "create",
      row: 2,
      data: { tag: "BR-LT-0900", model: "Dell XPS", serial: "SN-1", categoryId: "cat-1", status: "SPARE", cost: "51000.50" },
    });
  });

  // Rule 2 fix: matching was case-sensitive, so a lower-case tag planned as a
  // CREATE — a second record for one physical machine, since Postgres unique
  // is case-sensitive too and wouldn't even error.
  it("upper-cases the tag before matching, so a lower-case known tag is still an update", () => {
    const p = plan([cells({ tag: "br-lt-0148", model: "Dell XPS", category: "Laptops" })]);
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-1" });
  });

  it("blocks a tag that isn't shaped like BR-XX-0000", () => {
    const p = plan([cells({ tag: "LAPTOP-01", model: "Dell", category: "Laptops" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-tag", detail: "LAPTOP-01" });
  });

  // A known tag is an UPDATE, not a duplicate error — that is what makes
  // re-uploading a corrected sheet the obvious workflow.
  it("treats a known tag as an update, carrying the existing asset id", () => {
    const p = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", serial: "SN-OLD", category: "Laptops" })]);
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-1" });
    expect(p.counts.update).toBe(1);
  });

  it("blocks a row whose serial belongs to a different asset", () => {
    const p = plan([cells({ tag: "BR-LT-0901", model: "Dell", serial: "SN-TAKEN", category: "Laptops" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-serial", detail: "SN-TAKEN" });
  });

  it("turns that block into an update when the operator picks that fix", () => {
    const p = plan(
      [cells({ tag: "BR-LT-0901", model: "Dell", serial: "SN-TAKEN", category: "Laptops" })],
      { ...OPTS, treatDuplicateSerialAsUpdate: true },
    );
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-9" });
  });

  // C-1: the plan's own mutation pass never caught this, because no fixture
  // paired a matching tag with a taken serial. Here the tag resolves to a-1
  // but the serial resolves to a-9 — the two matches disagree about which
  // asset the row even is, and `treatDuplicateSerialAsUpdate` must not paper
  // over that (it only rescues the NO-tag-match case).
  it("does not rescue a duplicate serial when the tag already points to a different asset (C-1)", () => {
    const p = plan(
      [cells({ tag: "BR-LT-0148", model: "Dell XPS", serial: "SN-TAKEN", category: "Laptops" })],
      { ...OPTS, treatDuplicateSerialAsUpdate: true },
    );
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-serial", detail: "SN-TAKEN" });
  });

  // C-2: both maps are built from the database, so nothing accumulated what
  // an earlier row of THIS file already claimed — two rows sharing a brand
  // new tag both planned as creates. The likeliest real-world file shape: a
  // copy-paste while editing an export.
  it("blocks a tag repeated within the file, not just a repeat of the database (C-2)", () => {
    const p = plan([
      cells({ tag: "BR-LT-0950", model: "Dell", category: "Laptops" }),
      cells({ tag: "BR-LT-0950", model: "Dell 2", category: "Laptops" }),
    ]);
    expect(p.rows[0].kind).toBe("create");
    expect(p.rows[1]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file", detail: "BR-LT-0950" });
    expect(p.counts).toEqual({ create: 1, update: 0, blocked: 1 });
  });

  it("blocks a serial repeated within the file the same way", () => {
    const p = plan([
      cells({ tag: "BR-LT-0951", model: "Dell", serial: "SN-DUP", category: "Laptops" }),
      cells({ tag: "BR-LT-0952", model: "Dell 2", serial: "SN-DUP", category: "Laptops" }),
    ]);
    expect(p.rows[1]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file", detail: "SN-DUP" });
  });

  it("blocks a missing tag, an unknown category, an unknown type and a missing model separately", () => {
    const p = plan([
      cells({ model: "Dell", category: "Laptops" }),
      cells({ tag: "BR-LT-0902", model: "Dell", category: "Chairs" }),
      cells({ tag: "BR-LT-0903", model: "Dell", category: "Laptops", type: "Ergo Chair" }),
      cells({ tag: "BR-LT-0904", category: "Laptops" }),
    ]);
    expect(p.rows.map((r) => (r.kind === "blocked" ? r.cause : r.kind))).toEqual([
      "missing-tag",
      "unknown-category",
      "unknown-type",
      "missing-model",
    ]);
  });

  // The composite-key fix (amended AssetRefs shape): "Standard" exists under
  // BOTH categories, at different type ids. Asking for it under Furniture
  // while naming the Laptops category must resolve to the FURNITURE record,
  // not silently reuse the Laptops one a flat name map would have kept.
  it("resolves a type within the row's own category, even when the same name exists elsewhere", () => {
    const p = plan([cells({ tag: "BR-FN-0100", model: "Chair", category: "Furniture", type: "Standard" })]);
    expect(p.rows[0]).toMatchObject({ kind: "create", data: { categoryId: "cat-2", typeId: "typ-4" } });
  });

  it("treats a type as unknown when it belongs to a different category, even though the name matches something in the database", () => {
    // "Ergo Chair" only exists under Furniture (cat-2); this row names Laptops.
    const p = plan([cells({ tag: "BR-LT-0905", model: "Dell", category: "Laptops", type: "Ergo Chair" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "unknown-type", detail: "Ergo Chair" });
  });

  it("resolves an assignee by employee number OR by name, case-insensitively", () => {
    for (const who of ["EMP-0042", "marites bautista"]) {
      expect(
        plan([cells({ tag: "BR-LT-0906", model: "Dell", category: "Laptops", assignedTo: who })]).rows[0],
      ).toMatchObject({ kind: "create" });
    }
  });

  it("blocks an unknown assignee, and drops it instead when that fix is picked", () => {
    const row = [cells({ tag: "BR-LT-0907", model: "Dell", category: "Laptops", assignedTo: "Nobody Here" })];
    expect(plan(row).rows[0]).toMatchObject({ kind: "blocked", cause: "unknown-assignee" });
    const dropped = plan(row, { ...OPTS, dropUnknownAssignee: true });
    expect(dropped.rows[0]).toMatchObject({ kind: "create" });
    expect(dropped.rows[0].kind === "create" && dropped.rows[0].data.assigneeId).toBeNull();
  });

  // Employee.name isn't unique — "Juan Dela Cruz" resolves to more than one
  // record. Unlike unknown/inactive, dropping loses information (WHICH one
  // was meant), so `dropUnknownAssignee` must not rescue it.
  it("blocks an ambiguous assignee name, and does not let dropUnknownAssignee rescue it", () => {
    const row = [cells({ tag: "BR-LT-0908", model: "Dell", category: "Laptops", assignedTo: "Juan Dela Cruz" })];
    expect(plan(row).rows[0]).toMatchObject({ kind: "blocked", cause: "ambiguous-assignee" });
    expect(plan(row, { ...OPTS, dropUnknownAssignee: true }).rows[0]).toMatchObject({ cause: "ambiguous-assignee" });
  });

  // `createAsset` itself refuses a non-ACTIVE assignee ("assignments are
  // frozen", actions.ts:196) — import honours the same rule. Unlike
  // ambiguous, dropUnknownAssignee DOES rescue this one (rule 8: "drops the
  // last two to unassigned").
  it("blocks an assignee who resolves but isn't ACTIVE, and drops it instead when that fix is picked", () => {
    const row = [cells({ tag: "BR-LT-0909", model: "Dell", category: "Laptops", assignedTo: "Inactive Ida" })];
    expect(plan(row).rows[0]).toMatchObject({ kind: "blocked", cause: "inactive-assignee" });
    const dropped = plan(row, { ...OPTS, dropUnknownAssignee: true });
    expect(dropped.rows[0]).toMatchObject({ kind: "create" });
    expect(dropped.rows[0].kind === "create" && dropped.rows[0].data.assigneeId).toBeNull();
  });

  it("blocks an unknown vendor, and drops it instead when that fix is picked", () => {
    const row = [cells({ tag: "BR-LT-0910", model: "Dell", category: "Laptops", vendor: "Nobody Corp" })];
    expect(plan(row).rows[0]).toMatchObject({ kind: "blocked", cause: "unknown-vendor" });
    const dropped = plan(row, { ...OPTS, dropUnknownVendor: true });
    expect(dropped.rows[0]).toMatchObject({ kind: "create" });
    expect(dropped.rows[0].kind === "create" && dropped.rows[0].data.vendorId).toBeNull();
  });

  it("resolves a known vendor", () => {
    const p = plan([cells({ tag: "BR-LT-0911", model: "Dell", category: "Laptops", vendor: "ACME" })]);
    expect(p.rows[0]).toMatchObject({ kind: "create", data: { vendorId: "v-1" } });
  });

  it("accepts a real Date cell and a YYYY-MM-DD string, and blocks anything else", () => {
    const withDate = (v: unknown) =>
      plan([cells({ tag: "BR-LT-0912", model: "Dell", category: "Laptops", purchased: v })]).rows[0];
    expect(withDate(new Date("2026-01-05T00:00:00Z"))).toMatchObject({ kind: "create" });
    expect(withDate("2026-01-05")).toMatchObject({ kind: "create" });
    expect(withDate("5 Jan 26")).toMatchObject({ kind: "blocked", cause: "bad-date" });
  });

  // Warranty until was entirely dead in the old 9-column fixture (no header
  // for it at all), so this branch was never exercised by any test.
  it("validates the Warranty until column the same way it validates Purchased", () => {
    const p = plan([cells({ tag: "BR-LT-0913", model: "Dell", category: "Laptops", warranty: "2027-06-30" })]);
    expect(p.rows[0]).toMatchObject({ kind: "create", data: { warrantyUntil: new Date("2027-06-30T00:00:00.000Z") } });
    const bad = plan([cells({ tag: "BR-LT-0914", model: "Dell", category: "Laptops", warranty: "not a date" })]);
    expect(bad.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-date" });
  });

  // The shape regex alone let this through as an Invalid Date. Caught by the
  // NaN check.
  it("rejects a date with an out-of-range month or day that isn't even a valid Invalid-Date parse", () => {
    const p = plan([cells({ tag: "BR-LT-0915", model: "Dell", category: "Laptops", purchased: "2026-13-45" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-date", detail: "2026-13-45" });
  });

  // The dangerous one: `new Date("2026-02-30T00:00:00.000Z")` does NOT throw
  // or produce Invalid Date — it normalises into March 2, and nothing
  // downstream would ever flag that the row asked for a day that doesn't
  // exist. The round-trip check (text must equal the ISO date it produces)
  // is the only thing that catches this.
  it("rejects a calendar-invalid date that JS Date silently rounds forward (2026-02-30 -> March 2)", () => {
    const p = plan([cells({ tag: "BR-LT-0916", model: "Dell", category: "Laptops", purchased: "2026-02-30" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-date", detail: "2026-02-30" });
  });

  it("blocks a cost that is not a plain number, naming the offending text", () => {
    const p = plan([cells({ tag: "BR-LT-0917", model: "Dell", category: "Laptops", cost: "PHP 51,000" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number", detail: "PHP 51,000" });
  });

  // A thousands-separator amount is the distinguishing case a lenient
  // parseFloat would miss: parseFloat("51,000.00") reads "51" and stops at
  // the comma instead of rejecting the rest.
  it("blocks a cost with a thousands separator rather than truncate-reading it", () => {
    const p = plan([cells({ tag: "BR-LT-0918", model: "Dell", category: "Laptops", cost: "51,000.00" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number", detail: "51,000.00" });
  });

  it("keeps a valid text cost as a string, never a number", () => {
    const p = plan([cells({ tag: "BR-LT-0919", model: "Dell", category: "Laptops", cost: "51000.50" })]);
    expect(p.rows[0].kind === "create" && p.rows[0].data.cost).toBe("51000.50");
  });

  // C-13 (the numeric-branch parity bug): Excel/xlsx hands back a JS `number`
  // for every currency-formatted cell, so this was the COMMON path in
  // practice, yet `typeof raw === "number"` used to return `String(raw)`
  // completely unchecked.
  it("blocks a negative numeric cost the same way it blocks negative text", () => {
    const p = plan([cells({ tag: "BR-LT-0920", model: "Dell", category: "Laptops", cost: -500 })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number" });
  });

  it("blocks a numeric cost with float noise that doesn't round-trip to two decimals", () => {
    const p = plan([cells({ tag: "BR-LT-0921", model: "Dell", category: "Laptops", cost: 0.1 + 0.2 })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number" });
  });

  it("blocks a numeric cost with three decimal places rather than silently rounding it", () => {
    const p = plan([cells({ tag: "BR-LT-0922", model: "Dell", category: "Laptops", cost: 51000.555 })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number" });
  });

  it("blocks a numeric cost over the 10,000,000 ceiling instead of letting it reach Prisma as a parse error", () => {
    const p = plan([cells({ tag: "BR-LT-0923", model: "Dell", category: "Laptops", cost: 1e21 })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number" });
  });

  it("accepts a valid numeric cost the same way it accepts the equivalent text", () => {
    const p = plan([cells({ tag: "BR-LT-0924", model: "Dell", category: "Laptops", cost: 51000.5 })]);
    expect(p.rows[0].kind === "create" && p.rows[0].data.cost).toBe("51000.50");
  });

  it("blocks an unrecognised status but reads a blank one as SPARE", () => {
    expect(plan([cells({ tag: "BR-LT-0925", model: "Dell", category: "Laptops", status: "BROKEN" })]).rows[0]).toMatchObject({
      kind: "blocked",
      cause: "bad-status",
    });
    const blank = plan([cells({ tag: "BR-LT-0926", model: "Dell", category: "Laptops" })]).rows[0];
    expect(blank).toMatchObject({ kind: "create" });
    expect(blank.kind === "create" && blank.data.status).toBe("SPARE");
  });

  // D-A: create honours the sheet — an import's job is entering a fleet
  // that's already deployed, and all eight statuses are legitimate there.
  it("creates a Deployed asset directly when the row supplies a holder, with no approval detour", () => {
    const p = plan([cells({ tag: "BR-LT-0927", model: "Dell", category: "Laptops", status: "DEPLOYED", assignedTo: "EMP-0042" })]);
    expect(p.rows[0]).toMatchObject({ kind: "create", data: { status: "DEPLOYED", assigneeId: "e-1" } });
  });

  it("blocks a Deployed or Temporary row with no assignee at all", () => {
    const p = plan([cells({ tag: "BR-LT-0928", model: "Dell", category: "Laptops", status: "TEMPORARY" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "deployed-without-holder" });
  });

  // The specific bug: as planned, dropping an unresolved holder left
  // `{status: "DEPLOYED", assigneeId: null}` — deployed to nobody, from a
  // button whose label promised "leave as spare".
  it("downgrades to SPARE, rather than staying Deployed-with-no-one, when dropUnknownAssignee drops the only holder", () => {
    const p = plan(
      [cells({ tag: "BR-LT-0929", model: "Dell", category: "Laptops", status: "DEPLOYED", assignedTo: "Nobody Here" })],
      { ...OPTS, dropUnknownAssignee: true },
    );
    expect(p.rows[0]).toMatchObject({ kind: "create", data: { status: "SPARE", assigneeId: null } });
  });

  // D-A, update half: status/assignee never move via a plain update. This is
  // the module's other whole reason for existing — a spreadsheet must not be
  // the one surface in the app that can flip status with no approval, no SLA
  // and no audit trail.
  it("blocks an update whose Status disagrees with the record, instead of moving it silently", () => {
    // BR-LT-0148 (a-1) is currently SPARE.
    const p = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", status: "DEPLOYED" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "lifecycle-via-import" });
  });

  it("blocks an update whose Assigned-to disagrees with the record's current holder", () => {
    // BR-LT-0200 (a-2) is currently held by e-1 (Marites Bautista).
    const p = plan([cells({ tag: "BR-LT-0200", model: "Dell", category: "Laptops", assignedTo: "EMP-0042" })]);
    // e-1 IS the current holder, so this one should NOT block.
    expect(p.rows[0]).toMatchObject({ kind: "update" });
    const conflict = plan([cells({ tag: "BR-LT-0148", model: "Dell", category: "Laptops", assignedTo: "EMP-0042" })]);
    // a-1 currently has no assignee, so naming one is a lifecycle move.
    expect(conflict.rows[0]).toMatchObject({ kind: "blocked", cause: "lifecycle-via-import" });
  });

  it("keeps the current lifecycle and still applies the row's other columns when that fix is picked", () => {
    const p = plan(
      [cells({ tag: "BR-LT-0148", model: "Renamed Model", category: "Laptops", status: "DEPLOYED" })],
      { ...OPTS, keepCurrentLifecycle: true },
    );
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-1", data: { model: "Renamed Model" } });
  });

  // AssetUpdatePatch structurally never carries these — not "carries them
  // when unchanged", never at all. That is what makes it safe for T10 to
  // spread the patch straight into Prisma's `data`.
  it("never puts tag, status or assigneeId in an update patch, even when the sheet's values already agree with the record", () => {
    const p = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", status: "SPARE" })]);
    const data = p.rows[0].kind === "update" ? p.rows[0].data : null;
    expect(data).not.toBeNull();
    expect(data && "tag" in data).toBe(false);
    expect(data && "status" in data).toBe(false);
    expect(data && "assigneeId" in data).toBe(false);
  });

  // C-7, the destructive-write bug: a column ABSENT from the sheet must be
  // left untouched (no key at all), while a column PRESENT with a blank cell
  // is an intentional clear (explicit null). Collapsing the two is exactly
  // what a partial re-upload of a trimmed export would do to 200 records.
  it("omits an absent column from the update patch, but clears a present-and-blank one (C-7)", () => {
    const narrowHeaders = matchHeaders(["Tag", "Model", "Category"]);
    const narrowRow = ["BR-LT-0148", "Dell XPS", "Laptops"];
    const p1 = planAssetRows(narrowHeaders, [narrowRow], REFS, OPTS);
    const data1 = p1.rows[0].kind === "update" ? p1.rows[0].data : null;
    expect(data1 && "notes" in data1).toBe(false);
    expect(data1 && "vendorId" in data1).toBe(false);

    const p2 = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", notes: "" })]);
    const data2 = p2.rows[0].kind === "update" ? p2.rows[0].data : null;
    expect(data2 && "notes" in data2).toBe(true);
    expect(data2?.notes).toBeNull();
  });

  it("carries a present, non-blank column through to the update patch", () => {
    const p = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", notes: "Repaired keyboard" })]);
    expect(p.rows[0]).toMatchObject({ kind: "update", data: { notes: "Repaired keyboard" } });
  });

  it("blocks a model shorter than 2 characters", () => {
    const p = plan([cells({ tag: "BR-LT-0930", model: "X", category: "Laptops" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "value-too-long", detail: "Model" });
  });

  it("blocks a serial over 120 characters", () => {
    const p = plan([cells({ tag: "BR-LT-0931", model: "Dell", category: "Laptops", serial: "S".repeat(121) })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "value-too-long", detail: "Serial" });
  });

  it("blocks notes over 2000 characters", () => {
    const p = plan([cells({ tag: "BR-LT-0932", model: "Dell", category: "Laptops", notes: "N".repeat(2001) })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "value-too-long", detail: "Notes" });
  });

  // Partial import is the DEFAULT (scope decision 4): a bad row must not cost
  // the good rows around it.
  it("keeps the good rows in a file that also has bad ones", () => {
    const p = plan([
      cells({ tag: "BR-LT-0933", model: "Dell", category: "Laptops" }),
      cells({ model: "Dell", category: "Laptops" }),
      cells({ tag: "BR-LT-0934", model: "Dell", category: "Laptops" }),
    ]);
    expect(p.counts).toEqual({ create: 2, update: 0, blocked: 1 });
  });

  // Row numbers are what the operator uses to find the row in Excel, where
  // the header is row 1 — so a data row reports its SHEET row, not its index.
  it("reports sheet row numbers, counting the header", () => {
    const p = plan([
      cells({ model: "Dell", category: "Laptops" }),
      cells({ model: "Dell", category: "Laptops" }),
    ]);
    expect(p.rows.map((r) => r.row)).toEqual([2, 3]);
  });

  it("skips a wholly blank row rather than blocking it — trailing blanks are normal", () => {
    const p = plan([
      cells({ tag: "BR-LT-0935", model: "Dell", category: "Laptops" }),
      Array(HEADER.length).fill(null),
      Array(HEADER.length).fill(""),
    ]);
    expect(p.counts).toEqual({ create: 1, update: 0, blocked: 0 });
    expect(p.rows).toHaveLength(1);
  });

  it("reports one cause per row, so groupByCause counts each row once", () => {
    // Missing tag AND unknown category on the same row: the first check wins.
    const p = plan([cells({ model: "Dell", category: "Chairs" })]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ cause: "missing-tag" });
  });
});
