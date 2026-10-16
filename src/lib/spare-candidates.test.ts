import { describe, expect, it } from "vitest";
import {
  SPARE_LIMIT, orderSpareCandidates, spareCandidatesSchema, spareSearchWhere, spareWhere, toSpareOption, type SpareRow,
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

describe("spareCandidatesSchema", () => {
  it("needs the person; the type and the text are optional", () => {
    expect(spareCandidatesSchema.safeParse({}).success).toBe(false);
    expect(spareCandidatesSchema.safeParse({ employeeId: "e" }).success).toBe(true);
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", assetTypeId: "t", q: " x " }).data?.q).toBe("x");
  });

  it("refuses an empty type and text over 60 characters", () => {
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", assetTypeId: "" }).success).toBe(false);
    expect(spareCandidatesSchema.safeParse({ employeeId: "e", q: "x".repeat(61) }).success).toBe(false);
  });
});
