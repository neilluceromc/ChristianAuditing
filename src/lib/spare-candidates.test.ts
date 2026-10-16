import { describe, expect, it } from "vitest";
import {
  SPARE_LIMIT, SPARE_QUERY_MAX, heldOrQueuedWhere, isUnpickable, orderSpareCandidates, replacePicker, solePick,
  spareCandidatesSchema, spareCandidatesWhere, spareSearchWhere, spareWhere, toSpareOption, type SpareOption, type SpareRow,
} from "./spare-candidates";

const row = (tag: string, typeId: string | null, extra: Partial<SpareRow> = {}): SpareRow => ({
  id: `id-${tag}`, tag, model: `model ${tag}`, typeId, reservations: [], approvals: [], ...extra,
});

describe("orderSpareCandidates", () => {
  it("puts the slot's type first, then the rest, each by tag", () => {
    const rows = [row("C", "mon"), row("A", "lap"), row("D", "lap"), row("B", null)];
    expect(orderSpareCandidates(rows, "lap").map((r) => r.tag)).toEqual(["A", "D", "B", "C"]);
  });

  it("orders by tag alone when no type is given — a null-typed spare is not 'same type'", () => {
    const rows = [row("C", null), row("A", "lap"), row("B", null)];
    expect(orderSpareCandidates(rows, null).map((r) => r.tag)).toEqual(["A", "B", "C"]);
  });

  it("keeps at most the limit, cutting the other types before the same type", () => {
    const same = Array.from({ length: 3 }, (_, i) => row(`Z${i}`, "lap"));
    const others = Array.from({ length: SPARE_LIMIT }, (_, i) => row(`A${String(i).padStart(2, "0")}`, "mon"));
    const out = orderSpareCandidates([...others, ...same], "lap");
    expect(out).toHaveLength(SPARE_LIMIT);
    expect(out.slice(0, 3).map((r) => r.tag)).toEqual(["Z0", "Z1", "Z2"]);
    expect(out.at(-1)!.tag).toBe("A46");
  });

  it("does not change the input", () => {
    const rows = [row("B", null), row("A", null)];
    orderSpareCandidates(rows, null);
    expect(rows.map((r) => r.tag)).toEqual(["B", "A"]);
  });
});

describe("toSpareOption", () => {
  it("a free spare", () => {
    expect(toSpareOption(row("BR-1", "lap"), "emp")).toEqual({
      id: "id-BR-1", tag: "BR-1", model: "model BR-1", typeId: "lap",
      reservedFor: null, reservedForThis: false, pendingRef: null,
    });
  });

  it("held for this person", () => {
    const o = toSpareOption(row("BR-1", "lap", { reservations: [{ employeeId: "emp", employee: { name: "Nina Robles" } }] }), "emp");
    expect(o.reservedFor).toBe("Nina Robles");
    expect(o.reservedForThis).toBe(true);
  });

  it("held for someone else, and promised by an open request", () => {
    const o = toSpareOption(row("BR-1", "lap", {
      reservations: [{ employeeId: "other", employee: { name: "Carlo Dizon" } }],
      approvals: [{ refNo: "APR-2041" }],
    }), "emp");
    expect(o.reservedFor).toBe("Carlo Dizon");
    expect(o.reservedForThis).toBe(false);
    expect(o.pendingRef).toBe("APR-2041");
  });
});

describe("spareSearchWhere", () => {
  it("is the plain pool without text", () => {
    expect(spareSearchWhere()).toEqual(spareWhere());
    expect(spareSearchWhere("   ")).toEqual(spareWhere());
    expect(spareWhere()).toEqual({ cls: "IT", status: "SPARE", returnedAt: null });
  });

  it("matches the tag or the model, ignoring case, inside the pool", () => {
    expect(spareSearchWhere(" br-lt ")).toEqual({
      AND: [
        spareWhere(),
        { OR: [{ tag: { contains: "br-lt", mode: "insensitive" } }, { model: { contains: "br-lt", mode: "insensitive" } }] },
      ],
    });
  });
});

describe("spareCandidatesWhere", () => {
  it("is the search pool unless pickable is asked for", () => {
    expect(spareCandidatesWhere("emp")).toEqual(spareSearchWhere());
    expect(spareCandidatesWhere("emp", "lt", false)).toEqual(spareSearchWhere("lt"));
  });

  it("with pickable, leaves out what is held or queued for someone else", () => {
    expect(spareCandidatesWhere("emp", undefined, true)).toEqual({
      AND: [spareWhere(), { NOT: heldOrQueuedWhere("emp") }],
    });
    expect(spareCandidatesWhere("emp", "lt", true)).toEqual({
      AND: [spareSearchWhere("lt"), { NOT: heldOrQueuedWhere("emp") }],
    });
  });
});

describe("spareCandidatesSchema", () => {
  it("needs the person; the type and the text are optional", () => {
    expect(spareCandidatesSchema.safeParse({}).success).toBe(false);
    expect(spareCandidatesSchema.safeParse({ employeeId: "e" }).success).toBe(true);
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", assetTypeId: "t", q: " x " }).data?.q).toBe("x");
  });

  it("takes pickable only as true", () => {
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", pickable: true }).data?.pickable).toBe(true);
    expect(spareCandidatesSchema.safeParse({ employeeId: "e" }).data?.pickable).toBeUndefined();
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", pickable: false }).success).toBe(false);
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", pickable: "yes" }).success).toBe(false);
  });

  it("refuses an empty type and text over 60 characters", () => {
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", assetTypeId: "" }).success).toBe(false);
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", q: "x".repeat(SPARE_QUERY_MAX + 1) }).success).toBe(false);
  });
});

const opt = (id: string, typeId: string | null, extra: Partial<SpareOption> = {}): SpareOption => ({
  id, tag: id, model: "m", typeId, reservedFor: null, reservedForThis: false, pendingRef: null, ...extra,
});

describe("isUnpickable", () => {
  it("free and held-for-them are pickable; held for someone else or queued are not", () => {
    expect(isUnpickable(opt("a", "t"))).toBe(false);
    expect(isUnpickable(opt("a", "t", { reservedFor: "Nina", reservedForThis: true }))).toBe(false);
    expect(isUnpickable(opt("a", "t", { reservedFor: "Carlo" }))).toBe(true);
    expect(isUnpickable(opt("a", "t", { pendingRef: "APR-1" }))).toBe(true);
    expect(isUnpickable(opt("a", "t", { reservedFor: "Nina", reservedForThis: true, pendingRef: "APR-1" }))).toBe(true);
  });
});

describe("heldOrQueuedWhere", () => {
  it("a hold for anyone but this person, or an open request", () => {
    expect(heldOrQueuedWhere("emp")).toEqual({
      OR: [
        { reservations: { some: { state: "ACTIVE", employeeId: { not: "emp" } } } },
        { approvals: { some: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } } },
      ],
    });
  });
});

describe("replacePicker", () => {
  it("nothing in stock", () => {
    expect(replacePicker({ total: 0, heldOrQueued: 0 })).toEqual({ kind: "empty" });
  });

  it("all held only when every spare in the pool is held or queued", () => {
    expect(replacePicker({ total: 3, heldOrQueued: 3 })).toEqual({ kind: "allHeld", count: 3 });
    expect(replacePicker({ total: 1, heldOrQueued: 1 })).toEqual({ kind: "allHeld", count: 1 });
    expect(replacePicker({ total: 120, heldOrQueued: 119 })).toEqual({ kind: "pick", hidden: 119 });
  });

  it("a picker, with how many the pool leaves out — however many rows were loaded", () => {
    expect(replacePicker({ total: 500, heldOrQueued: 2 })).toEqual({ kind: "pick", hidden: 2 });
    expect(replacePicker({ total: 5, heldOrQueued: 0 })).toEqual({ kind: "pick", hidden: 0 });
  });
});

describe("solePick", () => {
  it("the one pickable spare of the type, when the pool has exactly one", () => {
    const rows = [opt("a", "t", { pendingRef: "APR-1" }), opt("b", "t"), opt("c", "other")];
    expect(solePick(rows, "t", { total: 2, heldOrQueued: 1 })).toBe("b");
  });

  it("none when the pool has more pickable spares than the rows show", () => {
    const rows = [opt("a", "t", { reservedFor: "Carlo" }), opt("b", "t")];
    expect(solePick(rows, "t", { total: 80, heldOrQueued: 1 })).toBeNull();
  });

  it("none when the pool's one pickable spare is not among the rows loaded", () => {
    const rows = [opt("a", "t", { reservedFor: "Carlo" })];
    expect(solePick(rows, "t", { total: 60, heldOrQueued: 59 })).toBeNull();
  });

  it("a spare held for this person counts as pickable", () => {
    expect(solePick([opt("a", "t", { reservedFor: "Nina", reservedForThis: true })], "t", { total: 1, heldOrQueued: 0 })).toBe("a");
  });
});
