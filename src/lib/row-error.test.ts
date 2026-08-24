import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { classifyRowError, RowWriteError, type RowErrorSubject } from "./row-error";

/** The employee importer's own subject (`employee-actions.ts`), retyped here
 * on purpose — a shared import would let the test drift silently if the
 * production constant were ever edited to say something else entirely. */
const EMPLOYEE_SUBJECT: RowErrorSubject = {
  unique: "an employee number already on file",
  fk: "a department that no longer exists",
};

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

  // Task 12, E-9: the default subject is asset-shaped, and the whole point of
  // parameterising it is that a caller CAN say something true for its own
  // entity instead of "a tag or serial" on an employee row.
  it("a supplied subject replaces the default asset wording on both error codes", () => {
    expect(classifyRowError(p2002(), "update", EMPLOYEE_SUBJECT))
      .toBe("would duplicate an employee number already on file");
    expect(classifyRowError(p2003(), "update", EMPLOYEE_SUBJECT))
      .toBe("names a department that no longer exists");
  });

  it("the create-side double-click hedge still applies with a supplied subject", () => {
    const reason = classifyRowError(p2002(), "create", EMPLOYEE_SUBJECT);
    expect(reason).toContain("duplicate an employee number already on file");
    expect(reason).toContain("applied twice at once");
  });

  it("omitting the subject keeps every existing call site's exact wording", () => {
    expect(classifyRowError(p2002(), "update")).toBe("would duplicate a tag or serial already on file");
    expect(classifyRowError(p2003(), "update")).toBe("names a category, type or vendor that no longer exists");
  });
});
