import { describe, expect, it } from "vitest";
import { computeLoadout, effectiveSlots, resolvePolicy, type ExceptionLike } from "./loadout";

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
  it("a TEMPORARY device never fills a standard slot; it is on loan", () => {
    const l = computeLoadout(slots, [asset("a1", "t-laptop", "TEMPORARY")]);
    expect(l.slots[0].asset).toBeNull();
    expect(l.onLoan.map((a) => a.id)).toEqual(["a1"]);
    expect(l.unslotted).toEqual([]);
    expect(l.missingRequired).toBe(3);
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
