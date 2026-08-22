import { describe, expect, it } from "vitest";
import { matchHeaders, planAssetRows, type AssetRefs, type ImportOptions } from "./import-assets";

const HEADER = ["Tag", "Model", "Serial", "Category", "Type", "Status", "Assigned to", "Purchased", "Cost"];

const REFS: AssetRefs = {
  categories: new Map([["laptops", "cat-1"]]),
  types: new Map([["macbook pro", "typ-1"]]),
  employees: new Map([["emp-0042", "e-1"], ["marites bautista", "e-1"]]),
  vendors: new Map([["acme", "v-1"]]),
  byTag: new Map([["BR-LT-0148", { id: "a-1", serial: "SN-OLD" }]]),
  bySerial: new Map([["SN-TAKEN", "a-9"]]),
};

const OPTS: ImportOptions = { treatDuplicateSerialAsUpdate: false, dropUnknownAssignee: false };

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
  // columns we don't want, and refusing the file over them is useless pedantry.
  it("ignores columns it does not recognise, and reports them separately", () => {
    const m = matchHeaders([...HEADER, "Their internal ref"]);
    expect(m.missing).toEqual([]);
    expect(m.unknown).toEqual(["Their internal ref"]);
  });
});

describe("planAssetRows", () => {
  const plan = (cells: unknown[][], opts: ImportOptions = OPTS) =>
    planAssetRows(matchHeaders(HEADER), cells, REFS, opts);

  it("creates a clean new row", () => {
    const p = plan([["BR-LT-0900", "Dell XPS", "SN-1", "Laptops", "MacBook Pro", "SPARE", "", "2026-01-05", "51000.50"]]);
    expect(p.counts).toEqual({ create: 1, update: 0, blocked: 0 });
    expect(p.rows[0]).toMatchObject({ kind: "create", row: 2 });
  });

  // A known tag is an UPDATE, not a duplicate error — that is what makes
  // re-uploading a corrected sheet the obvious workflow.
  it("treats a known tag as an update, carrying the existing asset id", () => {
    const p = plan([["BR-LT-0148", "Dell XPS", "SN-OLD", "Laptops", "", "", "", "", ""]]);
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-1" });
    expect(p.counts.update).toBe(1);
  });

  it("blocks a row whose serial belongs to a different asset", () => {
    const p = plan([["BR-LT-0901", "Dell", "SN-TAKEN", "Laptops", "", "", "", "", ""]]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "duplicate-serial", detail: "SN-TAKEN" });
  });

  it("turns that block into an update when the operator picks that fix", () => {
    const p = plan([["BR-LT-0901", "Dell", "SN-TAKEN", "Laptops", "", "", "", "", ""]], {
      ...OPTS,
      treatDuplicateSerialAsUpdate: true,
    });
    expect(p.rows[0]).toMatchObject({ kind: "update", assetId: "a-9" });
  });

  it("blocks a missing tag, an unknown category and an unknown type separately", () => {
    const p = plan([
      ["", "Dell", "", "Laptops", "", "", "", "", ""],
      ["BR-LT-0902", "Dell", "", "Chairs", "", "", "", "", ""],
      ["BR-LT-0903", "Dell", "", "Laptops", "Ergo Chair", "", "", "", ""],
    ]);
    expect(p.rows.map((r) => (r.kind === "blocked" ? r.cause : r.kind))).toEqual([
      "missing-tag",
      "unknown-category",
      "unknown-type",
    ]);
  });

  it("resolves an assignee by employee number OR by name, case-insensitively", () => {
    for (const who of ["EMP-0042", "marites bautista"]) {
      expect(plan([["BR-LT-0904", "Dell", "", "Laptops", "", "", who, "", ""]]).rows[0]).toMatchObject({
        kind: "create",
      });
    }
  });

  it("blocks an unknown assignee, and drops it instead when that fix is picked", () => {
    const row = [["BR-LT-0905", "Dell", "", "Laptops", "", "", "Nobody Here", "", ""]];
    expect(plan(row).rows[0]).toMatchObject({ kind: "blocked", cause: "unknown-assignee" });
    const dropped = plan(row, { ...OPTS, dropUnknownAssignee: true });
    expect(dropped.rows[0]).toMatchObject({ kind: "create" });
    expect(dropped.rows[0].kind === "create" && dropped.rows[0].data.assigneeId).toBeNull();
  });

  it("accepts a real Date cell and a YYYY-MM-DD string, and blocks anything else", () => {
    const withDate = (v: unknown) => plan([["BR-LT-0906", "Dell", "", "Laptops", "", "", "", v, ""]]).rows[0];
    expect(withDate(new Date("2026-01-05T00:00:00Z"))).toMatchObject({ kind: "create" });
    expect(withDate("2026-01-05")).toMatchObject({ kind: "create" });
    expect(withDate("5 Jan 26")).toMatchObject({ kind: "blocked", cause: "bad-date" });
  });

  it("blocks a cost that is not a plain number, naming the offending text", () => {
    const p = plan([["BR-LT-0907", "Dell", "", "Laptops", "", "", "", "", "PHP 51,000"]]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number", detail: "PHP 51,000" });
  });

  // A thousands-separator amount is the distinguishing case a lenient
  // parseFloat would miss: parseFloat("51,000.00") reads "51" and stops at the
  // comma instead of rejecting the rest, so a naive numeric check would let a
  // wrong value through silently. The strict shape must not.
  it("blocks a cost with a thousands separator rather than truncate-reading it", () => {
    const p = plan([["BR-LT-0914", "Dell", "", "Laptops", "", "", "", "", "51,000.00"]]);
    expect(p.rows[0]).toMatchObject({ kind: "blocked", cause: "bad-number", detail: "51,000.00" });
  });

  // Money stays a STRING all the way to Prisma, which builds the Decimal.
  // §8's floating-point lesson: no float ever touches a peso amount.
  it("keeps a valid cost as a string, never a number", () => {
    const p = plan([["BR-LT-0913", "Dell", "", "Laptops", "", "", "", "", "51000.50"]]);
    expect(p.rows[0].kind === "create" && p.rows[0].data.cost).toBe("51000.50");
  });

  it("blocks an unrecognised status but reads a blank one as SPARE", () => {
    expect(plan([["BR-LT-0908", "Dell", "", "Laptops", "", "BROKEN", "", "", ""]]).rows[0]).toMatchObject({
      kind: "blocked",
      cause: "bad-status",
    });
    const blank = plan([["BR-LT-0909", "Dell", "", "Laptops", "", "", "", "", ""]]).rows[0];
    expect(blank).toMatchObject({ kind: "create" });
    expect(blank.kind === "create" && blank.data.status).toBe("SPARE");
  });

  // Partial import is the DEFAULT (scope decision 4): a bad row must not cost
  // the good rows around it.
  it("keeps the good rows in a file that also has bad ones", () => {
    const p = plan([
      ["BR-LT-0910", "Dell", "", "Laptops", "", "", "", "", ""],
      ["", "Dell", "", "Laptops", "", "", "", "", ""],
      ["BR-LT-0911", "Dell", "", "Laptops", "", "", "", "", ""],
    ]);
    expect(p.counts).toEqual({ create: 2, update: 0, blocked: 1 });
  });

  // Row numbers are what the operator uses to find the row in Excel, where the
  // header is row 1 — so a data row reports its SHEET row, not its index.
  it("reports sheet row numbers, counting the header", () => {
    const p = plan([
      ["", "Dell", "", "Laptops", "", "", "", "", ""],
      ["", "Dell", "", "Laptops", "", "", "", "", ""],
    ]);
    expect(p.rows.map((r) => r.row)).toEqual([2, 3]);
  });

  it("skips a wholly blank row rather than blocking it — trailing blanks are normal", () => {
    const p = plan([
      ["BR-LT-0912", "Dell", "", "Laptops", "", "", "", "", ""],
      [null, null, null, null, null, null, null, null, null],
      ["", "", "", "", "", "", "", "", ""],
    ]);
    expect(p.counts).toEqual({ create: 1, update: 0, blocked: 0 });
    expect(p.rows).toHaveLength(1);
  });

  it("reports one cause per row, so groupByCause counts each row once", () => {
    // Missing tag AND unknown category on the same row: the first check wins.
    const p = plan([["", "Dell", "", "Chairs", "", "", "", "", ""]]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ cause: "missing-tag" });
  });
});
