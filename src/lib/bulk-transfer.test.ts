import { describe, expect, it } from "vitest";
import { bulkTransferSchema, checkBulkTransfer } from "./bulk-transfer";

type Person = { id: string; name: string; departmentId: string; employment: string };

const person = (n: number, over: Partial<Person> = {}): Person => ({
  id: `e${n}`, name: `Person ${n}`, departmentId: "finance", employment: "ACTIVE", ...over,
});
const dest = { id: "sales", archivedAt: null };

describe("checkBulkTransfer", () => {
  it("all fine gives ok", () => {
    expect(checkBulkTransfer([person(1), person(2, { employment: "OFFBOARDING" })], dest, 200)).toEqual({ ok: true });
  });

  it("one already in the destination gives blocked naming them", () => {
    const res = checkBulkTransfer([person(1), person(2, { departmentId: "sales" }), person(3)], dest, 200);
    expect(res).toEqual({
      ok: false,
      blocked: [{ id: "e2", name: "Person 2", reason: "Already works for this group" }],
    });
  });

  it("an archived destination blocks everyone with \"That group is archived\"", () => {
    const res = checkBulkTransfer(
      [person(1), person(2, { departmentId: "sales" }), person(3, { employment: "OFFBOARDED" })],
      { id: "sales", archivedAt: new Date("2026-10-01T00:00:00Z") },
      200,
    );
    expect(res).toEqual({
      ok: false,
      blocked: [
        { id: "e1", name: "Person 1", reason: "That group is archived" },
        { id: "e2", name: "Person 2", reason: "That group is archived" },
        { id: "e3", name: "Person 3", reason: "That group is archived" },
      ],
    });
  });

  it("an unknown destination blocks everyone with \"Unknown group\"", () => {
    const res = checkBulkTransfer([person(1), person(2)], null, 200);
    expect(res).toEqual({
      ok: false,
      blocked: [
        { id: "e1", name: "Person 1", reason: "Unknown group" },
        { id: "e2", name: "Person 2", reason: "Unknown group" },
      ],
    });
  });

  it("an offboarded person gives \"Has left\"", () => {
    const res = checkBulkTransfer([person(1), person(2, { employment: "OFFBOARDED" })], dest, 200);
    expect(res).toEqual({ ok: false, blocked: [{ id: "e2", name: "Person 2", reason: "Has left" }] });
  });

  it("an offboarded person already in the destination reads \"Has left\" (one reason each)", () => {
    const res = checkBulkTransfer([person(1, { employment: "OFFBOARDED", departmentId: "sales" })], dest, 200);
    expect(res).toEqual({ ok: false, blocked: [{ id: "e1", name: "Person 1", reason: "Has left" }] });
  });

  it("lists every blocked person, in input order", () => {
    const res = checkBulkTransfer(
      [person(1, { departmentId: "sales" }), person(2), person(3, { employment: "OFFBOARDED" })],
      dest,
      200,
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.blocked.map((b) => [b.id, b.reason])).toEqual([
      ["e1", "Already works for this group"],
      ["e3", "Has left"],
    ]);
  });

  it("empty gives the message", () => {
    expect(checkBulkTransfer([], dest, 200)).toEqual({ ok: false, blocked: [], message: "Pick at least one person" });
  });

  it("empty gives the message even with no destination", () => {
    expect(checkBulkTransfer([], null, 200)).toEqual({ ok: false, blocked: [], message: "Pick at least one person" });
  });

  it("201 people with max 200 gives the message", () => {
    const people = Array.from({ length: 201 }, (_, i) => person(i));
    expect(checkBulkTransfer(people, dest, 200)).toEqual({
      ok: false, blocked: [], message: "Pick no more than 200 people",
    });
  });

  it("exactly max people is fine", () => {
    const people = Array.from({ length: 200 }, (_, i) => person(i));
    expect(checkBulkTransfer(people, dest, 200)).toEqual({ ok: true });
  });
});

describe("bulkTransferSchema", () => {
  const base = { ids: ["e1", "e2"], toDepartmentId: "sales", effectiveAt: "2026-10-01" };

  it("accepts the dialog's input, the note optional and defaulting to empty", () => {
    const res = bulkTransferSchema.safeParse(base);
    expect(res.success && res.data).toEqual({ ...base, note: "" });
  });

  it("drops repeated ids", () => {
    const res = bulkTransferSchema.safeParse({ ...base, ids: ["e1", "e2", "e1"] });
    expect(res.success && res.data.ids).toEqual(["e1", "e2"]);
  });

  it("refuses a malformed or future date with the single transfer's messages", () => {
    const bad = bulkTransferSchema.safeParse({ ...base, effectiveAt: "01/10/2026" });
    expect(!bad.success && bad.error.issues[0].message).toBe("Use the date picker");
    const future = bulkTransferSchema.safeParse({ ...base, effectiveAt: "2999-01-01" });
    expect(!future.success && future.error.issues[0].message).toBe("That date is in the future");
  });

  it("refuses a missing destination", () => {
    const res = bulkTransferSchema.safeParse({ ...base, toDepartmentId: "" });
    expect(!res.success && res.error.issues[0].path).toEqual(["toDepartmentId"]);
  });
});
