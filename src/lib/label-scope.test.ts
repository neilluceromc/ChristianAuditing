import { describe, expect, it } from "vitest";
import type { AssetClass, Prisma } from "@prisma/client";
import { labelScope } from "./label-scope";

interface Row { cls: AssetClass; recordCreatedBy: string | null }

/** Reads the where-input the way Postgres would for the two shapes `labelScope` uses. */
function matches(where: Prisma.AssetWhereInput, row: Row): boolean {
  const branches = where.OR as Prisma.AssetWhereInput[];
  return branches.some((b) => {
    if (b.cls) return ((b.cls as { in: AssetClass[] }).in).includes(row.cls);
    const by = (b.purchaseRecord as { createdById: string } | undefined)?.createdById;
    return by !== undefined && row.recordCreatedBy === by;
  });
}

describe("labelScope (ruling R20)", () => {
  it("is the managed classes OR the user's own purchase records", () => {
    expect(labelScope(["PURCHASING"], "u1")).toEqual({
      OR: [{ cls: { in: ["PURCHASING"] } }, { purchaseRecord: { createdById: "u1" } }],
    });
  });

  it("does not alias the caller's class list", () => {
    const classes: AssetClass[] = ["IT"];
    const where = labelScope(classes, "u1");
    classes.push("PURCHASING");
    expect((where.OR as Array<{ cls?: { in: AssetClass[] } }>)[0].cls?.in).toEqual(["IT"]);
  });

  it("takes an asset of a managed class, and the user's own registration of another class", () => {
    const where = labelScope(["PURCHASING"], "purchasing-user");
    expect(matches(where, { cls: "PURCHASING", recordCreatedBy: null })).toBe(true);
    expect(matches(where, { cls: "IT", recordCreatedBy: "purchasing-user" })).toBe(true);
  });

  it("excludes an asset outside both the classes and the user's own records", () => {
    const where = labelScope(["PURCHASING"], "purchasing-user");
    // IT's own batch, registered by IT staff: not managed, not this user's record.
    expect(matches(where, { cls: "IT", recordCreatedBy: "it-user" })).toBe(false);
    // An existing IT asset with no purchase record at all.
    expect(matches(where, { cls: "IT", recordCreatedBy: null })).toBe(false);
  });

  it("with no managed class, only the user's own records are in scope", () => {
    const where = labelScope([], "u1");
    expect(matches(where, { cls: "IT", recordCreatedBy: "u1" })).toBe(true);
    expect(matches(where, { cls: "IT", recordCreatedBy: "u2" })).toBe(false);
  });
});
