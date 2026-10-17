import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isDeadlock, isUniqueViolation, uniqueTarget } from "./prisma-errors";

describe("isDeadlock — a deadlock or write conflict, by code", () => {
  const known = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("failed", { code, clientVersion: "6", ...(meta ? { meta } : {}) });
  it("recognises a raw statement's 40P01 (P2010 meta.code) and an interactive transaction's P2034", () => {
    expect(isDeadlock(known("P2010", { code: "40P01", message: "deadlock detected" }))).toBe(true);
    expect(isDeadlock(known("P2034"))).toBe(true);
  });
  it("is false for any other failure", () => {
    expect(isDeadlock(known("P2010", { code: "23505" }))).toBe(false);
    expect(isDeadlock(known("P2025"))).toBe(false);
    expect(isDeadlock(new Error("40P01"))).toBe(false);
  });
});

const p2002 = (target: unknown) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6", meta: { target } });

describe("isUniqueViolation / uniqueTarget — one P2002 reader for every writer", () => {
  it("recognises P2002 and nothing else", () => {
    expect(isUniqueViolation(p2002(["serial"]))).toBe(true);
    expect(isUniqueViolation(new Prisma.PrismaClientKnownRequestError("gone", { code: "P2025", clientVersion: "6" }))).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });
  it("reads a Prisma-declared index's column array and a raw index's name string alike", () => {
    expect(uniqueTarget(p2002(["categoryId", "name"]))).toEqual(["categoryId", "name"]);
    expect(uniqueTarget(p2002("StockCategory_prefix_lower_key"))).toEqual(["StockCategory_prefix_lower_key"]);
    expect(uniqueTarget(p2002(undefined))).toEqual([]);
    expect(uniqueTarget(new Error("boom"))).toEqual([]);
  });
});
