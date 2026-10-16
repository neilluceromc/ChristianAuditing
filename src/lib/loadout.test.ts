import { describe, expect, it } from "vitest";
import { computeLoadout, createAssignments, effectiveSlots, groupExceptionsByEmployee, headcountByPolicy, numberSlotLabels, orderTiles, profilePrimary, profileTiles, profileTileMenuItems, resolvePolicy, tileChip, slotLabel, tileMenuItems, type ExceptionLike } from "./loadout";

const policies = [
  { id: "p-dept", name: "Finance standard", appliesToTitle: null, appliesToDepartmentId: "dept-fin", slots: [] },
  { id: "p-title", name: "Team lead kit", appliesToTitle: "Team Lead", appliesToDepartmentId: null, slots: [] },
];

describe("resolvePolicy — role (title) policy beats department policy", () => {
  it("matches title first, case-insensitively", () => {
    expect(resolvePolicy({ title: "team lead", departmentId: "dept-fin" }, policies)?.id).toBe("p-title");
  });
  it("falls back to department", () => {
    expect(resolvePolicy({ title: "Accountant", departmentId: "dept-fin" }, policies)?.id).toBe("p-dept");
  });
  it("null when nothing applies", () => {
    expect(resolvePolicy({ title: "Contractor", departmentId: "dept-ops" }, policies)).toBeNull();
  });
});

const slots = [
  { id: "s1", name: "laptop", assetTypeId: "t-laptop", required: true, loaner: false },
  { id: "s2", name: "monitor", assetTypeId: "t-monitor", required: true, loaner: false },
  { id: "s3", name: "second monitor", assetTypeId: "t-monitor", required: false, loaner: false },
  { id: "s4", name: "headset", assetTypeId: "t-headset", required: true, loaner: false },
];
const loanerSlot = { id: "s5", name: "loaner laptop", assetTypeId: "t-laptop", required: false, loaner: true };

const asset = (id: string, typeId: string | null, status = "DEPLOYED") => ({ id, tag: id, model: "m", typeId, status });

describe("computeLoadout", () => {
  it("fills slots by asset type, one asset per slot, leftovers unslotted", () => {
    const held = [asset("a1", "t-laptop"), asset("a2", "t-monitor"), asset("a3", "t-monitor"), asset("a4", "t-monitor")];
    const l = computeLoadout(slots, held);
    expect(l.slots.map((s) => s.asset?.id ?? null)).toEqual(["a1", "a2", "a3", null]);
    expect(l.unslotted.map((a) => a.id)).toEqual(["a4"]);
    expect(l.filled).toBe(3);
    expect(l.totalSlots).toBe(4);
    expect(l.missingRequired).toBe(1); // headset
  });
  it("day one: everything empty, all required missing", () => {
    const l = computeLoadout(slots, []);
    expect(l.filled).toBe(0);
    expect(l.missingRequired).toBe(3);
  });
  it("assets with no type never fill slots", () => {
    const l = computeLoadout(slots, [asset("a1", null)]);
    expect(l.filled).toBe(0);
    expect(l.unslotted).toHaveLength(1);
  });
  it("no policy → empty grid, nothing missing", () => {
    const l = computeLoadout([], [asset("a1", "t-laptop")]);
    expect(l.totalSlots).toBe(0);
    expect(l.missingRequired).toBe(0);
    expect(l.unslotted).toHaveLength(1);
  });
});

describe("computeLoadout — loaner rule (Phase 16 §3.3)", () => {
  it("a TEMPORARY device never fills a standard slot; it is on loan, and now covers that slot (Phase 20 §6.3)", () => {
    const l = computeLoadout(slots, [asset("a1", "t-laptop", "TEMPORARY")]);
    expect(l.slots[0].asset).toBeNull();
    expect(l.onLoan.map((a) => a.id)).toEqual(["a1"]);
    expect(l.unslotted).toEqual([]);
    // Phase 20 (spec §6.3): s1 (the laptop slot) is now covered by the
    // device on loan rather than plainly missing — only s2 (monitor) and s4
    // (headset) remain missing. Before this phase, with no coverage concept,
    // this asserted missingRequired === 3 (s1, s2, s4 all counted missing).
    expect(l.slots[0].coveredByLoan).toBe(true);
    expect(l.coveredByLoan).toBe(1);
    expect(l.missingRequired).toBe(2);
  });
  it("a loaner slot takes only a TEMPORARY device of its type", () => {
    const l = computeLoadout([...slots, loanerSlot], [asset("a1", "t-laptop", "DEPLOYED"), asset("a2", "t-laptop", "TEMPORARY")]);
    expect(l.slots.find((s) => s.slot.id === "s1")?.asset?.id).toBe("a1");
    expect(l.slots.find((s) => s.slot.id === "s5")?.asset?.id).toBe("a2");
    expect(l.onLoan).toEqual([]);
  });
  it("a DEPLOYED device never fills a loaner slot", () => {
    const l = computeLoadout([loanerSlot], [asset("a1", "t-laptop", "DEPLOYED")]);
    expect(l.slots[0].asset).toBeNull();
    expect(l.unslotted.map((a) => a.id)).toEqual(["a1"]);
  });
  it("a required loaner slot left empty counts as missing", () => {
    expect(computeLoadout([{ ...loanerSlot, required: true }], []).missingRequired).toBe(1);
  });
});

describe("computeLoadout — loan-covered slot (Phase 20 spec §6.3, gap 3)", () => {
  const laptopSlot = { id: "sa", name: "laptop", assetTypeId: "t-laptop", required: true, loaner: false };

  it("one laptop on loan covers a required standard laptop slot: nothing missing, the device stays on loan", () => {
    const l = computeLoadout([laptopSlot], [asset("a1", "t-laptop", "TEMPORARY")]);
    expect(l.missingRequired).toBe(0);
    expect(l.coveredByLoan).toBe(1);
    expect(l.slots[0]).toMatchObject({ asset: null, coveredByLoan: true });
    expect(l.onLoan.map((a) => a.id)).toEqual(["a1"]);
  });

  it("two standard slots of the same type and one loan: one covered, one still missing", () => {
    const secondSlot = { ...laptopSlot, id: "sb" };
    const l = computeLoadout([laptopSlot, secondSlot], [asset("a1", "t-laptop", "TEMPORARY")]);
    expect(l.coveredByLoan).toBe(1);
    expect(l.missingRequired).toBe(1);
    expect(l.slots.filter((s) => s.coveredByLoan)).toHaveLength(1);
  });

  it("a loaner slot still consumes the TEMPORARY device first, leaving no coverage for the standard slot after it", () => {
    const l = computeLoadout([loanerSlot, laptopSlot], [asset("a1", "t-laptop", "TEMPORARY")]);
    expect(l.slots.find((s) => s.slot.id === "s5")?.asset?.id).toBe("a1");
    expect(l.coveredByLoan).toBe(0);
    expect(l.slots.find((s) => s.slot.id === "sa")).toMatchObject({ asset: null, coveredByLoan: false });
    expect(l.missingRequired).toBe(1);
  });

  it("ordinary cases are unchanged: a slot filled outright is never marked covered by loan", () => {
    const l = computeLoadout([laptopSlot], [asset("a1", "t-laptop", "DEPLOYED")]);
    expect(l.coveredByLoan).toBe(0);
    expect(l.slots[0]).toMatchObject({ asset: { id: "a1" }, coveredByLoan: false });
  });
});

describe("effectiveSlots (Phase 16 §3.3)", () => {
  const waive = (slotId: string): ExceptionLike =>
    ({ id: `w-${slotId}`, kind: "WAIVE", slotId, name: null, assetTypeId: null, required: true, loaner: false });
  const add: ExceptionLike =
    { id: "x1", kind: "ADD", slotId: null, name: "tablet", assetTypeId: "t-tablet", required: true, loaner: false };
  it("drops waived slots", () => {
    expect(effectiveSlots(slots, [waive("s4")]).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
  it("ignores a waiver whose slot is not in this policy", () => {
    expect(effectiveSlots(slots, [waive("gone")])).toHaveLength(4);
  });
  it("appends ADD rows after the policy's slots, carrying the exception id", () => {
    const out = effectiveSlots(slots, [add]);
    expect(out[4]).toEqual({ id: "x:x1", name: "tablet", assetTypeId: "t-tablet", required: true, loaner: false, exceptionId: "x1" });
  });
  it("orders several ADD rows by name then id", () => {
    const b: ExceptionLike = { ...add, id: "x2", name: "camera" };
    expect(effectiveSlots([], [add, b]).map((s) => s.name)).toEqual(["camera", "tablet"]);
  });
  it("ADD-only with no policy gives a personal loadout", () => {
    expect(computeLoadout(effectiveSlots([], [add]), [asset("a1", "t-tablet")]).filled).toBe(1);
  });
});

describe("headcountByPolicy", () => {
  it("sums counts per resolved policy id; groups that resolve to no policy are not counted", () => {
    const groups = [
      { title: "Team Lead", departmentId: "dept-fin", count: 3 },
      { title: "Accountant", departmentId: "dept-fin", count: 5 },
      { title: "Analyst", departmentId: "dept-fin", count: 4 }, // second, distinct non-policy title in the same department -- p-dept sums both groups
      { title: "Driver", departmentId: "dept-ops", count: 2 },
    ];
    const heads = headcountByPolicy(groups, policies);
    expect(heads.get("p-title")).toBe(3);
    expect(heads.get("p-dept")).toBe(9); // 5 (Accountant) + 4 (Analyst)
    expect(heads.size).toBe(2);
  });
});

describe("groupExceptionsByEmployee", () => {
  it("buckets rows by employeeId, preserving each employee's insertion order", () => {
    const rows = [
      { employeeId: "e1", id: "r1" },
      { employeeId: "e2", id: "r2" },
      { employeeId: "e1", id: "r3" },
    ];
    const grouped = groupExceptionsByEmployee(rows);
    expect([...grouped.keys()]).toEqual(["e1", "e2"]);
    expect(grouped.get("e1")).toEqual([{ employeeId: "e1", id: "r1" }, { employeeId: "e1", id: "r3" }]);
    expect(grouped.get("e2")).toEqual([{ employeeId: "e2", id: "r2" }]);
  });
  it("empty input gives an empty map", () => {
    expect(groupExceptionsByEmployee([]).size).toBe(0);
  });
});

describe("profilePrimary — one state-chosen primary per profile (spec §4.1)", () => {
  it("day one: every slot empty → Assign kit", () => {
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 6, filled: 0, missingRequired: 5 })).toEqual({ kind: "assign-kit", label: "Assign kit" });
  });
  it("gaps → Fill N gap(s), singular and plural", () => {
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 6, filled: 3, missingRequired: 1 })).toEqual({ kind: "fill-gaps", label: "Fill 1 gap" });
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 6, filled: 2, missingRequired: 3 })).toEqual({ kind: "fill-gaps", label: "Fill 3 gaps" });
  });
  it("complete, or no policy → none", () => {
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 6, filled: 6, missingRequired: 0 })).toBeNull();
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 0, filled: 0, missingRequired: 0 })).toBeNull();
  });
  // Ruling R6: an ALL-OPTIONAL policy with nothing assigned gets no primary —
  // `filled === 0` alone must not read as "day one, assign the kit" when there
  // is no required gap to fill. This is the case the day-one branch above can
  // be made to pass without, so it is pinned on its own.
  it("an all-optional policy with nothing assigned → none (R6)", () => {
    expect(profilePrimary({ employment: "ACTIVE", totalSlots: 3, filled: 0, missingRequired: 0 })).toBeNull();
  });
  it("a leaver → the wizard; offboarded → none", () => {
    expect(profilePrimary({ employment: "OFFBOARDING", totalSlots: 6, filled: 0, missingRequired: 5 })).toEqual({ kind: "wizard", label: "Open the offboarding wizard" });
    expect(profilePrimary({ employment: "OFFBOARDED", totalSlots: 6, filled: 0, missingRequired: 5 })).toBeNull();
  });
});

describe("orderTiles — required gaps first, then filled, then optional gaps (spec §4.4)", () => {
  const t = (id: string, asset: boolean, required: boolean, coveredByLoan = false) => ({ id, asset: asset ? { id } : null, required, coveredByLoan });
  it("keeps relative order inside each band", () => {
    const tiles = [t("a", true, true), t("b", false, false), t("c", false, true), t("d", true, false), t("e", false, true)];
    expect(orderTiles(tiles).map((x) => x.id)).toEqual(["c", "e", "a", "d", "b"]);
  });
  it("a loan-covered empty required tile is not a gap — it sits with the filled", () => {
    expect(orderTiles([t("a", false, true, true), t("b", false, true)]).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("tileMenuItems — what a tile's menu offers (spec §4.4)", () => {
  const ctx = { mayAct: true, direct: true };
  it("a filled tile: Replace, Return, Open record, then Waive for a policy slot", () => {
    expect(tileMenuItems({ filled: true, pending: false, exceptionId: null, waivable: true }, ctx)).toEqual(["replace", "return", "open", "waive"]);
  });
  it("a filled exception tile offers Remove exception instead of Waive", () => {
    expect(tileMenuItems({ filled: true, pending: false, exceptionId: "x1", waivable: false }, ctx)).toEqual(["replace", "return", "open", "remove-exception"]);
  });
  it("a pending tile only opens the record", () => {
    expect(tileMenuItems({ filled: true, pending: true, exceptionId: null, waivable: true }, ctx)).toEqual(["open"]);
  });
  it("an empty tile: Reserve (direct only) and Waive", () => {
    expect(tileMenuItems({ filled: false, pending: false, exceptionId: null, waivable: true }, ctx)).toEqual(["reserve", "waive"]);
    expect(tileMenuItems({ filled: false, pending: false, exceptionId: null, waivable: true }, { mayAct: true, direct: false })).toEqual(["waive"]);
  });
  it("without mayAct, a filled tile only opens the record and an empty tile has nothing", () => {
    expect(tileMenuItems({ filled: true, pending: false, exceptionId: null, waivable: true }, { mayAct: false, direct: false })).toEqual(["open"]);
    expect(tileMenuItems({ filled: false, pending: false, exceptionId: null, waivable: true }, { mayAct: false, direct: false })).toEqual([]);
  });
  it("Replace needs the direct path; the request path still returns", () => {
    expect(tileMenuItems({ filled: true, pending: false, exceptionId: null, waivable: true }, { mayAct: true, direct: false })).toEqual(["return", "open", "waive"]);
  });
});

describe("slotLabel", () => {
  it("uses the category name", () => {
    expect(slotLabel("Monitor", "24-inch")).toBe("Monitor");
    expect(slotLabel("Workstation (PC)", "Mini PC")).toBe("Workstation (PC)");
  });
  it("uses the type name inside Other, any case", () => {
    expect(slotLabel("Other", "Docking Station")).toBe("Docking Station");
    expect(slotLabel(" other ", "Phone")).toBe("Phone");
  });
});

describe("numberSlotLabels", () => {
  it("leaves unique labels alone", () => {
    expect(numberSlotLabels(["Laptop", "Monitor"])).toEqual(["Laptop", "Monitor"]);
  });
  it("numbers repeats in order", () => {
    expect(numberSlotLabels(["Monitor", "Laptop", "Monitor", "Monitor"])).toEqual(["Monitor", "Laptop", "Monitor 2", "Monitor 3"]);
  });
  it("counts case-insensitively but keeps the first spelling", () => {
    expect(numberSlotLabels(["Monitor", "monitor"])).toEqual(["Monitor", "monitor 2"]);
  });
});

describe("resolvePolicy order (Phase 37)", () => {
  const base = { id: "b", name: "Acme", appliesToTitle: null, appliesToDepartmentId: "acme" };
  const rule = { id: "r", name: "Acme · Team Lead", appliesToTitle: "Team Lead", appliesToDepartmentId: "acme" };
  const otherRule = { id: "o", name: "Zen · Team Lead", appliesToTitle: "Team Lead", appliesToDepartmentId: "zen" };
  const global = { id: "g", name: "Leads", appliesToTitle: "team lead", appliesToDepartmentId: null };
  it("a group title rule beats a global title policy", () => {
    expect(resolvePolicy({ title: " team lead ", departmentId: "acme" }, [global, base, otherRule, rule])?.id).toBe("r");
  });
  it("a global title policy beats the group base", () => {
    expect(resolvePolicy({ title: "Team Lead", departmentId: "acme" }, [base, global])?.id).toBe("g");
  });
  it("another group's title rule never applies", () => {
    expect(resolvePolicy({ title: "Team Lead", departmentId: "acme" }, [otherRule, base])?.id).toBe("b");
  });
  it("falls back to null", () => {
    expect(resolvePolicy({ title: "Agent", departmentId: "none" }, [base, rule])).toBeNull();
  });
});

describe("profileTiles — the profile's equal tiles (spec §4.3)", () => {
  const monitor = { id: "m1", name: "Monitor", assetTypeId: "t-monitor", required: true, loaner: false };
  const monitor2 = { id: "m2", name: "Monitor", assetTypeId: "t-monitor", required: false, loaner: false };
  const headset = { id: "h1", name: "Headset", assetTypeId: "t-headset", required: true, loaner: false };
  const held = [asset("a-mon", "t-monitor"), asset("a-extra", "t-mouse"), asset("a-loan", "t-tablet", "TEMPORARY")];
  const category: Record<string, string> = { "t-monitor": "Monitor", "t-mouse": "Mouse", "t-tablet": "Tablet" };
  const tiles = profileTiles(computeLoadout([monitor, monitor2, headset], held), (s) => s.name, (a) => category[a.typeId ?? ""] ?? "Other");

  it("numbers repeats in policy order, then sorts: required gap, filled, optional gap, extras, loans", () => {
    expect(tiles.map((t) => t.label)).toEqual(["Headset", "Monitor", "Monitor 2", "Mouse", "Tablet"]);
    expect(tiles.map((t) => t.kind)).toEqual(["slot", "slot", "slot", "extra", "loan"]);
    expect(tiles.map((t) => t.asset?.id ?? null)).toEqual([null, "a-mon", null, "a-extra", "a-loan"]);
  });
  it("keys are unique and say what each tile is", () => {
    expect(tiles.map((t) => t.key)).toEqual(["slot:h1", "slot:m1", "slot:m2", "extra:a-extra", "loan:a-loan"]);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
  });
  it("extras and loans carry no slot and are never required", () => {
    expect(tiles.slice(3).map((t) => [t.slot, t.required])).toEqual([[null, false], [null, false]]);
  });
  it("numbers in policy order BEFORE sorting: an optional empty Monitor first, a filled Monitor second → tiles read Monitor 2, Monitor", () => {
    const optionalFirst = { id: "o1", name: "Monitor", assetTypeId: "t-monitor-27", required: false, loaner: false };
    const filledSecond = { id: "f2", name: "Monitor", assetTypeId: "t-monitor", required: true, loaner: false };
    const reversed = profileTiles(computeLoadout([optionalFirst, filledSecond], [asset("a-mon", "t-monitor")]), (s) => s.name, () => "x");
    expect(reversed.map((t) => t.label)).toEqual(["Monitor 2", "Monitor"]);
    expect(reversed.map((t) => t.key)).toEqual(["slot:f2", "slot:o1"]);
  });
  it("a slot covered by a loan shows that device and the device is not repeated as a loan tile", () => {
    const laptop = { id: "l1", name: "Laptop", assetTypeId: "t-laptop", required: true, loaner: false };
    const covered = profileTiles(
      computeLoadout([laptop], [asset("a-lent", "t-laptop", "TEMPORARY"), asset("a-other", "t-tablet", "TEMPORARY")]),
      (s) => s.name, () => "Tablet",
    );
    expect(covered.map((t) => [t.key, t.asset?.id ?? null, t.coveredByLoan])).toEqual([
      ["slot:l1", "a-lent", true],
      ["loan:a-other", "a-other", false],
    ]);
  });
});

describe("tileChip — one status chip per tile (spec §4.3)", () => {
  const today = "2026-10-16";
  const base = { kind: "slot" as const, filled: false, required: true, loaner: false, coveredByLoan: false, loanDueAt: null };
  it("a required gap is Missing (danger); an optional gap is Optional (neutral)", () => {
    expect(tileChip(base, today)).toEqual({ text: "Missing", tone: "danger" });
    expect(tileChip({ ...base, required: false }, today)).toEqual({ text: "Optional", tone: "neutral" });
  });
  it("a filled slot is Held (success); an extra is Not in policy (neutral)", () => {
    expect(tileChip({ ...base, filled: true }, today)).toEqual({ text: "Held", tone: "success" });
    expect(tileChip({ ...base, kind: "extra", filled: true, required: false }, today)).toEqual({ text: "Not in policy", tone: "neutral" });
  });
  it("a loan reads On loan · due d MMM: neutral beyond 3 days, amber within 3, red once overdue, and says when there is no date", () => {
    const loan = { ...base, kind: "loan" as const, filled: true, required: false };
    expect(tileChip({ ...loan, loanDueAt: "2026-10-20T00:00:00.000Z" }, today)).toEqual({ text: "On loan · due 20 Oct", tone: "neutral" });
    expect(tileChip({ ...loan, loanDueAt: "2026-10-19T00:00:00.000Z" }, today)).toEqual({ text: "On loan · due 19 Oct", tone: "warning" });
    expect(tileChip({ ...loan, loanDueAt: "2026-10-16T00:00:00.000Z" }, today)).toEqual({ text: "On loan · due 16 Oct", tone: "warning" });
    expect(tileChip({ ...loan, loanDueAt: "2026-10-15T00:00:00.000Z" }, today)).toEqual({ text: "On loan · due 15 Oct", tone: "danger" });
    expect(tileChip(loan, today)).toEqual({ text: "On loan · no due date", tone: "warning" });
  });
  it("a loaner slot's device and a loan-covered slot are loans too", () => {
    expect(tileChip({ ...base, filled: true, loaner: true, loanDueAt: "2026-11-01T00:00:00.000Z" }, today).text).toBe("On loan · due 1 Nov");
    expect(tileChip({ ...base, filled: true, coveredByLoan: true }, today).text).toBe("On loan · no due date");
  });
});

describe("profileTileMenuItems — the ⋯ items for any profile tile (spec §4.3)", () => {
  const slot = { kind: "slot" as const, filled: false, pending: false, exceptionId: null, waivable: true, coveredByLoan: false };
  const act = { mayAct: true, direct: true };
  it("a policy slot is exactly tileMenuItems", () => {
    expect(profileTileMenuItems(slot, act)).toEqual(tileMenuItems(slot, act));
    expect(profileTileMenuItems({ ...slot, filled: true }, act)).toEqual(["replace", "return", "open", "waive"]);
  });
  it("a loan-covered slot keeps the empty slot's items and adds Return and Open record for the loan — never Replace", () => {
    const covered = { ...slot, filled: true, coveredByLoan: true };
    expect(profileTileMenuItems(covered, act)).toEqual(["reserve", "return", "open", "waive"]);
    expect(profileTileMenuItems(covered, { mayAct: true, direct: false })).toEqual(["return", "open", "waive"]);
    expect(profileTileMenuItems({ ...covered, exceptionId: "x1", waivable: false }, act)).toEqual(["reserve", "return", "open", "remove-exception"]);
    expect(profileTileMenuItems({ ...covered, pending: true }, act)).toEqual(["reserve", "open", "waive"]);
    expect(profileTileMenuItems(covered, { mayAct: false, direct: true })).toEqual(["open"]);
  });
  it("extras and loans: Return and Open record when the user may act, else Open record only", () => {
    const extra = { ...slot, kind: "extra" as const, filled: true, waivable: false };
    expect(profileTileMenuItems(extra, act)).toEqual(["return", "open"]);
    expect(profileTileMenuItems({ ...extra, kind: "loan" }, act)).toEqual(["return", "open"]);
    expect(profileTileMenuItems({ ...extra, pending: true }, act)).toEqual(["open"]);
    expect(profileTileMenuItems(extra, { mayAct: false, direct: true })).toEqual(["open"]);
  });
});

describe("createAssignments", () => {
  const picks = [{ assetId: "a1" }, { assetId: "a2" }];
  it("assigns the picks for someone ACTIVE", () => {
    expect(createAssignments("ACTIVE", picks)).toEqual(picks);
  });
  it("assigns nothing for someone offboarding or offboarded", () => {
    expect(createAssignments("OFFBOARDING", picks)).toEqual([]);
    expect(createAssignments("OFFBOARDED", picks)).toEqual([]);
  });
});
