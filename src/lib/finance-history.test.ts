import { describe, expect, it } from "vitest";
import { depreciate, type Policy } from "./depreciation";
import {
  buildHistory, depLines, historyRef, historyVerb, isFinanceRelevant, HISTORY_KINDS, type AuditRow,
} from "./finance-history";

/*
 * Phase 47 (Task 4, spec §4.5): the Financial history tab — the asset's audit entries, its purchase record's entries,
 * and one derived System line per depreciation month counted; refs, Manila day keys, kinds, people, filters, paging.
 */

const M = (y: number, m: number) => y * 12 + (m - 1);
const policy: Policy = { lifeMonths: 36, salvage: 0, basis: "category" };
const CTX = { assetTag: "IT-0042", categoryName: "Laptops", purchaseUnits: 3 };

function row(extra: Partial<AuditRow> & { id: string }): AuditRow {
  return {
    actorId: "u-ana", actorLabel: "Ana Cruz", actorEmail: "ana@example.test", actorRole: "finance_staff",
    entityType: "asset", entityId: "a1", action: "update", diff: null, source: null, reason: null,
    createdAt: new Date("2026-10-01T02:00:00Z"),
    ...extra,
  };
}

const confirm = row({
  id: "cmabc123xyz9k2", action: "finance.confirm",
  diff: { financeConfirmed: { from: null, to: "Ana Cruz" } }, createdAt: new Date("2026-01-10T02:00:00Z"),
});
const lateNight = row({
  id: "cmlate000000zz77", action: "update", diff: { cost: { from: 30000, to: 36000 } },
  actorId: "u-ben", actorLabel: "Ben Reyes", actorEmail: "ben@example.test", actorRole: "it_staff",
  createdAt: new Date("2026-10-20T17:30:00Z"), // 21 Oct 01:30 in Manila
});
const fee = row({
  id: "cmfee00000000fee1", entityType: "purchase-record", entityId: "pr1", action: "purchase.recorded",
  actorId: "u-pia", actorLabel: "Pia Lim", actorEmail: "pia@example.test", actorRole: "purchasing_staff",
  diff: { quantity: { from: null, to: 3 }, total: { from: null, to: "108500.00" } },
  createdAt: new Date("2025-12-15T03:00:00Z"),
});
const sendBack = row({
  id: "cmret00000000ret1", action: "finance.return",
  diff: { financeReturn: { from: null, to: { fields: ["Cost"], note: "Invoice total differs" } } },
  createdAt: new Date("2026-01-05T02:00:00Z"),
});
const override = row({
  id: "cmovr00000000ovr1", action: "depreciation.override", source: "cris", reason: "Heavy field use",
  diff: { lifeMonths: { from: null, to: 24 }, salvage: { from: null, to: 1000 }, note: { from: null, to: "Heavy field use" } },
  createdAt: new Date("2026-03-02T02:00:00Z"),
});
const imported = row({
  id: "cmimp00000000imp1", action: "import-update", actorId: "u-ana",
  diff: { purchasedAt: { from: null, to: "2025-12-15T00:00:00.000Z" } }, createdAt: new Date("2026-02-01T02:00:00Z"),
});
const doc = row({
  id: "cmdoc00000000doc1", action: "document.uploaded", diff: { document: { from: null, to: "invoice.pdf" } },
  createdAt: new Date("2026-01-06T02:00:00Z"),
});
const note = row({
  id: "cmnot00000000not1", action: "note.posted", reason: null, source: "web",
  createdAt: new Date("2026-04-02T02:00:00Z"),
});
const odd = row({ id: "cmodd00000000odd1", action: "custom.thing-done", createdAt: new Date("2026-04-03T02:00:00Z") });
const system = row({
  id: "cmsys00000000sys1", action: "finance.reopened", actorId: null, actorLabel: "System", actorEmail: null, actorRole: null,
  source: "system", diff: { cost: { from: null, to: 36000 } }, createdAt: new Date("2026-04-04T02:00:00Z"),
});

const ENTRIES = [confirm, lateNight, fee, sendBack, override, imported, doc, note, odd, system];
const START = M(2025, 12);
const AS_OF = M(2026, 10);
const DEP = depLines(depreciate(3_600_000, START, policy, AS_OF), START, AS_OF, confirm.createdAt);

describe("historyRef", () => {
  it("is AUD-<yyyymmdd Manila>-<last 6 of id, upper case>", () => {
    expect(historyRef("cmabc123xyz9k2", new Date("2026-01-10T02:00:00Z"))).toBe("AUD-20260110-XYZ9K2");
    expect(historyRef("cmlate000000zz77", new Date("2026-10-20T17:30:00Z"))).toBe("AUD-20261021-00ZZ77");
  });
});

describe("depLines", () => {
  it("one System line per counted month, start through this month", () => {
    expect(DEP).toHaveLength(11); // Dec 2025 … Oct 2026
    expect(DEP[0].label).toBe("December 2025");
    expect(DEP[10].label).toBe("October 2026");
    expect(DEP[0]).toMatchObject({ chargeC: 100_000, accFromC: 0, accToC: 100_000, bookFromC: 3_600_000, bookToC: 3_500_000 });
    expect(DEP[10].accToC).toBe(depreciate(3_600_000, START, policy, AS_OF).accumulated);
  });

  it("a month counted before the approval is dated at the approval; later months at their first day (Manila)", () => {
    expect(DEP[0].at.toISOString()).toBe(confirm.createdAt.toISOString()); // Dec 2025, caught up at approval
    expect(DEP[1].at.toISOString()).toBe(confirm.createdAt.toISOString()); // Jan 2026 began before the 10 Jan approval
    expect(DEP[2].at.toISOString()).toBe("2026-01-31T16:00:00.000Z"); // 1 Feb 2026 00:00 Manila
  });

  it("stops at the end of the life, and nothing when not started or no schedule", () => {
    const late = M(2030, 1);
    expect(depLines(depreciate(3_600_000, START, policy, late), START, late)).toHaveLength(36);
    expect(depLines(depreciate(3_600_000, null, policy, AS_OF), null, AS_OF)).toEqual([]);
    expect(depLines(depreciate(3_600_000, M(2027, 1), policy, AS_OF), M(2027, 1), AS_OF)).toEqual([]);
    expect(depLines(null, START, AS_OF)).toEqual([]);
    expect(depLines(depreciate(3_600_000, START, null, AS_OF), START, AS_OF)).toEqual([]);
  });
});

describe("buildHistory", () => {
  const all = (filters = {}) => buildHistory(ENTRIES, DEP, { pageSize: 1000, ...filters }, CTX);

  it("rows carry ref, Manila day and time, actor and role, account and source", () => {
    const r = all().rows.find((x) => x.id === lateNight.id)!;
    expect(r).toMatchObject({
      ref: "AUD-20261021-00ZZ77", day: "2026-10-21", time: "01:30", actor: "Ben Reyes", role: "IT",
      kind: "cost", account: "ben@example.test", source: "web", sourceLabel: "Web app", related: "Asset IT-0042",
    });
    expect(r.exact).toContain("Asia/Manila");
    expect(r.changes).toEqual([{ field: "cost", from: "₱30,000.00", to: "₱36,000.00" }]);
  });

  it("newest first; day keys group by the Manila calendar day", () => {
    const rows = all().rows;
    const times = rows.map((r) => r.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(rows[0].id).toBe(lateNight.id);
    expect(new Set(rows.map((r) => r.day)).has("2026-10-21")).toBe(true);
    expect(rows.find((r) => r.id === confirm.id)!.day).toBe("2026-01-10");
  });

  it("includes the purchase record's entry as a cost change related to the purchase", () => {
    const r = all().rows.find((x) => x.id === fee.id)!;
    expect(r).toMatchObject({ kind: "cost", actor: "Pia Lim", role: "Purchasing", related: "Purchase record (3 units)" });
    expect(r.verb).toBe("recorded the purchase");
    expect(r.changes).toEqual([
      { field: "total", from: "—", to: "₱108,500.00" },
      { field: "units", from: "—", to: "3" },
    ]);
  });

  it("kinds, verbs, reasons and sources per action", () => {
    const by = (id: string) => all().rows.find((x) => x.id === id)!;
    expect(by(confirm.id)).toMatchObject({ kind: "approval", verb: "approved the asset for depreciation", changes: [] });
    expect(by(sendBack.id)).toMatchObject({ kind: "review", verb: "sent the asset back", reason: "Invoice total differs" });
    expect(by(override.id)).toMatchObject({
      kind: "settings", verb: "set a custom depreciation", reason: "Heavy field use", source: "cris", sourceLabel: "Cris assistant",
    });
    expect(by(override.id).changes).toEqual([
      { field: "salvage", from: "—", to: "₱1,000.00" },
      { field: "useful life", from: "—", to: "2 years" },
    ]);
    expect(by(imported.id)).toMatchObject({ kind: "cost", source: "import", sourceLabel: "Import" });
    expect(by(imported.id).changes).toEqual([{ field: "purchase date", from: "—", to: "15 Dec 2025" }]);
    expect(by(doc.id)).toMatchObject({ kind: "docs", verb: "uploaded invoice.pdf" });
    expect(by(note.id)).toMatchObject({ kind: "notes", verb: "added a note" });
    expect(by(odd.id).verb).toBe("custom thing done");
    expect(by(system.id)).toMatchObject({ actor: "System", role: null, account: null, source: "system", sourceLabel: "Nightly job" });
  });

  it("depreciation lines read as System counting the month, with accumulated and book-value chips", () => {
    const r = all().rows.find((x) => x.kind === "dep" && x.verb.includes("October 2026"))!;
    expect(r).toMatchObject({ actor: "System", role: null, verb: "counted October 2026 depreciation", source: "system", ref: "DEP-202610" });
    expect(r.changes).toEqual([
      { field: "accumulated", from: "₱10,000.00", to: "₱11,000.00" },
      { field: "book value", from: "₱26,000.00", to: "₱25,000.00" },
    ]);
  });

  it("counts per kind, the actor list (System last) and the total", () => {
    const h = all();
    // the unknown action falls back to Reviews
    expect(h.counts).toEqual({ approval: 2, review: 2, cost: 3, settings: 1, docs: 1, notes: 1, dep: 11 });
    expect(Object.keys(h.counts).sort()).toEqual([...HISTORY_KINDS].sort());
    expect(h.actors).toEqual(["Ana Cruz", "Ben Reyes", "Pia Lim", "System"]);
    expect(h.total).toBe(ENTRIES.length + 11);
  });

  it("filters by kind and by person; counts follow the person, not the kind", () => {
    const dep = all({ kind: "dep" });
    expect(dep.total).toBe(11);
    expect(dep.rows.every((r) => r.kind === "dep")).toBe(true);
    const ana = all({ person: "Ana Cruz" });
    expect(ana.rows.every((r) => r.actor === "Ana Cruz")).toBe(true);
    expect(ana.total).toBe(7);
    expect(ana.counts.dep).toBe(0);
    const sys = all({ person: "System", kind: "dep" });
    expect(sys.total).toBe(11);
    expect(all({ person: "System" }).total).toBe(12);
  });

  it("pages 10 at a time, newest first, with x–y of N", () => {
    const p1 = buildHistory(ENTRIES, DEP, {}, CTX);
    expect(p1).toMatchObject({ page: 1, pages: 3, from: 1, to: 10, total: 21 });
    expect(p1.rows).toHaveLength(10);
    const p3 = buildHistory(ENTRIES, DEP, { page: 3 }, CTX);
    expect(p3).toMatchObject({ page: 3, from: 21, to: 21 });
    expect(p3.rows).toHaveLength(1);
    const full = all().rows.map((r) => r.id);
    expect(buildHistory(ENTRIES, DEP, { page: 2 }, CTX).rows.map((r) => r.id)).toEqual(full.slice(10, 20));
    expect(buildHistory(ENTRIES, DEP, { page: 99 }, CTX).page).toBe(3); // clamped
    expect(buildHistory([], [], {}, CTX)).toMatchObject({ rows: [], total: 0, page: 1, pages: 1, from: 0, to: 0 });
  });
});

describe("isFinanceRelevant / historyVerb", () => {
  it("keeps finance actions and purchase-record entries; drops non-finance updates and lifecycle", () => {
    expect(isFinanceRelevant({ entityType: "asset", action: "update", diff: { cost: { from: 1, to: 2 } } })).toBe(true);
    expect(isFinanceRelevant({ entityType: "asset", action: "update", diff: { location: { from: "a", to: "b" } } })).toBe(false);
    expect(isFinanceRelevant({ entityType: "asset", action: "lifecycle.assign", diff: null })).toBe(false);
    expect(isFinanceRelevant({ entityType: "purchase-record", action: "anything", diff: null })).toBe(true);
    expect(isFinanceRelevant({ entityType: "asset", action: "it.verify", diff: null })).toBe(true);
  });

  it("not capitalised reads as such", () => {
    expect(historyVerb({ entityType: "asset", action: "finance.confirm", diff: { notCapitalised: { from: false, to: true } } }))
      .toBe("approved the asset as not capitalised");
  });
});
