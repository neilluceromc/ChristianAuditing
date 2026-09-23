import { describe, expect, it } from "vitest";
import { attentionOf, attentionWhere, orderByAttention, type AttentionInput } from "./inventory-attention";

const now = new Date("2026-09-23T02:00:00Z"); // 10:00 Manila
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const quiet: AttentionInput = { cls: "IT", status: "SPARE", returnedAt: null, loanDueAt: null, pendingRef: null, itVerifiedAt: day("2025-01-01") };

describe("attentionOf — one reason per row, worst first (spec §6.3)", () => {
  it("nothing owed → null", () => expect(attentionOf(quiet, now)).toBeNull());
  it("back, not checked beats everything", () => {
    expect(attentionOf({ ...quiet, returnedAt: day("2026-09-20"), pendingRef: "APR-1" }, now)?.label).toBe("back, not checked");
  });
  it("loans: overdue, no due date, due soon — in that order of worry", () => {
    const loan = { ...quiet, status: "TEMPORARY" };
    expect(attentionOf({ ...loan, loanDueAt: day("2026-09-20") }, now)?.label).toBe("overdue by 3 d");
    expect(attentionOf({ ...loan, loanDueAt: null }, now)?.label).toBe("no due date");
    expect(attentionOf({ ...loan, loanDueAt: day("2026-09-25") }, now)?.label).toBe("due in 2 d");
    expect(attentionOf({ ...loan, loanDueAt: day("2026-10-23") }, now)).toBeNull();
  });
  it("the due-soon edge is exactly seven days", () => {
    const loan = { ...quiet, status: "TEMPORARY" };
    expect(attentionOf({ ...loan, loanDueAt: day("2026-09-30") }, now)?.label).toBe("due in 7 d");
    expect(attentionOf({ ...loan, loanDueAt: day("2026-10-01") }, now)).toBeNull();
  });
  it("a queued approval, then awaiting IT check", () => {
    expect(attentionOf({ ...quiet, pendingRef: "APR-2041" }, now)?.label).toBe("queued APR-2041");
    expect(attentionOf({ ...quiet, itVerifiedAt: null }, now)?.label).toBe("awaiting IT check");
    expect(attentionOf({ ...quiet, cls: "PURCHASING", itVerifiedAt: null }, now)).toBeNull();
  });
  it("severity follows the reading order", () => {
    const loan = { ...quiet, status: "TEMPORARY" };
    const s = (a: AttentionInput) => attentionOf(a, now)!.severity;
    const back = s({ ...quiet, returnedAt: day("2026-09-20") });
    const overdue = s({ ...loan, loanDueAt: day("2026-09-20") });
    const noDate = s({ ...loan, loanDueAt: null });
    const soon = s({ ...loan, loanDueAt: day("2026-09-25") });
    const queued = s({ ...quiet, pendingRef: "APR-1" });
    const check = s({ ...quiet, itVerifiedAt: null });
    expect([back, overdue, noDate, soon, queued, check]).toEqual([...[back, overdue, noDate, soon, queued, check]].sort((a, b) => b - a));
  });
});

describe("orderByAttention — worst first, quiet rows last either way", () => {
  const rows = [
    { id: "1", tag: "BR-LT-0003", attention: null },
    { id: "2", tag: "BR-LT-0002", attention: { kind: "queued" as const, label: "queued APR-1", severity: 1000 } },
    { id: "3", tag: "BR-LT-0001", attention: { kind: "back" as const, label: "back, not checked", severity: 5000 } },
    { id: "4", tag: "BR-LT-0000", attention: null },
  ];
  it("ascending: most severe first, quiet rows by tag at the end", () => {
    expect(orderByAttention(rows, "asc").map((r) => r.id)).toEqual(["3", "2", "4", "1"]);
  });
  it("descending: least severe first, quiet rows still last", () => {
    expect(orderByAttention(rows, "desc").map((r) => r.id)).toEqual(["2", "3", "4", "1"]);
  });
});

describe("attentionWhere — the count's predicate (agrees with attentionOf's edges)", () => {
  it("ORs the five reasons, with the loan edge at now + 7 days", () => {
    const w = attentionWhere(now);
    expect(w.OR).toEqual([
      { returnedAt: { not: null } },
      { status: "TEMPORARY", loanDueAt: null },
      { status: "TEMPORARY", loanDueAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
      { approvals: { some: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } } },
      { cls: "IT", itVerifiedAt: null },
    ]);
  });
});
