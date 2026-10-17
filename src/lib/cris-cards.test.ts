import { describe, expect, expectTypeOf, it } from "vitest";
import {
  cardFromSnapshot, initialsOf, parseConfirmCard, parseCrisCard, toViewMessage,
  type ConfirmCard, type ConfirmSnapshot, type CrisCard, type PersonSnapshot,
} from "./cris-cards";

const snap: ConfirmSnapshot = {
  pendingId: "p1",
  kind: "replace",
  person: { id: "emp1", name: "Ana Reyes", employeeNo: "EMP-0101", worksFor: "Acme Health" },
  gets: {
    id: "a1", tag: "BR-LT-0230", model: "Latitude 5440", serial: "SN-77", typeName: "Laptop",
    warrantyUntil: new Date("2027-03-31T00:00:00.000Z"), backOn: new Date("2026-09-01T03:00:00.000Z"),
  },
  scanned: true,
  returns: { id: "a0", tag: "BR-LT-0148", outcome: "DEFECTIVE", reason: "screen cracked" },
};

describe("cardFromSnapshot", () => {
  it("builds the Confirm card from the snapshot's reads", () => {
    const card = cardFromSnapshot(snap);
    expect(card).toEqual({
      type: "confirm",
      pendingId: "p1",
      kind: "replace",
      person: { id: "emp1", name: "Ana Reyes", employeeNo: "EMP-0101", worksFor: "Acme Health", initials: "AR" },
      gets: {
        assetId: "a1", tag: "BR-LT-0230", model: "Latitude 5440", typeName: "Laptop",
        warrantyEnd: "2027-03-31T00:00:00.000Z", backOn: "2026-09-01T03:00:00.000Z", serial: "SN-77", scanned: true,
      },
      returns: { assetId: "a0", tag: "BR-LT-0148", outcome: "DEFECTIVE", reason: "screen cracked" },
    });
  });

  it("round-trips through the stored JSON", () => {
    const card = cardFromSnapshot(snap);
    expect(parseConfirmCard(JSON.parse(JSON.stringify(card)))).toEqual(card);
    const assign = cardFromSnapshot({ ...snap, kind: "assign", returns: undefined });
    expect(assign).not.toHaveProperty("returns");
    expect(assign).not.toHaveProperty("reason");
    expect(parseConfirmCard(JSON.parse(JSON.stringify(assign)))).toEqual(assign);
    const reasoned = cardFromSnapshot({ ...snap, kind: "assign", returns: undefined, reason: "new joiner" });
    expect(reasoned.reason).toBe("new joiner");
    expect(parseConfirmCard(JSON.parse(JSON.stringify(reasoned)))).toEqual(reasoned);
  });

  it("takes person.employeeNo from the snapshot, never from any text", () => {
    const card = cardFromSnapshot({ ...snap, person: { ...snap.person, employeeNo: "EMP-0777" } });
    expect(card.person.employeeNo).toBe("EMP-0777");
  });

  it("has no field a model's words could fill", () => {
    // The person in a snapshot is exactly four DB columns — no free text rides along.
    expectTypeOf<PersonSnapshot>().toEqualTypeOf<{ id: string; name: string; employeeNo: string; worksFor: string }>();
    expectTypeOf<ConfirmCard["person"]["employeeNo"]>().toEqualTypeOf<string>();
    // @ts-expect-error a snapshot carries no model text
    cardFromSnapshot({ ...snap, text: "EMP-9999 is Ana" });
  });
});

describe("parseCrisCard", () => {
  it("keeps each well-formed card and refuses a stranger", () => {
    const cards: CrisCard[] = [
      { type: "chips", items: ["Check Ana's items"] },
      { type: "which", choices: [{ id: "e1", name: "Ana Reyes", employeeNo: "EMP-1", worksFor: "IT", initials: "AR" }] },
      { type: "result", pendingId: "p1", employeeId: "emp1", head: "Assigned.", text: "BR-LT-0230 is with Ana Reyes now.", undoUntil: "2026-10-17T10:01:00.000Z" },
      { type: "spares", employeeId: "emp1", options: [], offset: 0, more: false },
      {
        type: "person", person: { id: "e1", name: "Ana Reyes", employeeNo: "EMP-1", worksFor: "IT", initials: "AR" },
        items: [{ assetId: "a1", tag: "BR-LT-0230", model: "Latitude", since: null }], gaps: ["Monitor"], holds: [],
      },
    ];
    for (const c of cards) expect(parseCrisCard(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(parseCrisCard({ type: "result", head: "Deleted." })).toBeNull();
    expect(parseCrisCard("confirm")).toBeNull();
  });
});

describe("initialsOf", () => {
  it("takes the first and last name's first letters", () => {
    expect(initialsOf("Ana Reyes")).toBe("AR");
    expect(initialsOf("ana maria de la cruz")).toBe("AC");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("toViewMessage", () => {
  const createdAt = new Date("2026-10-17T10:00:00.000Z");
  it("reads a Cris message's text and cards", () => {
    const card: CrisCard = { type: "chips", items: ["Spare laptops in stock"] };
    expect(toViewMessage({ id: "m1", role: "cris", content: { text: "Done.", cards: [card, { type: "nope" }] }, createdAt }))
      .toEqual({ id: "m1", role: "cris", text: "Done.", cards: [card], at: "2026-10-17T10:00:00.000Z" });
  });
  it("shows a person's own message", () => {
    expect(toViewMessage({ id: "m2", role: "user", content: { text: "hi", cards: [] }, createdAt }))
      .toEqual({ id: "m2", role: "user", text: "hi", cards: [], at: "2026-10-17T10:00:00.000Z" });
  });
  it("hides tool rows", () => {
    expect(toViewMessage({ id: "m3", role: "tool", content: [{ type: "tool_result" }], createdAt })).toBeNull();
  });
});
