import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Users & access (spec §4.4, Task 3): listUsers' rows, its waiting count and its filters. Prisma is stubbed; the
 * wheres are the pure ones from @/lib/admin-lists, so the filters are asserted by what reaches the query.
 */

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@/server/db/client", () => {
  const prisma = {
    user: { findMany: h.findMany, findUnique: h.findUnique, count: h.count, groupBy: h.groupBy },
    featureFlag: { findMany: async () => [] },
    webhookEndpoint: { count: async () => 0 },
    webhookDelivery: { count: async () => 0 },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma };
});

import { ACTIVE_ACCOUNTS_WHERE, userStatusWhere, usersListWhere } from "@/lib/admin-lists";
import { PERMANENT_LOCK } from "@/lib/admin-users";
import { adminHome, findUserRow, listUsers } from "./queries";

const at = (s: string) => new Date(`2026-10-${s}Z`);

function dbRow(over: Record<string, unknown>) {
  return {
    id: "u", name: "Nina Reyes", email: "nina@thebackroomop.com", role: "it_staff", isPermanentAdmin: false,
    disabled: false, passwordHash: "hash", approvalState: "APPROVED", mustChangePassword: false,
    lastSignInAt: null, passwordChangedAt: null, createdAt: at("01T09:00:00"), updatedAt: at("02T09:00:00"),
    createdBy: null, employee: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.count.mockResolvedValue(0);
  h.groupBy.mockResolvedValue([]);
  h.findMany.mockResolvedValue([]);
});

describe("listUsers", () => {
  it("maps each row's status: approval state first, then disabled, then the owed password", async () => {
    h.count.mockResolvedValue(5);
    h.findMany.mockResolvedValue([
      dbRow({ id: "p", approvalState: "PENDING", disabled: true }),
      dbRow({ id: "d", approvalState: "DECLINED", disabled: true }),
      dbRow({ id: "off", disabled: true, mustChangePassword: true }),
      dbRow({ id: "must", mustChangePassword: true }),
      dbRow({ id: "ok" }),
    ]);
    const { rows } = await listUsers({}, 1);
    expect(rows.map((r) => [r.id, r.status, r.statusLabel])).toEqual([
      ["p", "PENDING", "Waiting for approval"],
      ["d", "DECLINED", "Declined"],
      ["off", "DISABLED", "Disabled"],
      ["must", "MUST_SET_PASSWORD", "Must set password"],
      ["ok", "ACTIVE", "Active"],
    ]);
  });

  it("carries the sign-in facts, the creator's name and the approval state, never the hash", async () => {
    h.count.mockResolvedValue(1);
    h.findMany.mockResolvedValue([
      dbRow({
        id: "n", lastSignInAt: at("20T01:02:03"), passwordChangedAt: at("19T00:00:00"), mustChangePassword: true,
        createdBy: { name: "M. Cruz" },
      }),
    ]);
    const [row] = (await listUsers({}, 1)).rows;
    expect(row).toMatchObject({
      id: "n", approvalState: "APPROVED", mustChangePassword: true, createdByName: "M. Cruz",
      lastSignInAt: "2026-10-20T01:02:03.000Z", passwordChangedAt: "2026-10-19T00:00:00.000Z",
      createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-02T09:00:00.000Z", employee: null, locked: null,
    });
    expect(JSON.stringify(row)).not.toContain("hash");
  });

  it("gives the linked employee with its group, and offboarded for a leaver", async () => {
    h.count.mockResolvedValue(3);
    h.findMany.mockResolvedValue([
      dbRow({ id: "a", employee: { id: "e1", employeeNo: "EMP-1042", name: "Nina Reyes", employment: "ACTIVE", department: { name: "Finance", kind: "INTERNAL" } } }),
      dbRow({ id: "b", employee: { id: "e2", employeeNo: "EMP-1043", name: "Ana Lim", employment: "OFFBOARDED", department: { name: "Acme", kind: "CLIENT" } } }),
      dbRow({ id: "c", employee: { id: "e3", employeeNo: "EMP-1044", name: "Leo Tan", employment: "OFFBOARDING", department: { name: "IT", kind: "INTERNAL" } } }),
    ]);
    const { rows } = await listUsers({}, 1);
    expect(rows.map((r) => r.employee)).toEqual([
      { id: "e1", employeeNo: "EMP-1042", name: "Nina Reyes", groupLabel: "Finance", offboarded: false },
      { id: "e2", employeeNo: "EMP-1043", name: "Ana Lim", groupLabel: "Client: Acme", offboarded: true },
      { id: "e3", employeeNo: "EMP-1044", name: "Leo Tan", groupLabel: "IT", offboarded: true },
    ]);
  });

  it("locks the permanent admin's row with the lock copy", async () => {
    h.count.mockResolvedValue(1);
    h.findMany.mockResolvedValue([dbRow({ id: "perm", role: "admin", isPermanentAdmin: true })]);
    expect((await listUsers({}, 1)).rows[0].locked).toBe(PERMANENT_LOCK);
  });

  it("counts the sign-ups waiting for approval, whatever the filters", async () => {
    h.count.mockImplementation(async ({ where }: { where: unknown }) =>
      JSON.stringify(where) === JSON.stringify(usersListWhere({ status: "PENDING" })) ? 2 : 0);
    const r = await listUsers({ role: "admin", q: "zzz" }, 1);
    expect(r.pendingCount).toBe(2);
  });

  it("filters the page and its total by role, status and search", async () => {
    const filter = { role: "finance_staff" as const, status: "ACTIVE" as const, q: "fin" };
    await listUsers(filter, 1);
    const where = usersListWhere(filter);
    expect(h.count).toHaveBeenCalledWith({ where });
    expect(h.findMany.mock.calls[0][0].where).toEqual(where);
  });

  it("counts each role under the other filters, for the role tabs", async () => {
    h.groupBy.mockResolvedValue([{ role: "admin", _count: { _all: 2 } }, { role: "viewer", _count: { _all: 5 } }]);
    const r = await listUsers({ role: "admin", status: "ACTIVE", q: "a" }, 1);
    expect(h.groupBy).toHaveBeenCalledWith({
      by: ["role"], where: usersListWhere({ status: "ACTIVE", q: "a" }), _count: { _all: true },
    });
    expect(r.roleCounts).toEqual({ admin: 2, it_staff: 0, purchasing_staff: 0, finance_staff: 0, viewer: 5 });
  });
});

// Task 4: `?sel=` names someone the current page doesn't list (just created, or filtered out); the panel still opens.
describe("findUserRow", () => {
  it("is the same row listUsers would give, by id, never with the hash", async () => {
    h.findUnique.mockResolvedValue(dbRow({ id: "n", createdBy: { name: "M. Cruz" }, mustChangePassword: true }));
    const row = await findUserRow("n");
    expect(h.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "n" } }));
    expect(row).toMatchObject({ id: "n", status: "MUST_SET_PASSWORD", createdByName: "M. Cruz", signIn: "credentials" });
    expect(JSON.stringify(row)).not.toContain("hash");
  });

  it("is null for an unknown id", async () => {
    h.findUnique.mockResolvedValue(null);
    expect(await findUserRow("gone")).toBeNull();
  });
});

// Task 4 fix round 1 (ruling): the Admin overview's account tiles count what their links list. "Disabled accounts" is
// the Disabled status (approved, turned off), never a waiting or declined sign-up; "Active accounts" is the accounts
// that can sign in (approved, turned on).
describe("adminHome's account counts", () => {
  it("counts Disabled as the Disabled status and Active as approved and turned on", async () => {
    h.groupBy.mockResolvedValue([{ role: "viewer", _count: { _all: 9 } }]);
    h.count.mockImplementation(async ({ where }: { where: unknown }) =>
      JSON.stringify(where) === JSON.stringify(userStatusWhere("DISABLED")) ? 2
        : JSON.stringify(where) === JSON.stringify(ACTIVE_ACCOUNTS_WHERE) ? 5 : -1,
    );
    const home = await adminHome();
    expect(home.users).toMatchObject({ total: 9, disabled: 2, active: 5 });
    expect(h.count).toHaveBeenCalledWith({ where: { approvalState: "APPROVED", disabled: true } });
    expect(h.count).toHaveBeenCalledWith({ where: { approvalState: "APPROVED", disabled: false } });
  });
});
