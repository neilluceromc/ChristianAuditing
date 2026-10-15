import { describe, expect, it } from "vitest";
import { peopleQuerySchema, peopleWhere } from "./people-search";

describe("people search (Phase 36 spec §4.1)", () => {
  it("q is 1-60 trimmed characters; scope is required", () => {
    expect(peopleQuerySchema.safeParse({ q: " ana ", scope: "active" }).success).toBe(true);
    expect(peopleQuerySchema.safeParse({ q: "  ", scope: "active" }).success).toBe(false);
    expect(peopleQuerySchema.safeParse({ q: "x".repeat(61), scope: "active" }).success).toBe(false);
    expect(peopleQuerySchema.safeParse({ q: "ana" }).success).toBe(false);
  });
  it("searchPeople is for the pickers: only the active scope, and no class to cross", () => {
    expect(peopleQuerySchema.safeParse({ q: "ana", scope: "assignees" }).success).toBe(false);
    expect(peopleQuerySchema.safeParse({ q: "ana", scope: "active", cls: "PURCHASING" }).data).toEqual({ q: "ana", scope: "active" });
  });
  it("active scope: ACTIVE employees by name or employee no.", () => {
    expect(peopleWhere("ana", "active")).toEqual({
      employment: "ACTIVE",
      OR: [{ name: { contains: "ana", mode: "insensitive" } }, { employeeNo: { contains: "ana", mode: "insensitive" } }],
    });
  });
  it("assignees scope: anyone holding an asset of the class", () => {
    expect(peopleWhere("042", "assignees", "IT")).toEqual({
      assets: { some: { cls: "IT" } },
      OR: [{ name: { contains: "042", mode: "insensitive" } }, { employeeNo: { contains: "042", mode: "insensitive" } }],
    });
  });
});
