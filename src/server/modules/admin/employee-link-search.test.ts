import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Users & access (spec §4.4, Task 3): the employee record picker searches ACTIVE employees with no account yet,
 * admin only. Each option reads "EMP-1042 · Finance" (or "Client: X") under the name.
 */

const h = vi.hoisted(() => ({
  actor: null as null | { id: string; role: string },
  findMany: vi.fn(),
  checkRate: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({
  actionRole: async (...roles: string[]) => (h.actor && roles.includes(h.actor.role) ? h.actor : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: h.checkRate }));
vi.mock("@/server/db/client", () => ({ prisma: { employee: { findMany: h.findMany } } }));

import { PEOPLE_LIMIT } from "@/lib/people-search";
import { searchLinkableEmployees } from "./employee-link-search";

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { id: "admin-1", role: "admin" };
  h.checkRate.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  h.findMany.mockResolvedValue([
    { id: "e1", name: "Nina Reyes", employeeNo: "EMP-1042", department: { name: "Finance", kind: "INTERNAL" } },
    { id: "e2", name: "Ana Lim", employeeNo: "EMP-1043", department: { name: "Acme", kind: "CLIENT" } },
  ]);
});

describe("searchLinkableEmployees", () => {
  it("returns active, unlinked employees as options with the number and group", async () => {
    const r = await searchLinkableEmployees(" nin ");
    expect(r).toEqual({
      ok: true,
      data: [
        { value: "e1", label: "Nina Reyes", sub: "EMP-1042 · Finance" },
        { value: "e2", label: "Ana Lim", sub: "EMP-1043 · Client: Acme" },
      ],
    });
    const args = h.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      employment: "ACTIVE",
      user: { is: null },
      OR: [
        { name: { contains: "nin", mode: "insensitive" } },
        { employeeNo: { contains: "nin", mode: "insensitive" } },
      ],
    });
    expect(args.take).toBe(PEOPLE_LIMIT);
    expect(h.checkRate).toHaveBeenCalledWith("admin-1", "check");
  });

  it("is admin only", async () => {
    h.actor = { id: "it-1", role: "it_staff" };
    expect(await searchLinkableEmployees("nin")).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("refuses empty or over-long text", async () => {
    expect(await searchLinkableEmployees("  ")).toMatchObject({ ok: false, kind: "validation" });
    expect(await searchLinkableEmployees("x".repeat(61))).toMatchObject({ ok: false, kind: "validation" });
    expect(await searchLinkableEmployees(42)).toMatchObject({ ok: false, kind: "validation" });
  });
});
