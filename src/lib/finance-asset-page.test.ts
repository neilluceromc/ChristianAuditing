import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSET_PAGE_STATE, assetHistory, assetPageHref, fmtFileSize, historyCsv, lifeSummary, noScheduleReason, parseAssetPageState,
  previewKind, shortMonthLabel,
} from "./finance-asset-page";
import type { AuditRow, HistoryRow } from "./finance-history";
import type { DepResult } from "./depreciation";

/*
 * Phase 47 (Task 7, spec §4): the Finance asset page's URL state (tab, year, doc, hk, hw, hp, ak, att), the left
 * panel's life summary, file sizes, which files preview inline, and the history log's CSV.
 */

const sp = (q: string) => new URLSearchParams(q);
const M = (y: number, m: number) => y * 12 + (m - 1);

describe("parseAssetPageState", () => {
  it("defaults: the ledger tab, the default year, no preview, every kind, everyone, page 1", () => {
    expect(parseAssetPageState(sp(""))).toEqual(DEFAULT_ASSET_PAGE_STATE);
    expect(DEFAULT_ASSET_PAGE_STATE).toEqual({
      tab: "ledger", year: null, doc: null, hk: "all", hw: null, hp: 1, ak: "all", att: null,
    });
  });
  it("reads every param, and drops the values it does not know", () => {
    expect(parseAssetPageState(sp("tab=history&year=2027&doc=d1&hk=cost&hw=u1&hp=3&ak=photo&att=a1"))).toEqual({
      tab: "history", year: 2027, doc: "d1", hk: "cost", hw: "u1", hp: 3, ak: "photo", att: "a1",
    });
    expect(parseAssetPageState(sp("tab=bogus&year=soon&hk=nope&hp=-4&ak=receipt&hw=%20%20"))).toEqual(DEFAULT_ASSET_PAGE_STATE);
    expect(parseAssetPageState(sp("year=all")).year).toBe("all");
    expect(parseAssetPageState(sp("tab=files")).tab).toBe("files");
    expect(parseAssetPageState(sp("tab=notes")).tab).toBe("notes");
  });
});

describe("assetPageHref", () => {
  it("omits the defaults, in a stable order", () => {
    expect(assetPageHref("a1", DEFAULT_ASSET_PAGE_STATE)).toBe("/finance/assets/a1");
    expect(assetPageHref("a1", DEFAULT_ASSET_PAGE_STATE, { tab: "history", hk: "cost", hp: 2, hw: "u 1" }))
      .toBe("/finance/assets/a1?tab=history&hk=cost&hw=u+1&hp=2");
    expect(assetPageHref("a1", DEFAULT_ASSET_PAGE_STATE, { year: "all" })).toBe("/finance/assets/a1?year=all");
    expect(assetPageHref("a1", DEFAULT_ASSET_PAGE_STATE, { tab: "files", ak: "photo", att: "x", doc: "d" }))
      .toBe("/finance/assets/a1?tab=files&doc=d&ak=photo&att=x");
  });
  it("round-trips through the parser", () => {
    const s = { tab: "history", year: 2027, doc: "d1", hk: "dep", hw: "system", hp: 4, ak: "quotation", att: "a9" } as const;
    expect(parseAssetPageState(new URL(`http://x${assetPageHref("a1", s)}`).searchParams)).toEqual(s);
  });
  it("encodes the asset id", () => {
    expect(assetPageHref("a/b", DEFAULT_ASSET_PAGE_STATE)).toBe("/finance/assets/a%2Fb");
  });
});

describe("lifeSummary (the left panel's ring, bar and words)", () => {
  const result = (over: Partial<DepResult>): DepResult => ({
    state: "depreciating", cost: 3_600_000, accumulated: 1_400_000, bookValue: 2_200_000, monthly: 100_000,
    startMonth: M(2025, 9), policy: { lifeMonths: 36, salvage: 0, basis: "category" }, ...over,
  });
  it("months left, the end month in short form, the used and depreciated shares", () => {
    expect(lifeSummary(result({}), 14)).toEqual({
      usedPct: 39, monthsUsed: 14, lifeMonths: 36, monthsLeft: 22, endsLabel: "Aug 2028",
      costC: 3_600_000, accC: 1_400_000, bookC: 2_200_000, monthlyC: 100_000, depreciatedPct: 39,
    });
  });
  it("is null with no schedule: no result, no policy, no start, or not started", () => {
    expect(lifeSummary(null, null)).toBeNull();
    expect(lifeSummary(result({ policy: null, state: "no-policy" }), null)).toBeNull();
    expect(lifeSummary(result({ startMonth: null, state: "not-started" }), null)).toBeNull();
    expect(lifeSummary(result({ state: "not-started", accumulated: 0 }), 0)).toBeNull();
  });
  it("a fully depreciated asset is 100% with nothing left", () => {
    const s = lifeSummary(result({ state: "fully-depreciated", accumulated: 3_600_000, bookValue: 0 }), 36)!;
    expect(s.usedPct).toBe(100);
    expect(s.monthsLeft).toBe(0);
    expect(s.depreciatedPct).toBe(100);
  });
});

describe("noScheduleReason (the ledger's empty state)", () => {
  const base = { notCapitalised: false, costC: 100, approvedAt: new Date(), note: "No policy for Laptops" };
  it("not capitalised, then no cost, then not approved, then the engine's note", () => {
    expect(noScheduleReason({ ...base, notCapitalised: true, costC: null })).toMatch(/^Not capitalised/);
    expect(noScheduleReason({ ...base, costC: null, approvedAt: null })).toMatch(/^No cost recorded/);
    expect(noScheduleReason({ ...base, approvedAt: null })).toMatch(/^Not approved yet/);
    expect(noScheduleReason(base)).toBe("No policy for Laptops");
    expect(noScheduleReason({ ...base, note: null })).toBe("This asset has no depreciation schedule.");
  });
});

describe("small formatters", () => {
  it("shortMonthLabel", () => {
    expect(shortMonthLabel(M(2029, 9))).toBe("Sep 2029");
    expect(shortMonthLabel(M(2026, 1))).toBe("Jan 2026");
  });
  it("fmtFileSize: bytes, KB, MB; null is a dash", () => {
    expect(fmtFileSize(null)).toBe("—");
    expect(fmtFileSize(512)).toBe("512 B");
    expect(fmtFileSize(2_048)).toBe("2 KB");
    expect(fmtFileSize(1_536_000)).toBe("1.5 MB");
    expect(fmtFileSize(4_000_000)).toBe("4 MB");
  });
  it("previewKind: PDFs in a frame, PNG and JPG as images, anything else downloads", () => {
    expect(previewKind("a.PDF")).toBe("pdf");
    expect(previewKind("b.png")).toBe("image");
    expect(previewKind("c.jpeg")).toBe("image");
    expect(previewKind("d.JPG")).toBe("image");
    expect(previewKind("e.docx")).toBeNull();
    expect(previewKind("noext")).toBeNull();
  });
});

describe("assetHistory (the person filter)", () => {
  const audit = (id: string, actorId: string | null): AuditRow => ({
    id, actorId, actorLabel: actorId ?? "System", actorEmail: null, actorRole: null, entityType: "asset", entityId: "a1",
    action: "finance.confirm", diff: null, source: "web", reason: null, createdAt: new Date("2026-10-01T00:00:00Z"),
  });
  const rows = [audit("e1", "u1"), audit("e2", "u2")];
  const ctx = { assetTag: "IT-0001" };
  it("a known person filters", () => {
    const r = assetHistory(rows, [], { hk: "all", hw: "u1", hp: 1 }, ctx);
    expect(r.hw).toBe("u1");
    expect(r.history.total).toBe(1);
  });
  it("an unknown person is Everyone, and says so", () => {
    const r = assetHistory(rows, [], { hk: "all", hw: "gone", hp: 1 }, ctx);
    expect(r.hw).toBeNull();
    expect(r.history.total).toBe(2);
  });
  it("a page size reaches buildHistory (the export takes every row)", () => {
    expect(assetHistory(rows, [], { hk: "all", hw: null, hp: 1 }, ctx, 1).history.rows).toHaveLength(1);
  });
});

describe("historyCsv (Export log)", () => {
  const row = (over: Partial<HistoryRow>): HistoryRow => ({
    id: "e1", ref: "AUD-20261021-ABC123", at: new Date("2026-10-21T01:02:03Z"), day: "2026-10-21",
    dayLabel: "Wed 21 Oct 2026", time: "09:02", exact: "2026-10-21 09:02:03 GMT+8 (Asia/Manila)",
    actor: "Ana Cruz", actorKey: "u1", role: "Finance", kind: "cost", verb: "changed the cost",
    changes: [{ field: "cost", from: "₱1.00", to: "₱2.00" }], reason: null, source: "web", sourceLabel: "Web app",
    account: "ana@example.com", related: "Asset IT-0001", ...over,
  });
  it("one header line, then one CRLF line per entry, with a BOM for spreadsheets", () => {
    const csv = historyCsv([row({}), row({ id: "e2", reason: "Wrong, \"typo\"" })]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Reference,Exact time,Who,Role,Kind,What,Changes,Reason,Source,Signed in as,Related");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      "AUD-20261021-ABC123,2026-10-21 09:02:03 GMT+8 (Asia/Manila),Ana Cruz,Finance,Cost,changed the cost,cost: ₱1.00 → ₱2.00,,Web app,ana@example.com,Asset IT-0001",
    );
    expect(lines[2]).toContain(',"Wrong, ""typo""",');
  });
  it("a cell a spreadsheet would read as a formula stays text", () => {
    const csv = historyCsv([row({ reason: "=HYPERLINK(1)", actor: "+Bob" })]);
    expect(csv).toContain(",'=HYPERLINK(1),");
    expect(csv).toContain(",'+Bob,");
  });
  it("an empty log is the header alone", () => {
    expect(historyCsv([]).slice(1).split("\r\n")).toHaveLength(1);
  });
});
