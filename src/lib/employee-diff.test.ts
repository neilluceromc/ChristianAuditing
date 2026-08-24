import { describe, expect, it } from "vitest";
import { employeeDiff } from "./employee-diff";

describe("employeeDiff", () => {
  // Mirrors asset-diff.test.ts's own first case: prisma/seed.ts's day()
  // helper never truncates to midnight, so a stored joinedAt carries a real
  // time-of-day exactly like the seeded assets' purchasedAt/warrantyUntil do.
  it("a clean round trip of a time-of-day joinedAt yields no diff and nothing to write", () => {
    const before = {
      name: "Marites Bautista",
      title: "Accountant",
      departmentId: "dept-1",
      joinedAt: new Date("2024-09-01T07:59:47.133Z"),
    };
    const patch = {
      name: "Marites Bautista",
      title: "Accountant",
      departmentId: "dept-1",
      joinedAt: new Date("2024-09-01T00:00:00Z"),
    };
    const { diff, changed } = employeeDiff(before, patch);
    expect(diff).toEqual({});
    expect(changed).toEqual({});
  });

  it("a genuine day change on joinedAt is the ONLY key in diff and changed", () => {
    const before = {
      name: "Marites Bautista",
      title: "Accountant",
      departmentId: "dept-1",
      joinedAt: new Date("2024-09-01T07:59:47.133Z"),
    };
    const patch = {
      name: "Marites Bautista",
      title: "Accountant",
      departmentId: "dept-1",
      joinedAt: new Date("2024-09-02T00:00:00Z"), // a real day change
    };
    const { diff, changed } = employeeDiff(before, patch);
    expect(diff).toEqual({
      joinedAt: { from: "2024-09-01T00:00:00.000Z", to: "2024-09-02T00:00:00.000Z" },
    });
    expect(changed).toEqual({ joinedAt: patch.joinedAt });
    expect(changed).not.toHaveProperty("name");
  });

  it("a real name change is recorded and nothing else is dragged along", () => {
    const before = {
      name: "Marites Bautista",
      title: "Accountant",
      departmentId: "dept-1",
      joinedAt: new Date("2024-09-01T07:59:47.133Z"),
    };
    const patch = {
      name: "Marites B. Cruz",
      title: "Accountant",
      departmentId: "dept-1",
      joinedAt: new Date("2024-09-01T00:00:00Z"),
    };
    const { diff, changed } = employeeDiff(before, patch);
    expect(diff).toEqual({ name: { from: "Marites Bautista", to: "Marites B. Cruz" } });
    expect(changed).toEqual({ name: "Marites B. Cruz" });
  });

  it("a key ABSENT from patch never appears in diff nor in the write set", () => {
    const before = { name: "Marites Bautista", title: "Accountant" };
    const patch = { name: "Marites Bautista" }; // no `title` key at all
    const { diff, changed } = employeeDiff(before, patch);
    expect(diff).toEqual({});
    expect(changed).toEqual({});
    expect("title" in diff).toBe(false);
  });
});
