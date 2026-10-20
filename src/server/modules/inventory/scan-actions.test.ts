import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Task 6 review I1 (spec §7.2): Enter in Inventory's search box asks `findExactTag` for an exact tag instead of
 * navigating to `?go=1`. Guarded like the list: a signed-in person, and only an asset whose class the role may see.
 */

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  allowed: true,
  findUnique: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => ({ actionUser: async () => h.user }));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: h.allowed, retryAfterSec: 1 }) }));
vi.mock("@/server/db/client", () => ({ prisma: { asset: { findUnique: h.findUnique } } }));

import { findExactTag } from "./scan-actions";

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1", role: "it_staff" };
  h.allowed = true;
  h.findUnique.mockImplementation(async ({ where }: { where: { tag: string } }) =>
    where.tag === "BR-LT-0148" ? { id: "a148", cls: "IT" } : where.tag === "BR-VH-0001" ? { id: "car1", cls: "PURCHASING" } : null);
});

describe("findExactTag", () => {
  it("finds an exact tag, trimmed and upper-cased, by the unique tag (never an ILIKE)", async () => {
    expect(await findExactTag("  br-lt-0148 ")).toEqual({ id: "a148" });
    expect(h.findUnique).toHaveBeenCalledWith({ where: { tag: "BR-LT-0148" }, select: { id: true, cls: true } });
  });
  it("is null for no match, a non-tag shape or a non-string, without a lookup for the last two", async () => {
    expect(await findExactTag("BR-LT-9999")).toBeNull();
    h.findUnique.mockClear();
    expect(await findExactTag("Carlo Reyes")).toBeNull();
    expect(await findExactTag(42)).toBeNull();
    expect(await findExactTag("")).toBeNull();
    expect(h.findUnique).not.toHaveBeenCalled();
  });
  it("answers only for a class the role may see (the record page would refuse the rest)", async () => {
    h.user = { id: "u1", role: "it_staff" };
    expect(await findExactTag("BR-VH-0001")).toBeNull();
    h.user = { id: "u2", role: "admin" };
    expect(await findExactTag("BR-VH-0001")).toEqual({ id: "car1" });
  });
  it("is null signed out or over the rate limit, with no lookup", async () => {
    h.user = null;
    expect(await findExactTag("BR-LT-0148")).toBeNull();
    h.user = { id: "u1", role: "it_staff" };
    h.allowed = false;
    expect(await findExactTag("BR-LT-0148")).toBeNull();
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});
