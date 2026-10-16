import { describe, expect, it } from "vitest";
import { manilaMonth } from "./depreciation";
import {
  bookValueC, canSeeMoney, defaultReportSort, equippedTone, filterReportGroups, groupHasBasePolicy, reportFilterCounts, reportPeopleByGroup,
  reportTotals, sortReportGroups, summariseGroup,
  type GroupSummary, type ReportAsset, type ReportPerson,
} from "./equipment-report";

const asOf = manilaMonth(new Date("2026-10-17T04:00:00Z"));
const group = { id: "g1", name: "Acme", kind: "CLIENT" as const, hasBasePolicy: false };
const withBase = { ...group, hasBasePolicy: true };

const laptopSlot = { id: "s1", name: "Laptop", assetTypeId: "t-laptop", required: true, loaner: false };
const monitorSlot = { id: "s2", name: "Monitor", assetTypeId: "t-monitor", required: true, loaner: false };
const monitor2Slot = { id: "s3", name: "Monitor", assetTypeId: "t-monitor", required: true, loaner: false };
const optionalSlot = { id: "s4", name: "Headset", assetTypeId: "t-headset", required: false, loaner: false };

const noDep = { lifeMonths: null, salvage: null, catLifeMonths: null, catSalvagePercent: null };
const asset = (id: string, typeId: string | null, over: Partial<ReportAsset> = {}): ReportAsset => ({
  id, tag: id, typeId, categoryName: "Laptop", status: "DEPLOYED", loanDueAt: null, costC: null,
  purchasedAt: null, financeConfirmedAt: null, dep: noDep, ...over,
});
const person = (id: string, over: Partial<ReportPerson> = {}): ReportPerson => ({
  id, name: `Person ${id}`, employeeNo: `E-${id}`, title: "Agent", slots: [laptopSlot, monitorSlot], hasPolicy: true, assets: [], ...over,
});
const none = { withMoney: false, asOf };
const money = { withMoney: true, asOf };

describe("canSeeMoney", () => {
  it("is true for admin and finance_staff only", () => {
    expect(canSeeMoney("admin")).toBe(true);
    expect(canSeeMoney("finance_staff")).toBe(true);
    for (const r of ["it_staff", "purchasing_staff", "viewer", "", "ADMIN"]) expect(canSeeMoney(r)).toBe(false);
  });
});

describe("summariseGroup — counts and loans", () => {
  const people = [
    person("1", { assets: [asset("a1", "t-laptop"), asset("a2", "t-monitor", { categoryName: "Monitor" })] }),
    person("2", { assets: [asset("a3", "t-laptop", { status: "TEMPORARY", loanDueAt: new Date("2026-10-30T00:00:00Z") }), asset("a4", "t-mouse", { categoryName: "Mouse", status: "TEMPORARY", loanDueAt: new Date("2026-10-20T00:00:00Z") })] }),
  ];
  const s = summariseGroup(group, people, none);
  it("carries the group's identity and counts people, items and loans", () => {
    expect([s.id, s.name, s.kind]).toEqual(["g1", "Acme", "CLIENT"]);
    expect([s.people, s.items, s.loans]).toEqual([2, 4, 2]);
  });
  it("nextLoanDue is the earliest due date among TEMPORARY assets", () => {
    expect(s.nextLoanDue).toEqual(new Date("2026-10-20T00:00:00Z"));
  });
  it("is null when nothing is on loan, or the loans have no due date", () => {
    expect(summariseGroup(group, [person("1", { assets: [asset("a1", "t-laptop")] })], none).nextLoanDue).toBeNull();
    const undated = person("1", { assets: [asset("a1", "t-laptop", { status: "TEMPORARY" })] });
    const r = summariseGroup(group, [undated], none);
    expect([r.loans, r.nextLoanDue]).toEqual([1, null]);
  });
});

describe("summariseGroup — who is missing something", () => {
  it("lists people with a required gap, with their numbered labels; the complete are left out", () => {
    const full = person("1", { assets: [asset("a1", "t-laptop"), asset("a2", "t-monitor")] });
    const partial = person("2", { slots: [laptopSlot, monitorSlot, monitor2Slot], assets: [asset("b1", "t-laptop"), asset("b2", "t-monitor")] });
    const s = summariseGroup(group, [full, partial], none);
    expect(s.missing).toEqual([{ id: "2", name: "Person 2", employeeNo: "E-2", labels: ["Monitor 2"] }]);
  });
  it("numbers over every slot in policy order, so an empty first Monitor keeps the plain label", () => {
    const p = person("1", { slots: [monitorSlot, monitor2Slot, laptopSlot], assets: [] });
    expect(summariseGroup(group, [p], none).missing[0].labels).toEqual(["Monitor", "Monitor 2", "Laptop"]);
  });
  it("an empty optional slot is not a gap", () => {
    const p = person("1", { slots: [laptopSlot, optionalSlot], assets: [asset("a1", "t-laptop")] });
    expect(summariseGroup(group, [p], none).missing).toEqual([]);
  });
  it("a slot covered by a loan is not a gap, and its label is left out", () => {
    const p = person("1", { assets: [asset("a1", "t-laptop", { status: "TEMPORARY" })] });
    const s = summariseGroup(group, [p], none);
    expect(s.missing).toEqual([{ id: "1", name: "Person 1", employeeNo: "E-1", labels: ["Monitor"] }]);
  });
});

describe("summariseGroup — a person with no policy", () => {
  it("is never missing something, even if slots were passed", () => {
    const p = person("1", { hasPolicy: false, slots: [laptopSlot, monitorSlot], assets: [] });
    const s = summariseGroup(withBase, [p], none);
    expect(s.missing).toEqual([]);
    expect(s.equippedPct).toBe(100);
  });
});

describe("summariseGroup — equipped %", () => {
  it("is round(100 x (people - missing) / people)", () => {
    const ok = (id: string) => person(id, { assets: [asset(`${id}-l`, "t-laptop"), asset(`${id}-m`, "t-monitor")] });
    const s = summariseGroup(group, [ok("1"), ok("2"), person("3")], none);
    expect(s.equippedPct).toBe(67);
    expect(summariseGroup(group, [ok("1"), ok("2")], none).equippedPct).toBe(100);
    expect(summariseGroup(group, [person("1"), person("2")], none).equippedPct).toBe(0);
  });
  it("is null when nobody in the group has a policy", () => {
    const s = summariseGroup(group, [person("1", { hasPolicy: false, slots: [] })], none);
    expect([s.noPolicy, s.equippedPct]).toEqual([true, null]);
  });
  it("a group base policy keeps it tracked even when nobody resolved to a policy", () => {
    const s = summariseGroup(withBase, [person("1", { hasPolicy: false, slots: [] })], none);
    expect([s.noPolicy, s.equippedPct]).toEqual([false, 100]);
  });
  it("noPolicy is false as soon as one person has a policy", () => {
    const s = summariseGroup(group, [person("1", { hasPolicy: false, slots: [] }), person("2")], none);
    expect([s.noPolicy, s.equippedPct]).toEqual([false, 50]);
  });
});

describe("summariseGroup — empty groups (no NaN, no division by zero)", () => {
  it("a group with a base policy but no people reads 100%, with zero counts and zero money", () => {
    const s = summariseGroup(withBase, [], none);
    expect([s.people, s.items, s.loans, s.nextLoanDue, s.missing, s.byCategory]).toEqual([0, 0, 0, null, [], []]);
    expect([s.noPolicy, s.equippedPct]).toEqual([false, 100]);
    expect(summariseGroup(withBase, [], money).money).toEqual({ costC: 0, bookC: 0, perPersonC: 0, withoutCost: 0 });
  });
  it("a group with no base policy and no people is no policy: equipped is null, money still zero", () => {
    const s = summariseGroup(group, [], none);
    expect([s.noPolicy, s.equippedPct, s.people]).toEqual([true, null, 0]);
    expect(summariseGroup(group, [], money).money).toEqual({ costC: 0, bookC: 0, perPersonC: 0, withoutCost: 0 });
  });
  it("a group whose people hold nothing: nobody has anything, Per person is 0", () => {
    const people = [person("1", { slots: [] }), person("2", { slots: [] })];
    const s = summariseGroup(group, people, money);
    expect([s.people, s.items, s.missing, s.equippedPct]).toEqual([2, 0, [], 100]);
    expect(s.money).toEqual({ costC: 0, bookC: 0, perPersonC: 0, withoutCost: 0 });
  });
  it("people with a policy who hold nothing are all missing: 0%", () => {
    const s = summariseGroup(group, [person("1"), person("2")], money);
    expect([s.equippedPct, s.missing.length, s.items]).toEqual([0, 2, 0]);
    expect(Number.isNaN(s.money?.perPersonC)).toBe(false);
  });
});

describe("summariseGroup — byCategory", () => {
  it("sorts by count descending, then by name", () => {
    const held = [
      asset("1", null, { categoryName: "Mouse" }), asset("2", null, { categoryName: "Monitor" }), asset("3", null, { categoryName: "Monitor" }),
      asset("4", null, { categoryName: "Headset" }), asset("5", null, { categoryName: "Laptop" }), asset("6", null, { categoryName: "Laptop" }),
    ];
    const s = summariseGroup(group, [person("1", { slots: [], assets: held })], none);
    expect(s.byCategory).toEqual([
      { name: "Laptop", count: 2 }, { name: "Monitor", count: 2 }, { name: "Headset", count: 1 }, { name: "Mouse", count: 1 },
    ]);
  });
});

describe("summariseGroup — money for Finance and Admin", () => {
  // 36 months, no salvage, bought 12 Oct 2026 and approved: month 1 of 36 is taken in full by 17 Oct 2026.
  const bought = (id: string, costC: number | null, over: Partial<ReportAsset> = {}) =>
    asset(id, null, {
      costC, purchasedAt: new Date("2026-10-12T02:00:00Z"), financeConfirmedAt: new Date("2026-10-13T02:00:00Z"),
      dep: { lifeMonths: 36, salvage: 0, catLifeMonths: null, catSalvagePercent: null }, ...over,
    });

  it("book value = the depreciation rule at asOf (the user's example: 52,000 over 36 months, 1 month taken)", () => {
    const s = summariseGroup(group, [person("1", { slots: [], assets: [bought("a1", 5_200_000)] })], money);
    expect(s.money).toEqual({ costC: 5_200_000, bookC: 5_055_556, perPersonC: 5_055_556, withoutCost: 0 });
    expect(s.byCategory).toEqual([{ name: "Laptop", count: 1, bookC: 5_055_556 }]);
  });
  it("an asset with no cost counts as 0 and adds to withoutCost; perPersonC rounds over the people", () => {
    const a = person("1", { slots: [], assets: [bought("a1", 5_200_000), bought("a2", null)] });
    const b = person("2", { slots: [], assets: [] });
    const c = person("3", { slots: [], assets: [] });
    const s = summariseGroup(group, [a, b, c], money);
    expect(s.money).toEqual({ costC: 5_200_000, bookC: 5_055_556, perPersonC: 1_685_185, withoutCost: 1 });
  });
  it("a cost of 0 is a cost: only a null cost adds to withoutCost", () => {
    const s = summariseGroup(group, [person("1", { slots: [], assets: [bought("a1", 0), bought("a2", null)] })], money);
    expect(s.money?.withoutCost).toBe(1);
    expect(s.money?.costC).toBe(0);
  });
  it("an asset not yet approved carries its full cost as book value", () => {
    const pending = asset("a1", null, { costC: 100_000, purchasedAt: new Date("2026-10-01T00:00:00Z"), dep: { lifeMonths: 36, salvage: 0, catLifeMonths: null, catSalvagePercent: null } });
    expect(summariseGroup(group, [person("1", { slots: [], assets: [pending] })], money).money?.bookC).toBe(100_000);
  });
  it("uses the category policy when the asset has no override", () => {
    const a = bought("a1", 1_200_000, { dep: { lifeMonths: null, salvage: null, catLifeMonths: 12, catSalvagePercent: 10 } });
    // base 1,080,000 over 12 months = 90,000 a month; one month taken
    expect(summariseGroup(group, [person("1", { slots: [], assets: [a] })], money).money?.bookC).toBe(1_110_000);
  });
  it("a purchase in the future has not started: full cost", () => {
    const future = bought("a1", 1_200_000, { purchasedAt: new Date("2026-12-05T02:00:00Z") });
    expect(summariseGroup(group, [person("1", { slots: [], assets: [future] })], money).money?.bookC).toBe(1_200_000);
  });
  it("sums book value per category", () => {
    const held = [bought("a1", 3_600_000), bought("a2", 3_600_000, { categoryName: "Monitor" }), bought("a3", 3_600_000, { categoryName: "Monitor" })];
    const s = summariseGroup(group, [person("1", { slots: [], assets: held })], money);
    expect(s.byCategory).toEqual([{ name: "Monitor", count: 2, bookC: 7_000_000 }, { name: "Laptop", count: 1, bookC: 3_500_000 }]);
  });
});

describe("summariseGroup — no money without withMoney (Review Focus 1)", () => {
  const held = [asset("a1", "t-laptop", { costC: 5_200_000, purchasedAt: new Date("2026-10-12T02:00:00Z"), financeConfirmedAt: new Date("2026-10-13T02:00:00Z"), dep: { lifeMonths: 36, salvage: 0, catLifeMonths: null, catSalvagePercent: null } })];
  const s = summariseGroup(group, [person("1", { assets: held })], none);
  it("has no money key at all", () => {
    expect("money" in s).toBe(false);
    expect(s.money).toBeUndefined();
  });
  it("has no bookC on byCategory, and the whole object matches the money-free shape exactly", () => {
    expect(s.byCategory).toEqual([{ name: "Laptop", count: 1 }]);
    expect(s.byCategory.every((c) => !("bookC" in c))).toBe(true);
    expect(s).toEqual({
      id: "g1", name: "Acme", kind: "CLIENT", people: 1, items: 1, loans: 0, nextLoanDue: null, noPolicy: false,
      missing: [{ id: "1", name: "Person 1", employeeNo: "E-1", labels: ["Monitor"] }], equippedPct: 0,
      byCategory: [{ name: "Laptop", count: 1 }],
    });
  });
  it("no cost figure appears anywhere in the serialised summary", () => {
    expect(JSON.stringify(s)).not.toMatch(/5200000|5055556|costC|bookC/);
  });
});

describe("the table's filters, counts and sort", () => {
  const row = (id: string, name: string, over: Partial<GroupSummary> = {}): GroupSummary => ({
    id, name, kind: "CLIENT", people: 0, items: 0, loans: 0, nextLoanDue: null, noPolicy: false,
    missing: [], equippedPct: 100, byCategory: [], ...over,
  });
  const gap = { id: "p", name: "P", employeeNo: "E-1", labels: ["Laptop"] };
  const rows = [
    row("a", "Client 10", { people: 5, items: 9, equippedPct: 80, missing: [gap], money: { costC: 0, bookC: 300, perPersonC: 60, withoutCost: 0 } }),
    row("b", "Client 2", { people: 5, items: 2, equippedPct: null, noPolicy: true, money: { costC: 0, bookC: 900, perPersonC: 180, withoutCost: 0 } }),
    row("c", "bluepeak", { people: 12, items: 20, equippedPct: 50, missing: [gap, gap], money: { costC: 0, bookC: 100, perPersonC: 8, withoutCost: 0 } }),
    row("d", "Acme", { people: 1, items: 1, equippedPct: 100 }),
  ];
  const ids = (rs: GroupSummary[]) => rs.map((r) => r.id);

  it("counts All, With gaps and No policy over the tab's rows", () => {
    expect(reportFilterCounts(rows)).toEqual({ all: 4, gaps: 2, nopol: 1 });
  });
  it("filters by gaps or no policy, and by a case-insensitive substring of the name", () => {
    expect(ids(filterReportGroups(rows, { q: "", filter: "gaps" }))).toEqual(["a", "c"]);
    expect(ids(filterReportGroups(rows, { q: "", filter: "nopol" }))).toEqual(["b"]);
    expect(ids(filterReportGroups(rows, { q: " CLIENT ", filter: "all" }))).toEqual(["a", "b"]);
    expect(ids(filterReportGroups(rows, { q: "ent 1", filter: "gaps" }))).toEqual(["a"]);
    expect(filterReportGroups(rows, { q: "zzz", filter: "all" })).toEqual([]);
  });
  it("sorts names in natural order, case-insensitively", () => {
    expect(ids(sortReportGroups(rows, "name", 1))).toEqual(["d", "c", "b", "a"]);
    expect(ids(sortReportGroups(rows, "name", -1))).toEqual(["a", "b", "c", "d"]);
  });
  it("sorts People, Items and Book value with the name breaking ties", () => {
    expect(ids(sortReportGroups(rows, "people", -1))).toEqual(["c", "b", "a", "d"]);
    expect(ids(sortReportGroups(rows, "items", 1))).toEqual(["d", "b", "a", "c"]);
    expect(ids(sortReportGroups(rows, "book", -1))).toEqual(["b", "a", "c", "d"]);
  });
  it("sorts Equipped with no-policy rows last in either direction", () => {
    expect(ids(sortReportGroups(rows, "equipped", -1))).toEqual(["d", "a", "c", "b"]);
    expect(ids(sortReportGroups(rows, "equipped", 1))).toEqual(["c", "a", "d", "b"]);
  });
  it("does not reorder the input", () => {
    sortReportGroups(rows, "people", 1);
    expect(ids(rows)).toEqual(["a", "b", "c", "d"]);
  });
  it("defaults to Book value descending with money, People descending without", () => {
    expect(defaultReportSort(true)).toEqual({ sort: "book", dir: -1 });
    expect(defaultReportSort(false)).toEqual({ sort: "people", dir: -1 });
  });
  it("colours Equipped green at 100%, amber at 80% or more, red below, none for no policy", () => {
    expect(equippedTone(100)).toBe("settled");
    expect(equippedTone(99)).toBe("attention");
    expect(equippedTone(80)).toBe("attention");
    expect(equippedTone(79)).toBe("fault");
    expect(equippedTone(0)).toBe("fault");
    expect(equippedTone(null)).toBeNull();
  });
});

describe("assembling the report from the loaded rows", () => {
  const slot = (id: string, name: string) => ({ id, name, assetTypeId: `t-${id}`, required: true, loaner: false });
  const policies = [
    { id: "base-g1", name: "G1", appliesToTitle: null, appliesToDepartmentId: "g1", slots: [slot("s1", "Laptop"), slot("s2", "Monitor")] },
    { id: "rule-g1", name: "G1 leads", appliesToTitle: "Lead", appliesToDepartmentId: "g1", slots: [slot("s3", "Headset")] },
    { id: "global", name: "Designers", appliesToTitle: "Designer", appliesToDepartmentId: null, slots: [slot("s4", "Tablet")] },
  ];
  const loaded = (id: string, departmentId: string, title: string) => ({ id, name: `P ${id}`, employeeNo: `E-${id}`, title, departmentId, assets: [] });
  const ex = (id: string, employeeId: string, kind: "ADD" | "WAIVE", over = {}) => ({
    id, employeeId, kind, slotId: null, name: null, assetTypeId: null, required: true, loaner: false, ...over,
  });

  it("a group has a base policy only when its own title-less policy exists", () => {
    expect(groupHasBasePolicy("g1", policies)).toBe(true);
    expect(groupHasBasePolicy("g2", policies)).toBe(false);
    expect(groupHasBasePolicy("g2", [{ id: "r", name: "r", appliesToTitle: "Agent", appliesToDepartmentId: "g2" }])).toBe(false);
  });

  it("gives each person the profile's slots and the employees-list policy rule, grouped by their group", () => {
    const people = [
      loaded("1", "g1", "Agent"), // base policy
      loaded("2", "g1", "lead "), // the group's title rule (trimmed, case-insensitive)
      loaded("3", "g2", "Designer"), // a global title policy
      loaded("4", "g2", "Agent"), // nothing, but an ADD exception
      loaded("5", "g2", "Agent"), // nothing, only a WAIVE
      loaded("6", "g2", "Agent"), // nothing at all
    ];
    const exceptions = [
      ex("x1", "1", "WAIVE", { slotId: "s2" }),
      ex("x2", "4", "ADD", { name: "Phone", assetTypeId: "t-phone" }),
      ex("x3", "5", "WAIVE", { slotId: "s1" }),
    ];
    const byGroup = reportPeopleByGroup(people, policies, exceptions);
    expect([...byGroup.keys()].sort()).toEqual(["g1", "g2"]);
    const get = (id: string) => [...byGroup.values()].flat().find((p) => p.id === id)!;
    expect(get("1").slots.map((x) => x.name)).toEqual(["Laptop"]);
    expect(get("2").slots.map((x) => x.name)).toEqual(["Headset"]);
    expect(get("3").slots.map((x) => x.name)).toEqual(["Tablet"]);
    expect(get("4").slots.map((x) => x.name)).toEqual(["Phone"]);
    expect(["1", "2", "3", "4", "5", "6"].map((id) => get(id).hasPolicy)).toEqual([true, true, true, true, false, false]);
    expect(byGroup.get("g2")!.map((p) => p.id)).toEqual(["3", "4", "5", "6"]);
  });

  const summary = (people: number, missing: number, money?: GroupSummary["money"]): GroupSummary => ({
    id: "x", name: "x", kind: "CLIENT", people, items: people * 2, loans: 0, nextLoanDue: null, noPolicy: false,
    missing: Array.from({ length: missing }, (_, i) => ({ id: `${i}`, name: "", employeeNo: "", labels: [] })),
    equippedPct: null, byCategory: [], ...(money ? { money } : {}),
  });

  it("sums people, items and missing, and rounds fullyPct", () => {
    const t = reportTotals([summary(3, 1), summary(4, 1)], false);
    expect(t).toEqual({ people: 7, items: 14, missing: 2, fullyPct: 71 });
    expect("money" in t).toBe(false);
  });
  it("reads 0% fully equipped, not NaN, with no people", () => {
    expect(reportTotals([], false)).toEqual({ people: 0, items: 0, missing: 0, fullyPct: 0 });
    expect(reportTotals([summary(0, 0)], false).fullyPct).toBe(0);
  });
  it("sums money only with withMoney", () => {
    const rows = [
      summary(1, 0, { costC: 100, bookC: 80, perPersonC: 80, withoutCost: 1 }),
      summary(2, 0, { costC: 50, bookC: 40, perPersonC: 20, withoutCost: 2 }),
    ];
    expect(reportTotals(rows, true).money).toEqual({ costC: 150, bookC: 120, withoutCost: 3 });
    expect("money" in reportTotals(rows, false)).toBe(false);
  });
});

describe("bookValueC — the export's Book value column", () => {
  const dep = { lifeMonths: 36, salvage: 0, catLifeMonths: null, catSalvagePercent: null };
  const approved = new Date("2026-10-13T02:00:00Z");
  it("is the user's example: 52,000 over 36 months, bought 12 Oct, viewed 17 Oct = 50,555.56", () => {
    const a = asset("a", null, { costC: 5_200_000, purchasedAt: new Date("2026-10-12T02:00:00Z"), financeConfirmedAt: approved, dep });
    expect(bookValueC(a, asOf)).toBe(5_055_556);
  });
  it("an item with no cost is 0, and an unapproved item keeps its full cost", () => {
    expect(bookValueC(asset("a", null, { costC: null, financeConfirmedAt: approved, dep }), asOf)).toBe(0);
    expect(bookValueC(asset("b", null, { costC: 100_000, dep }), asOf)).toBe(100_000);
  });
});
