import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cellText, matchHeaders, planAssetRows, refKey, tagKey, type AssetRefs, type ImportOptions,
} from "./import-assets";

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
  // both, to prove a flat name key would be lossy. Values are plain ids
  // (round 2 Minor: the dead `categoryId` the value used to also carry —
  // nothing read it, the composite KEY already embeds it — is gone); `null`
  // would mean a same-category case-collision (R-1), tested separately below.
  types: new Map([
    ["cat-1:macbook pro", "typ-1"],
    ["cat-1:standard", "typ-3"],
    ["cat-2:ergo chair", "typ-2"],
    ["cat-2:standard", "typ-4"],
  ]),
  employees: new Map([
    ["emp-0042", { id: "e-1", employment: "ACTIVE", ambiguous: false }],
    ["marites bautista", { id: "e-1", employment: "ACTIVE", ambiguous: false }],
    ["emp-0099", { id: "e-2", employment: "OFFBOARDED", ambiguous: false }],
    ["inactive ida", { id: "e-2", employment: "OFFBOARDED", ambiguous: false }],
    ["juan dela cruz", { id: "e-3", employment: "ACTIVE", ambiguous: true }],
  ]),
  vendors: new Map([["acme", "v-1"]]),
  // AssetRecordRef (round 2, NC-1/NC-2/NC-3's unified shape): id, tag, status,
  // assigneeId, categoryId, typeId. `tag` is the RECORD's own tag (not the
  // sheet row's — they can differ on a serial rescue). a-1 carries a real
  // typeId under cat-1 specifically so a category-changing row with no Type
  // column can be shown stranding it (NC-3).
  byTag: new Map([
    ["BR-LT-0148", { id: "a-1", tag: "BR-LT-0148", status: "SPARE", assigneeId: null, categoryId: "cat-1", typeId: "typ-1" }],
    ["BR-LT-0200", { id: "a-2", tag: "BR-LT-0200", status: "DEPLOYED", assigneeId: "e-1", categoryId: "cat-1", typeId: null }],
    // a-3: DEPLOYED to e-2, who is OFFBOARDED (not ACTIVE) — the export
    // round-trip case NC-2 exists for: re-uploading this asset's own row
    // unchanged must not block on its own already-recorded, non-ACTIVE holder.
    ["BR-LT-0300", { id: "a-3", tag: "BR-LT-0300", status: "DEPLOYED", assigneeId: "e-2", categoryId: "cat-1", typeId: null }],
  ]),
  bySerial: new Map([
    // Tag deliberately DIFFERENT from any sheet row used in the rescue tests
    // below (BR-LT-0777, not BR-LT-0901/0952/etc.), so a test can assert the
    // update verdict names the MATCHED asset, not the row's own tag (NI-4's
    // legibility gap, closed by AssetRecordRef.tag).
    ["SN-TAKEN", { id: "a-9", tag: "BR-LT-0777", status: "SPARE", assigneeId: null, categoryId: "cat-1", typeId: null }],
    ["SN-OLD", { id: "a-1", tag: "BR-LT-0148", status: "SPARE", assigneeId: null, categoryId: "cat-1", typeId: "typ-1" }],
  ]),
};

const OPTS: ImportOptions = {
  treatDuplicateSerialAsUpdate: false,
  dropUnknownAssignee: false,
  dropUnknownVendor: false,
  keepCurrentLifecycle: false,
  importUnheldAsSpare: false,
};

/**
 * The three shared key rules. Each is used on BOTH sides of a lookup — the map
 * built from the database and the sheet value that consults it — so a change
 * to any of them that is not symmetric turns a match into a silent CREATE and
 * a P2002 at write time. They were unpinned as of round 2: weakening
 * `cellText`'s trim, or `refKey`'s collapse, left the whole suite green.
 */
describe("the shared lookup keys", () => {
  it("cellText trims, and reads a blank cell and a non-string cell alike", () => {
    expect(cellText("  BR-LT-0148  ")).toBe("BR-LT-0148");
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText("   ")).toBe("");
    expect(cellText(12345)).toBe("12345");
  });

  it("refKey lower-cases and collapses internal whitespace, including a non-breaking space", () => {
    expect(refKey("  Dell  Latitude ")).toBe("dell latitude");
    // Written as the ESCAPE, not a literal U+00A0: a raw NBSP in source is
    // invisible to a reader and one formatter away from becoming a plain space,
    // which would silently turn this into a duplicate of the line above.
    expect(refKey("Ramon\u00A0Cruz")).toBe("ramon cruz");
    expect(refKey("RAMON CRUZ")).toBe("ramon cruz");
  });

  // Upper-case, because Postgres unique is case-sensitive and a missed match
  // is a second record for one physical machine rather than an error.
  it("tagKey trims and upper-cases", () => {
    expect(tagKey(" br-lt-0148 ")).toBe("BR-LT-0148");
    expect(tagKey(null)).toBe("");
  });
});

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
  // pedantry. "RMA ref" is unconsumed because `rmaRef` has no import field at
  // all (carried, not fixed — see the amended spec). "Employee no" is NOT in
  // this list any more (NI-1, round 2): it is its own column now, consumed
  // separately from "Assigned to" rather than falling out unconsumed.
  it("ignores columns it does not recognise, and reports them separately", () => {
    const m = matchHeaders([...HEADER, "Their internal ref"]);
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual(["RMA ref", "Their internal ref"]);
  });

  // NI-1 (round 2): "Employee no" is now matched as its own column.
  it("matches Employee no as its own column, separate from Assigned to", () => {
    const m = matchHeaders(HEADER);
    expect(m.map.get("assignee")).toBe(COL.assignedTo);
    expect(m.map.get("employeeNo")).toBe(COL.employeeNo);
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

  // AssetRecordRef.tag (round 2): the update verdict must name the MATCHED
  // asset's own tag (a-9 is "BR-LT-0777"), not the sheet row's tag
  // ("BR-LT-0901", which matched nothing) — otherwise a rescued update names
  // its target only by a cuid the operator has never seen anywhere in the
  // app, and cannot check against the file at all.
  it("surfaces the matched asset's own tag on a serial-rescued update, not the sheet row's tag", () => {
    const p = plan(
      [cells({ tag: "BR-LT-0901", model: "Dell", serial: "SN-TAKEN", category: "Laptops" })],
      { ...OPTS, treatDuplicateSerialAsUpdate: true },
    );
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-9", assetTag: "BR-LT-0777" });
  });

  // NI-4: rule 11's lifecycle check must compare against the RESCUED
  // record's own status (a-9 is SPARE with no assignee), not against
  // whatever the tag-matched lookup would have found (there isn't one
  // here). Deleting the rescue assignment (`matched = existingBySerial`)
  // would leave `matched` null, this row would plan as a CREATE instead —
  // silently registering a second asset for one physical machine — and if
  // that null instead reached a downstream `!` assertion it would throw.
  // Requesting DEPLOYED with no holder on this rescued row must be treated
  // as an update-lifecycle conflict, not the create-only "no holder" rule.
  it("runs the lifecycle check against the RESCUED record on a serial-rescued row (NI-4)", () => {
    const p = plan(
      [cells({ tag: "BR-LT-0901", model: "Dell", serial: "SN-TAKEN", category: "Laptops", status: "DEPLOYED" })],
      { ...OPTS, treatDuplicateSerialAsUpdate: true },
    );
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "lifecycle-via-import" });
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

  // M3: seenTags and seenSerials must be claimed at the SAME point in rule
  // order — before this fix, the tag was claimed before the model check but
  // the serial was claimed after it, so a row blocked for an unrelated
  // reason (a blank Model, here) claimed its tag but NOT its serial. Row 1
  // is blocked on `missing-model`; row 2 shares row 1's serial and must
  // still be flagged `duplicate-in-file`, proving row 1 claimed it despite
  // never planning as a create or update itself.
  it("claims a row's serial before a later rule can block it, so a row blocked for an unrelated reason still occupies its serial (M3)", () => {
    const p = plan([
      cells({ tag: "BR-LT-0953", category: "Laptops", serial: "SN-CLAIM" }), // blank model -> missing-model
      cells({ tag: "BR-LT-0954", model: "Dell", category: "Laptops", serial: "SN-CLAIM" }),
    ]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-model" });
    expect(p.rows[1]).toMatchObject({ kind: "blocked", cause: "duplicate-in-file", detail: "SN-CLAIM" });
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

  // NI-5: Category is the third required column, alongside Tag and Model —
  // a blank CELL must not fall into `unknown-category` (whose detail would
  // then be empty and get filtered out of `groupByCause`'s examples,
  // leaving the operator a group header and no examples at all).
  it("blocks a blank Category cell as missing-category, not unknown-category with an empty detail (NI-5)", () => {
    const p = plan([cells({ tag: "BR-LT-0948", model: "Dell", category: "" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "missing-category", detail: "" });
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

  // NC-3: a-1 (BR-LT-0148) is stored under cat-1 with typ-1. This trimmed
  // sheet (Tag, Model, Category only — no Type column at all) moves it to
  // Furniture (cat-2). With no Type column, the patch would carry no
  // `typeId` key, Prisma would leave the STORED typ-1 untouched, and typ-1
  // belongs to the OLD category — exactly the state `updateAsset`
  // (actions.ts:294) itself refuses to save on its own edit form.
  it("blocks a category change with no Type column that would strand the stored type outside the new category (NC-3)", () => {
    const narrowHeaders = matchHeaders(["Tag", "Model", "Category"]);
    const row = ["BR-LT-0148", "Dell XPS", "Furniture"];
    const p = planAssetRows(narrowHeaders, [row], REFS, OPTS);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "type-outside-category", detail: "Furniture" });
  });

  // Contrast case: when the Type column IS present, even with a blank cell,
  // the patch clears `typeId` to null instead of leaving the stale one in
  // place — so there is nothing left to strand, and NC-3 must not fire.
  it("does not block type-outside-category when a present Type column would clear the mismatched type instead", () => {
    const p = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Furniture" })]);
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-1", data: { typeId: null } });
  });

  // The `matched.typeId &&` guard, which survived mutation until this test
  // existed: an asset with NO type at all (a-2) has nothing to strand, so
  // moving it to another category on the same trimmed sheet is a clean
  // update. Dropping the guard blocks this row and tells the operator their
  // asset's type no longer fits — about an asset that has no type.
  it("does not block a category change on an asset that has no stored type to strand", () => {
    const narrowHeaders = matchHeaders(["Tag", "Model", "Category"]);
    const p = planAssetRows(narrowHeaders, [["BR-LT-0200", "Dell XPS", "Furniture"]], REFS, OPTS);
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-2", data: { categoryId: "cat-2" } });
  });

  it("resolves an assignee by employee number OR by name, case-insensitively", () => {
    for (const who of ["EMP-0042", "marites bautista"]) {
      expect(
        plan([cells({ tag: "BR-LT-0906", model: "Dell", category: "Laptops", assignedTo: who })]).rows[0],
      ).toMatchObject({ kind: "create" });
    }
  });

  // R-4 (round 2): `refKey()` collapses an internal whitespace RUN — not
  // just an ordinary double space, but a non-breaking space (U+00A0), the
  // routine artefact of pasting a name from Outlook or a web page into
  // Excel. `trim()` alone strips a SURROUNDING NBSP but leaves one sitting
  // BETWEEN "Marites" and "Bautista" untouched, and before this fix that
  // name would block as `unknown-assignee` naming a value that reads
  // letter-for-letter identical to a real employee, with no visible
  // difference — and the offered fix, "Leave as spare", silently discards a
  // valid assignment.
  it("resolves an assignee whose name carries an internal non-breaking space or doubled space, via refKey (R-4)", () => {
    for (const who of ["Marites\u00A0Bautista", "Marites  Bautista", "  marites   bautista  "]) {
      const p = plan([cells({ tag: "BR-LT-0959", model: "Dell", category: "Laptops", assignedTo: who })]);
      expect(p.rows[0]).toMatchObject({ kind: "create", data: { assigneeId: "e-1" } });
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

  // NI-1: `ambiguous-assignee`'s own explain tells the operator to fill in
  // an Employee no column — this proves that actually works now, on the
  // exact shape our own export writes (a name column AND an employee-no
  // column together). Before the fix, "Assigned to" alone consumed the
  // assignee slot and "Employee no" fell out unread, so this exact row
  // would have stayed blocked no matter what the Employee no cell said.
  it("resolves an ambiguous name when the Employee no column disambiguates it (NI-1)", () => {
    const row = [
      cells({ tag: "BR-LT-0908", model: "Dell", category: "Laptops", assignedTo: "Juan Dela Cruz", employeeNo: "EMP-0042" }),
    ];
    expect(plan(row).rows[0]).toMatchObject({ kind: "create", data: { assigneeId: "e-1" } });
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

  // NC-2: BR-LT-0300 (a-3) is already DEPLOYED to e-2, who is OFFBOARDED —
  // this is our own export re-uploaded with nothing about the holder
  // changed. Before the fix, rule 8's ACTIVE check fired unconditionally and
  // blocked this on `inactive-assignee`, even though the row makes no
  // assignment at all: the sheet's holder already IS the record's holder.
  it("does not block inactive-assignee on an update whose holder already matches the record's own (NC-2)", () => {
    const p = plan([cells({ tag: "BR-LT-0300", model: "Dell", category: "Laptops", assignedTo: "Inactive Ida" })]);
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-3" });
  });

  // Regression guard alongside NC-2's fix: a row that names a DIFFERENT
  // non-ACTIVE holder than the one already on record is still a real
  // assignment move, and must still block.
  it("still blocks inactive-assignee when an update would move the holder to a DIFFERENT non-ACTIVE employee", () => {
    // BR-LT-0148 (a-1) currently has no assignee at all.
    const p = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", assignedTo: "Inactive Ida" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "inactive-assignee" });
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

  // R-1 (round 2, consuming side): a `null` map entry means two rows share
  // this name case-insensitively — the id is genuinely undecidable, so this
  // must block with its OWN cause rather than being read as "falsy" and
  // reported as unknown-category (a different, wrong, problem: the name IS
  // known, twice).
  it("blocks duplicate-category-name, distinctly from unknown-category, when the map records an ambiguous collision", () => {
    const refs: AssetRefs = { ...REFS, categories: new Map([...REFS.categories, ["storage", null]]) };
    const p = planAssetRows(
      matchHeaders(HEADER),
      [cells({ tag: "BR-ST-0100", model: "Shelf", category: "Storage" })],
      refs,
      OPTS,
    );
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-category-name", detail: "Storage" });
  });

  it("blocks duplicate-type-name, scoped to the row's own category, when the composite key records a collision", () => {
    const refs: AssetRefs = { ...REFS, types: new Map([...REFS.types, ["cat-1:premium", null]]) };
    const p = planAssetRows(
      matchHeaders(HEADER),
      [cells({ tag: "BR-LT-0960", model: "Dell", category: "Laptops", type: "Premium" })],
      refs,
      OPTS,
    );
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-type-name", detail: "Premium" });
  });

  it("blocks duplicate-vendor-name, and drops it instead when that fix is picked (same rescue as unknown-vendor)", () => {
    const refs: AssetRefs = { ...REFS, vendors: new Map([...REFS.vendors, ["dell corp", null]]) };
    const row = [cells({ tag: "BR-LT-0961", model: "Dell", category: "Laptops", vendor: "Dell Corp" })];
    const blocked = planAssetRows(matchHeaders(HEADER), row, refs, OPTS);
    expect(blocked.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-vendor-name", detail: "Dell Corp" });
    const dropped = planAssetRows(matchHeaders(HEADER), row, refs, { ...OPTS, dropUnknownVendor: true });
    expect(dropped.rows[0]).toMatchObject({ kind: "create" });
    expect(dropped.rows[0].kind === "create" && dropped.rows[0].data.vendorId).toBeNull();
  });

  // NC-1: a dropped vendor on an UPDATE must OMIT `vendorId` from the patch,
  // not write `null` — `null` means "the cell was genuinely blank, clear
  // it", and a dropped vendor is not a blank cell, it's a name this run
  // could not resolve. Writing `null` here would erase whatever vendor the
  // record already had on file, on every row naming an unresolved vendor
  // across a whole re-upload.
  it("omits vendorId from an update patch when the vendor was dropped, instead of nulling out the stored vendor (NC-1)", () => {
    const row = [cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", vendor: "Nobody Corp" })];
    const dropped = plan(row, { ...OPTS, dropUnknownVendor: true });
    const data = dropped.rows[0].kind === "update" ? dropped.rows[0].data : null;
    expect(data).not.toBeNull();
    expect(data && "vendorId" in data).toBe(false);
  });

  // The SAME omission, reached through the collision drop rather than the
  // unknown drop. There are two `vendorDropped = true` assignments, and the
  // test above only pins one of them: the collision path's was reachable only
  // by a CREATE row, where `vendorId` is null whether the flag was set or not,
  // so flipping it to `false` left the whole suite green. This is the
  // destructive path — without the flag the patch writes `null` and erases the
  // stored vendor on every matched row of a re-upload.
  it("omits vendorId from an update patch when the vendor was dropped for a NAME COLLISION too", () => {
    const refs: AssetRefs = { ...REFS, vendors: new Map([...REFS.vendors, ["dell corp", null]]) };
    const row = [cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", vendor: "Dell Corp" })];
    const dropped = planAssetRows(matchHeaders(HEADER), row, refs, { ...OPTS, dropUnknownVendor: true });
    const data = dropped.rows[0].kind === "update" ? dropped.rows[0].data : null;
    expect(data).not.toBeNull();
    expect(data && "vendorId" in data).toBe(false);
  });

  // Contrast case for NC-1: a genuinely BLANK Vendor cell on the same asset
  // still clears vendorId to null, exactly as C-7 requires — the drop and
  // the blank cell must produce DIFFERENT patches even though both start
  // from an unresolved/absent vendor value.
  it("still clears vendorId on an update when the Vendor cell is genuinely blank", () => {
    const row = [cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", vendor: "" })];
    const p = plan(row);
    const data = p.rows[0].kind === "update" ? p.rows[0].data : null;
    expect(data && "vendorId" in data).toBe(true);
    expect(data?.vendorId).toBeNull();
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

  // The date convention is PINNED, not assumed: Task 8's probe read a date
  // cell back through our own export and got UTC midnight, byte-identical
  // under every timezone tried. These assert that contract, and they are
  // parameterised because a single forced timezone has already fooled this
  // suite once — America/New_York (UTC-5) is the offset where the local and
  // UTC getters AGREE for a local-midnight instant, so the previous version
  // of this block stayed green with the getters swapped. Manila (UTC+8) and
  // UTC are what make the two readings distinguishable.
  describe.each(["Asia/Manila", "America/New_York", "UTC"])("parseDateCell date convention (%s)", (tz) => {
    const originalTZ = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = tz;
    });
    afterAll(() => {
      process.env.TZ = originalTZ;
    });

    // What `readSheet` actually hands over. Under local getters this reads
    // the day BEFORE at any negative offset, which is the defect Task 8's
    // probe caught — so this is the assertion that pins the fix.
    it("reads the UTC-midnight Date the sheet reader produces as that same day", () => {
      const p = plan([
        cells({ tag: "BR-LT-0945", model: "Dell", category: "Laptops", purchased: new Date("2026-01-05T00:00:00Z") }),
      ]);
      const value = p.rows[0].kind === "create" ? p.rows[0].data.purchasedAt : null;
      expect(value?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    });

    // A date cell carrying a time component is where the normalisation still
    // does real work rather than being a no-op.
    it("flattens a Date with a time component to UTC midnight of its own UTC day", () => {
      const p = plan([
        cells({ tag: "BR-LT-0946", model: "Dell", category: "Laptops", purchased: new Date("2026-01-05T13:45:30Z") }),
      ]);
      const value = p.rows[0].kind === "create" ? p.rows[0].data.purchasedAt : null;
      expect(value?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    });

    it("leaves a YYYY-MM-DD string on its own calendar day whatever the process timezone", () => {
      const p = plan([cells({ tag: "BR-LT-0947", model: "Dell", category: "Laptops", purchased: "2026-01-05" })]);
      const value = p.rows[0].kind === "create" ? p.rows[0].data.purchasedAt : null;
      expect(value?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    });
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

  // NI-3: the test above uses 1e21, which the TWO-DECIMAL check catches
  // first (1e21 * 100 does not round-trip through `Math.round`), so it never
  // actually exercises the ceiling branch — a second copy of the 2dp test
  // wearing the ceiling's name. 20,000,000 has exactly two decimal places
  // and is still over COST_MAX, so only the ceiling check can catch it, in
  // both the numeric and text branches.
  it("blocks a numeric cost over the ceiling using a value the two-decimal check would not catch first (NI-3)", () => {
    const p = plan([cells({ tag: "BR-LT-0946", model: "Dell", category: "Laptops", cost: 20_000_000 })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number" });
  });

  it("blocks a text cost over the ceiling using a value the two-decimal check would not catch first (NI-3)", () => {
    const p = plan([cells({ tag: "BR-LT-0947", model: "Dell", category: "Laptops", cost: "20000000.00" })]);
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

  // The fifth option (round 2): a row with NO Assigned-to at all (not a drop
  // — there was never anything to drop) hits the SAME "Deployed with no
  // holder" end state. Before this option existed, that end state was
  // hard-blocked here and auto-resolved to SPARE one branch above, differing
  // only in WHY there's no holder — a legacy fleet import with a
  // half-filled Assigned-to column would hit a wall on rows the system would
  // cheerfully have made SPARE had a name merely failed to resolve instead.
  it("downgrades to SPARE via importUnheldAsSpare when there was no holder to drop in the first place (fifth option)", () => {
    const p = plan(
      [cells({ tag: "BR-LT-0949", model: "Dell", category: "Laptops", status: "DEPLOYED" })],
      { ...OPTS, importUnheldAsSpare: true },
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
    // The exact key set, not two spot checks: `notes` and `vendorId` were
    // pinned while `cost`, `typeId`, `serial`, `purchasedAt` and
    // `warrantyUntil` were not — and C-7 is a Critical about destructive
    // writes, one of whose fields is money. This assertion cannot rot as
    // fields are added.
    expect(Object.keys(data1 ?? {}).sort()).toEqual(["categoryId", "model"]);

    const p2 = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", notes: "" })]);
    const data2 = p2.rows[0].kind === "update" ? p2.rows[0].data : null;
    expect(data2 && "notes" in data2).toBe(true);
    expect(data2?.notes).toBeNull();
  });

  it("carries a present, non-blank column through to the update patch", () => {
    const p = plan([cells({ tag: "BR-LT-0148", model: "Dell XPS", category: "Laptops", notes: "Repaired keyboard" })]);
    expect(p.rows[0]).toMatchObject({ kind: "update", data: { notes: "Repaired keyboard" } });
  });

  // NI-6: renamed from `value-too-long` — this exact case (a model that is
  // too SHORT) is why: the old name stated the opposite of the problem.
  // Task 11 round two minor: `detail` feeds the page's "e.g. <value>" line,
  // and every other cause in this module passes the offending VALUE, never
  // the column name — so these assert the actual cell content lands there,
  // not "Model"/"Serial"/"Notes" (field names presented as example values).
  it("blocks a model shorter than 2 characters", () => {
    const p = plan([cells({ tag: "BR-LT-0930", model: "X", category: "Laptops" })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "value-out-of-range", detail: "X" });
  });

  it("blocks a serial over 120 characters", () => {
    const longSerial = "S".repeat(121);
    const p = plan([cells({ tag: "BR-LT-0931", model: "Dell", category: "Laptops", serial: longSerial })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "value-out-of-range", detail: longSerial });
  });

  it("blocks notes over 2000 characters", () => {
    const longNotes = "N".repeat(2001);
    const p = plan([cells({ tag: "BR-LT-0932", model: "Dell", category: "Laptops", notes: longNotes })]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "value-out-of-range", detail: longNotes });
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
