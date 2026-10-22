import { describe, expect, it } from "vitest";
import { cuid } from "./cuid";

/*
 * Final review M3: a new PO's id is minted before its files are stored, so it must look like the ids Prisma's
 * `@default(cuid())` makes — 25 characters, "c" then lowercase base-36 — and never repeat.
 */

describe("cuid", () => {
  it("has the shape of Prisma's cuid(): 'c' and 24 lowercase base-36 characters", () => {
    for (let i = 0; i < 50; i++) expect(cuid()).toMatch(/^c[a-z0-9]{24}$/);
  });

  it("never repeats, even many in the same millisecond", () => {
    const ids = Array.from({ length: 5000 }, () => cuid());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts with the time, so a later id sorts after an earlier one's time block", async () => {
    const a = cuid();
    await new Promise((r) => setTimeout(r, 5));
    const b = cuid();
    expect(b.slice(1, 9) > a.slice(1, 9)).toBe(true);
  });
});
