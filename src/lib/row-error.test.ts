import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { classifyRowError, RowWriteError } from "./row-error";

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

function p2003() {
  return new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
    code: "P2003",
    clientVersion: "test",
  });
}

describe("classifyRowError", () => {
  it("passes a RowWriteError's own message straight through, never re-wrapped", () => {
    expect(classifyRowError(new RowWriteError("changed since this import was checked — re-check and retry"), "update"))
      .toBe("changed since this import was checked — re-check and retry");
  });

  it("P2002 on a CREATE row names the double-click possibility, not just a spreadsheet duplicate (I-4)", () => {
    const reason = classifyRowError(p2002(), "create");
    expect(reason).toContain("duplicate a tag or serial already on file");
    expect(reason).toContain("applied twice at once");
  });

  it("P2002 on an UPDATE row does not carry the double-click hedge — this asset really does exist twice", () => {
    const reason = classifyRowError(p2002(), "update");
    expect(reason).toBe("would duplicate a tag or serial already on file");
    expect(reason).not.toContain("applied twice at once");
  });

  it("P2003 names the vanished reference, never the raw Prisma error", () => {
    expect(classifyRowError(p2003(), "update")).toBe("names a category, type or vendor that no longer exists");
  });

  it("an unrecognised error degrades to an actionable, non-Prisma sentence", () => {
    expect(classifyRowError(new Error("ECONNRESET"), "update"))
      .toBe("could not be written — re-check this row and retry");
  });
});
