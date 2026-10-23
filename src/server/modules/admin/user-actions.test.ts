import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Users & access (spec §4.4, Task 3): the admin account actions. Each runs as an admin, under the rate limit, in one
 * transaction with guarded writes and an audit entry. The User and Employee tables are an in-memory double; the
 * session version bump is the real one (it increments the row through the same double).
 */

type Row = Record<string, unknown> & { id: string };

const h = vi.hoisted(() => {
  process.env.AUTH_SECRET = "user-actions-test-secret";
  return {
    actor: null as null | Record<string, unknown>,
    users: new Map<string, Record<string, unknown> & { id: string }>(),
    employees: new Map<string, Record<string, unknown> & { id: string }>(),
    audits: [] as Array<Record<string, unknown>>,
    domain: "thebackroomop.com" as string | null,
    checkRate: vi.fn(),
    unstableUpdate: vi.fn(),
    attempts: [] as Array<{ id: string; emailKey: string }>,
    failAttemptDelete: false,
    updateManyCalls: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    seq: 0,
    clock: 0,
  };
});

/** Each write moves updatedAt forward, as Prisma's @updatedAt does. */
const tick = () => new Date(Date.UTC(2026, 9, 24, 9, 0, 0, ++h.clock));

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const matches = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => same(row[k], v));

function applyData(row: Row, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) row[k] = (row[k] as number) + (v as { increment: number }).increment;
    else row[k] = v;
  }
  row.updatedAt = tick();
}

const userTable = {
  async findUnique({ where }: { where: { id?: string; email?: string } }) {
    const row = where.id ? h.users.get(where.id) : [...h.users.values()].find((u) => u.email === where.email);
    return row ? { ...row } : null;
  },
  async create({ data }: { data: Record<string, unknown> }) {
    const row: Row = {
      id: `u-new-${++h.seq}`, disabled: false, isPermanentAdmin: false, approvalState: "APPROVED", sessionVersion: 0,
      mustChangePassword: false, employeeId: null, createdAt: tick(), ...data,
    };
    row.updatedAt = row.createdAt;
    h.users.set(row.id, row);
    return { ...row };
  },
  async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
    h.updateManyCalls.push({ where, data });
    const hit = [...h.users.values()].filter((u) => matches(u, where));
    for (const row of hit) applyData(row, data);
    return { count: hit.length };
  },
  async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
    const row = h.users.get(where.id);
    if (!row) throw new Error("P2025");
    applyData(row, data);
    return { ...row };
  },
};

const employeeTable = {
  async findUnique({ where }: { where: { id: string } }) {
    const e = h.employees.get(where.id);
    if (!e) return null;
    const linked = [...h.users.values()].find((u) => u.employeeId === e.id);
    return { ...e, user: linked ? { id: linked.id } : null };
  },
};

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({
  actionRole: async (...roles: string[]) => (h.actor && roles.includes(h.actor.role as string) ? h.actor : null),
}));
vi.mock("@/server/auth", () => ({ unstable_update: h.unstableUpdate }));
vi.mock("@/server/rate-limit", () => ({ checkRate: h.checkRate }));
vi.mock("@/server/audit", () => ({
  writeAudit: async (_tx: unknown, entry: Record<string, unknown>) => {
    h.audits.push(entry);
    return `a${h.audits.length}`;
  },
}));
vi.mock("@/server/db/client", () => {
  // Getters: the factory is hoisted above the tables' definitions, which are read only when a query runs.
  const prisma = {
    get user() { return userTable; },
    get employee() { return employeeTable; },
    featureFlag: {
      findUnique: async () => (h.domain ? { key: "allowed_domain", enabled: true, value: h.domain } : null),
    },
    signInAttempt: {
      async deleteMany({ where }: { where: { emailKey: { in: string[] } } }) {
        if (h.failAttemptDelete) throw new Error("connection reset");
        const before = h.attempts.length;
        h.attempts = h.attempts.filter((a) => !where.emailKey.in.includes(a.emailKey));
        return { count: before - h.attempts.length };
      },
    },
    // Rolls back like Postgres: a throw inside the callback restores every table to its state before the call.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const users = new Map([...h.users].map(([k, v]) => [k, { ...v }]));
      const audits = [...h.audits];
      const attempts = [...h.attempts];
      try {
        return await fn(prisma);
      } catch (err) {
        h.users.clear();
        for (const [k, v] of users) h.users.set(k, v);
        h.audits = audits;
        h.attempts = attempts;
        throw err;
      }
    },
  };
  return { prisma };
});

import { CHANGED_TRY_AGAIN } from "@/lib/lifecycle";
import { PERMANENT_LOCK } from "@/lib/admin-users";
import { sessionUpdateProof } from "@/server/auth/config.edge";
import {
  approveSignup, createUser, declineSignup, resetUserPassword, setUserDisabled, updateUser,
} from "./user-actions";

const TEMP_SHAPE = /^[A-Z][a-z]{3,6}-[2-9]{4}-[a-z]{4,7}$/;

function put(row: Partial<Row> & { id: string }): Row {
  const full: Row = {
    name: "Nina Reyes", email: `${row.id}@thebackroomop.com`, role: "it_staff", passwordHash: "old-hash",
    isPermanentAdmin: false, disabled: false, approvalState: "APPROVED", sessionVersion: 3, mustChangePassword: false,
    employeeId: null, passwordChangedAt: null, createdAt: tick(), updatedAt: tick(), createdById: null,
    approvalDecidedAt: null, approvalDecidedById: null,
    ...row,
  };
  h.users.set(full.id, full);
  return full;
}

const row = (id: string) => h.users.get(id)!;
const iso = (id: string) => (row(id).updatedAt as Date).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  h.users.clear();
  h.employees.clear();
  h.audits = [];
  h.updateManyCalls = [];
  h.domain = "thebackroomop.com";
  h.failAttemptDelete = false;
  h.attempts = [
    { id: "s1", emailKey: "nina@thebackroomop.com" },
    { id: "s2", emailKey: "CURRENT:nina" },
    { id: "s3", emailKey: "m.cruz@thebackroomop.com" },
  ];
  h.checkRate.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
  h.actor = put({ id: "admin-1", name: "M. Cruz", email: "m.cruz@thebackroomop.com", role: "admin", sessionVersion: 0 });
  put({ id: "perm", name: "Owner Admin", email: "owner@thebackroomop.com", role: "admin", isPermanentAdmin: true });
  put({ id: "nina", email: "nina@thebackroomop.com" });
  h.employees.set("emp-1", { id: "emp-1", employeeNo: "EMP-1042", name: "Nina Reyes", employment: "ACTIVE" });
  h.employees.set("emp-2", { id: "emp-2", employeeNo: "EMP-1043", name: "Ana Lim", employment: "ACTIVE" });
  h.employees.set("emp-gone", { id: "emp-gone", employeeNo: "EMP-0007", name: "Old Hand", employment: "OFFBOARDED" });
});

describe("every action is admin-only and rate-limited", () => {
  it("refuses a non-admin with forbidden and writes nothing", async () => {
    h.actor = { ...row("nina") };
    for (const r of [
      await createUser({ name: "Ana Lim", email: "ana@thebackroomop.com", role: "viewer" }),
      await updateUser({ id: "nina", name: "X", expectedUpdatedAt: iso("nina") }),
      await resetUserPassword({ id: "nina" }),
      await approveSignup({ id: "nina", role: "viewer" }),
      await declineSignup({ id: "nina" }),
    ]) expect(r).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.audits).toEqual([]);
  });

  it("refuses at the rate limit before reading anything", async () => {
    h.checkRate.mockResolvedValue({ allowed: false, retryAfterSec: 9 });
    expect(await resetUserPassword({ id: "nina" })).toMatchObject({ ok: false, kind: "rate_limited", retryAfterSec: 9 });
    expect(h.checkRate).toHaveBeenCalledWith("admin-1");
    expect(row("nina").sessionVersion).toBe(3);
  });
});

describe("the permanent admin is refused for every action, with the lock copy", () => {
  it.each([
    ["role", () => updateUser({ id: "perm", role: "viewer", expectedUpdatedAt: iso("perm") })],
    ["turn off", () => setUserDisabled({ userId: "perm", disabled: true })],
    ["reset", () => resetUserPassword({ id: "perm" })],
    ["name", () => updateUser({ id: "perm", name: "Someone Else", expectedUpdatedAt: iso("perm") })],
    ["email", () => updateUser({ id: "perm", email: "x@thebackroomop.com", expectedUpdatedAt: iso("perm") })],
    ["employee link", () => updateUser({ id: "perm", employeeId: "emp-1", expectedUpdatedAt: iso("perm") })],
    ["approve", () => approveSignup({ id: "perm", role: "viewer" })],
    ["decline", () => declineSignup({ id: "perm" })],
  ])("%s", async (_label, run) => {
    const before = { ...row("perm") };
    expect(await run()).toEqual({ ok: false, kind: "conflict", message: PERMANENT_LOCK });
    expect(row("perm")).toEqual(before);
    expect(h.audits).toEqual([]);
    expect(h.updateManyCalls).toEqual([]);
  });
});

describe("createUser", () => {
  it("creates an APPROVED account that must set its password, created by the admin", async () => {
    const r = await createUser({ name: "  Ana Lim ", email: " Ana.Lim@TheBackroomOp.com ", role: "finance_staff", employeeId: "emp-2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = row(r.data.id);
    expect(created).toMatchObject({
      name: "Ana Lim", email: "ana.lim@thebackroomop.com", role: "finance_staff", employeeId: "emp-2",
      approvalState: "APPROVED", disabled: false, mustChangePassword: true, createdById: "admin-1",
    });
    expect(created.passwordChangedAt).toBeInstanceOf(Date);
    expect(r.data.tempPassword).toMatch(TEMP_SHAPE);
    expect(await bcrypt.compare(r.data.tempPassword, created.passwordHash as string)).toBe(true);
    expect(bcrypt.getRounds(created.passwordHash as string)).toBe(10);
  });

  it("audits user.create with no password, hash or temporary password anywhere in it", async () => {
    const r = await createUser({ name: "Ana Lim", email: "ana.lim@thebackroomop.com", role: "viewer" });
    if (!r.ok) throw new Error("expected ok");
    expect(h.audits).toHaveLength(1);
    const entry = h.audits[0];
    expect(entry).toMatchObject({ action: "user.create", entityType: "user", entityId: r.data.id, actorId: "admin-1", source: "web" });
    const text = JSON.stringify(entry);
    expect(text).not.toContain(r.data.tempPassword);
    expect(text).not.toContain(row(r.data.id).passwordHash as string);
    expect(entry.diff).not.toHaveProperty("tempPassword");
    expect(entry.diff).not.toHaveProperty("passwordHash");
    expect(entry.diff).not.toHaveProperty("password");
  });

  it("refuses an email outside the allowed domain", async () => {
    const r = await createUser({ name: "Ana Lim", email: "ana@gmail.com", role: "viewer" });
    expect(r).toMatchObject({ ok: false, kind: "validation", fieldErrors: { email: "Use an @thebackroomop.com address." } });
    expect(h.users.size).toBe(3);
  });

  it("refuses an email another account already uses, whatever its case or spaces", async () => {
    const r = await createUser({ name: "Nina Two", email: "  NINA@thebackroomop.com ", role: "viewer" });
    expect(r).toMatchObject({ ok: false, kind: "validation", fieldErrors: { email: "Another account already uses that email." } });
    expect(h.audits).toEqual([]);
  });

  it("refuses an employee who already has an account, and one who isn't active", async () => {
    row("nina").employeeId = "emp-1";
    expect(await createUser({ name: "Ana Lim", email: "ana@thebackroomop.com", role: "viewer", employeeId: "emp-1" }))
      .toMatchObject({ ok: false, kind: "validation", fieldErrors: { employeeId: "That employee already has an account." } });
    expect(await createUser({ name: "Ana Lim", email: "ana@thebackroomop.com", role: "viewer", employeeId: "emp-gone" }))
      .toMatchObject({ ok: false, kind: "validation", fieldErrors: { employeeId: "Only an active employee can be linked." } });
    expect(h.users.size).toBe(3);
  });

  it("refuses a missing name and an unknown role", async () => {
    expect(await createUser({ name: " ", email: "ana@thebackroomop.com", role: "viewer" })).toMatchObject({ kind: "validation" });
    expect(await createUser({ name: "Ana Lim", email: "ana@thebackroomop.com", role: "root" })).toMatchObject({ kind: "validation" });
  });
});

describe("updateUser", () => {
  it("writes a role and an email change in one guarded write and bumps the version once", async () => {
    const r = await updateUser({ id: "nina", role: "finance_staff", email: "Nina.Reyes@thebackroomop.com", expectedUpdatedAt: iso("nina") });
    expect(r).toMatchObject({ ok: true, data: { changed: true, signsOutActor: false } });
    expect(row("nina")).toMatchObject({ role: "finance_staff", email: "nina.reyes@thebackroomop.com", sessionVersion: 4 });
    expect(h.updateManyCalls).toHaveLength(1);
    expect(h.updateManyCalls[0].where).toMatchObject({ id: "nina", isPermanentAdmin: false });
    expect(h.updateManyCalls[0].where.updatedAt).toBeInstanceOf(Date);
    expect(h.audits.map((a) => a.action).sort()).toEqual(["role-change", "user.update"]);
    expect(h.audits.find((a) => a.action === "role-change")!.diff).toEqual({ role: { from: "it_staff", to: "finance_staff" } });
    expect(h.audits.find((a) => a.action === "user.update")!.diff).toEqual({
      email: { from: "nina@thebackroomop.com", to: "nina.reyes@thebackroomop.com" },
    });
    // Another person's account: their sessions end at the guards; nobody's session is updated here.
    expect(h.unstableUpdate).not.toHaveBeenCalled();
  });

  it("an employee-link or name change doesn't bump the version", async () => {
    const r = await updateUser({ id: "nina", employeeId: "emp-1", name: "Nina R. Reyes", expectedUpdatedAt: iso("nina") });
    expect(r).toMatchObject({ ok: true, data: { changed: true } });
    expect(row("nina")).toMatchObject({ employeeId: "emp-1", name: "Nina R. Reyes", sessionVersion: 3 });
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "user.update",
        diff: { employeeId: { from: null, to: "emp-1" }, name: { from: "Nina Reyes", to: "Nina R. Reyes" } },
      }),
    ]);
  });

  it("unlinks with employeeId null", async () => {
    row("nina").employeeId = "emp-1";
    const r = await updateUser({ id: "nina", employeeId: null, expectedUpdatedAt: iso("nina") });
    expect(r.ok).toBe(true);
    expect(row("nina").employeeId).toBeNull();
  });

  it("a stale expectedUpdatedAt is a conflict with the existing copy, and nothing is written", async () => {
    const stale = iso("nina");
    await updateUser({ id: "nina", name: "Someone's first edit", expectedUpdatedAt: stale });
    h.audits = [];
    h.updateManyCalls = [];
    const before = { ...row("nina") };
    expect(await updateUser({ id: "nina", role: "viewer", expectedUpdatedAt: stale })).toEqual({
      ok: false, kind: "conflict", message: CHANGED_TRY_AGAIN,
    });
    expect(row("nina")).toEqual(before);
    expect(h.audits).toEqual([]);
    expect(h.updateManyCalls).toEqual([]);
  });

  it("the guarded write itself refuses a row that moved after the read", async () => {
    const expected = iso("nina");
    const realUpdateMany = userTable.updateMany;
    // Another admin's save lands between this action's read and its write.
    userTable.updateMany = async (args) => {
      row("nina").updatedAt = tick();
      return realUpdateMany(args);
    };
    try {
      expect(await updateUser({ id: "nina", role: "viewer", expectedUpdatedAt: expected })).toEqual({
        ok: false, kind: "conflict", message: CHANGED_TRY_AGAIN,
      });
    } finally {
      userTable.updateMany = realUpdateMany;
    }
    expect(row("nina")).toMatchObject({ role: "it_staff", sessionVersion: 3 });
    expect(h.audits).toEqual([]);
  });

  it("linking an employee already linked elsewhere is a validation error", async () => {
    put({ id: "ana", email: "ana@thebackroomop.com", employeeId: "emp-2" });
    expect(await updateUser({ id: "nina", employeeId: "emp-2", expectedUpdatedAt: iso("nina") })).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { employeeId: "That employee already has an account." },
    });
    expect(row("nina").employeeId).toBeNull();
  });

  it("refuses an email outside the domain or used by another account", async () => {
    expect(await updateUser({ id: "nina", email: "nina@gmail.com", expectedUpdatedAt: iso("nina") }))
      .toMatchObject({ kind: "validation", fieldErrors: { email: "Use an @thebackroomop.com address." } });
    expect(await updateUser({ id: "nina", email: "M.Cruz@thebackroomop.com", expectedUpdatedAt: iso("nina") }))
      .toMatchObject({ kind: "validation", fieldErrors: { email: "Another account already uses that email." } });
  });

  it("no change is a no-op: no write, no audit", async () => {
    const r = await updateUser({ id: "nina", name: "Nina Reyes", email: "NINA@thebackroomop.com", role: "it_staff", expectedUpdatedAt: iso("nina") });
    expect(r).toMatchObject({ ok: true, data: { changed: false } });
    expect(h.updateManyCalls).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("an admin changing their own email keeps this session with a signed update", async () => {
    const r = await updateUser({ id: "admin-1", email: "mcruz@thebackroomop.com", expectedUpdatedAt: iso("admin-1") });
    expect(r).toMatchObject({ ok: true, data: { changed: true, signsOutActor: false } });
    expect(row("admin-1").sessionVersion).toBe(1);
    expect(h.unstableUpdate).toHaveBeenCalledTimes(1);
    expect(h.unstableUpdate).toHaveBeenCalledWith({
      sessionVersion: 1, mustChangePassword: false, proof: await sessionUpdateProof("admin-1", 1, false),
    });
  });

  it("an admin changing their own role is told they'll be signed out", async () => {
    const r = await updateUser({ id: "admin-1", role: "viewer", expectedUpdatedAt: iso("admin-1") });
    expect(r).toMatchObject({ ok: true, data: { changed: true, signsOutActor: true } });
  });
});

describe("resetUserPassword", () => {
  it("sets a new temporary password, owes a new one, bumps the version and clears the failures", async () => {
    const r = await resetUserPassword({ id: "nina" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.tempPassword).toMatch(TEMP_SHAPE);
    expect(row("nina")).toMatchObject({ mustChangePassword: true, sessionVersion: 4 });
    expect(row("nina").passwordChangedAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare(r.data.tempPassword, row("nina").passwordHash as string)).toBe(true);
    // Both buckets cleared, in the reset's own transaction; another email's count is untouched.
    expect(h.attempts.map((a) => a.emailKey)).toEqual(["m.cruz@thebackroomop.com"]);
    expect(h.unstableUpdate).not.toHaveBeenCalled();
  });

  it("audits password.reset without the password, its hash or the temporary password", async () => {
    const r = await resetUserPassword({ id: "nina" });
    if (!r.ok) throw new Error("expected ok");
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ action: "password.reset", entityId: "nina", actorId: "admin-1", source: "web" });
    const text = JSON.stringify(h.audits[0]);
    expect(text).not.toContain(r.data.tempPassword);
    expect(text).not.toContain(row("nina").passwordHash as string);
    expect(text).not.toContain("old-hash");
  });

  it("is guarded on the version it read", async () => {
    await resetUserPassword({ id: "nina" });
    expect(h.updateManyCalls[0].where).toMatchObject({ id: "nina", sessionVersion: 3, isPermanentAdmin: false });
  });

  // Fix round 1 (#1): the clears are in the reset's transaction, so a reset never stands without its password shown.
  it("rolls the whole reset back when clearing the failure counts fails", async () => {
    const before = { ...row("nina") };
    h.failAttemptDelete = true;
    await expect(resetUserPassword({ id: "nina" })).rejects.toThrow("connection reset");
    expect(row("nina")).toEqual(before); // same hash, version and owed flag
    expect(h.audits).toEqual([]);
    expect(h.attempts).toHaveLength(3);
  });

  it("refuses your own account (Account settings is the place) and an account waiting for approval", async () => {
    expect(await resetUserPassword({ id: "admin-1" })).toMatchObject({ ok: false, kind: "conflict" });
    put({ id: "pend", approvalState: "PENDING", disabled: true });
    expect(await resetUserPassword({ id: "pend" })).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.audits).toEqual([]);
    expect(h.attempts).toHaveLength(3);
  });
});

describe("setUserDisabled", () => {
  it("turning an account off bumps its version", async () => {
    expect(await setUserDisabled({ userId: "nina", disabled: true })).toEqual({ ok: true, data: { changed: true } });
    expect(row("nina")).toMatchObject({ disabled: true, sessionVersion: 4 });
    expect(h.audits[0]).toMatchObject({ action: "disable" });
  });

  it("refuses turning off your own account", async () => {
    const r = await setUserDisabled({ userId: "admin-1", disabled: true });
    expect(r).toMatchObject({ ok: false, kind: "conflict" });
    expect(r.ok === false && r.message).toMatch(/your own account/i);
    expect(row("admin-1").disabled).toBe(false);
  });

  it("refuses an account waiting for approval: approve or decline it instead", async () => {
    put({ id: "pend", approvalState: "PENDING", disabled: true });
    expect(await setUserDisabled({ userId: "pend", disabled: false })).toMatchObject({ ok: false, kind: "conflict" });
    expect(row("pend").disabled).toBe(true);
  });

  it("with expectedUpdatedAt, a row changed meanwhile is a conflict", async () => {
    const stale = iso("nina");
    await updateUser({ id: "nina", role: "viewer", expectedUpdatedAt: stale });
    expect(await setUserDisabled({ userId: "nina", disabled: true, expectedUpdatedAt: stale })).toEqual({
      ok: false, kind: "conflict", message: CHANGED_TRY_AGAIN,
    });
    expect(row("nina").disabled).toBe(false);
  });
});

describe("approveSignup and declineSignup", () => {
  beforeEach(() => {
    put({ id: "pend", name: "Ana Lim", email: "ana.lim@thebackroomop.com", role: "viewer", approvalState: "PENDING", disabled: true, sessionVersion: 0 });
  });

  it("approve sets APPROVED, turns the account on, and saves the role and link", async () => {
    expect(await approveSignup({ id: "pend", role: "finance_staff", employeeId: "emp-2" })).toMatchObject({ ok: true });
    expect(row("pend")).toMatchObject({
      approvalState: "APPROVED", disabled: false, role: "finance_staff", employeeId: "emp-2",
      approvalDecidedById: "admin-1", mustChangePassword: false,
    });
    expect(row("pend").approvalDecidedAt).toBeInstanceOf(Date);
    expect(h.updateManyCalls[0].where).toMatchObject({ id: "pend", approvalState: "PENDING", isPermanentAdmin: false });
    expect(h.audits).toEqual([expect.objectContaining({
      action: "user.approve", entityId: "pend",
      diff: {
        approvalState: { from: "PENDING", to: "APPROVED" },
        disabled: { from: true, to: false },
        role: { from: "viewer", to: "finance_staff" },
        employeeId: { from: null, to: "emp-2" },
      },
    })]);
  });

  it("decline sets DECLINED and leaves the account off", async () => {
    expect(await declineSignup({ id: "pend" })).toMatchObject({ ok: true });
    expect(row("pend")).toMatchObject({ approvalState: "DECLINED", disabled: true, approvalDecidedById: "admin-1" });
    expect(h.updateManyCalls[0].where).toMatchObject({ id: "pend", approvalState: "PENDING" });
    expect(h.audits).toEqual([expect.objectContaining({
      action: "user.decline", diff: { approvalState: { from: "PENDING", to: "DECLINED" } },
    })]);
  });

  it("a declined sign-up can still be approved", async () => {
    await declineSignup({ id: "pend" });
    expect(await approveSignup({ id: "pend", role: "viewer" })).toMatchObject({ ok: true });
    expect(row("pend")).toMatchObject({ approvalState: "APPROVED", disabled: false });
  });

  it("approving an account that isn't waiting or declined is a conflict", async () => {
    expect(await approveSignup({ id: "nina", role: "viewer" })).toMatchObject({ ok: false, kind: "conflict" });
    expect(row("nina").role).toBe("it_staff");
    expect(h.audits).toEqual([]);
  });

  it("declining an account that isn't waiting is a conflict", async () => {
    await declineSignup({ id: "pend" });
    h.audits = [];
    expect(await declineSignup({ id: "pend" })).toMatchObject({ ok: false, kind: "conflict" });
    expect(await declineSignup({ id: "nina" })).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.audits).toEqual([]);
  });

  it("approve refuses an employee already linked elsewhere", async () => {
    row("nina").employeeId = "emp-2";
    expect(await approveSignup({ id: "pend", role: "viewer", employeeId: "emp-2" })).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { employeeId: "That employee already has an account." },
    });
    expect(row("pend").approvalState).toBe("PENDING");
  });

  it("approve with expectedUpdatedAt: a row edited since is a conflict, and the guard carries it", async () => {
    const stale = iso("pend");
    await updateUser({ id: "pend", name: "Ana B. Lim", expectedUpdatedAt: stale });
    h.audits = [];
    h.updateManyCalls = [];
    expect(await approveSignup({ id: "pend", role: "viewer", expectedUpdatedAt: stale })).toEqual({
      ok: false, kind: "conflict", message: CHANGED_TRY_AGAIN,
    });
    expect(row("pend").approvalState).toBe("PENDING");
    expect(h.updateManyCalls).toEqual([]);
    expect(await approveSignup({ id: "pend", role: "viewer", expectedUpdatedAt: iso("pend") })).toMatchObject({ ok: true });
    expect(h.updateManyCalls[0].where.updatedAt).toBeInstanceOf(Date);
  });

  /** Another admin's decision lands between this action's read and its guarded write. */
  async function withDecisionBetween(state: "APPROVED" | "DECLINED", run: () => Promise<unknown>) {
    const realUpdateMany = userTable.updateMany;
    userTable.updateMany = async (args) => {
      row("pend").approvalState = state;
      return realUpdateMany(args);
    };
    try {
      return await run();
    } finally {
      userTable.updateMany = realUpdateMany;
    }
  }

  it("approve loses the race to a decision made after its read: conflict, nothing written", async () => {
    const r = await withDecisionBetween("DECLINED", () => approveSignup({ id: "pend", role: "finance_staff" }));
    expect(r).toEqual({ ok: false, kind: "conflict", message: "Someone else just decided this sign-up — refresh." });
    expect(row("pend")).toMatchObject({ approvalState: "DECLINED", role: "viewer", disabled: true, approvalDecidedById: null });
    expect(h.audits).toEqual([]);
  });

  it("decline loses the race to an approval made after its read: conflict, nothing written", async () => {
    const r = await withDecisionBetween("APPROVED", () => declineSignup({ id: "pend" }));
    expect(r).toEqual({ ok: false, kind: "conflict", message: "Someone else just decided this sign-up — refresh." });
    expect(row("pend")).toMatchObject({ approvalState: "APPROVED", approvalDecidedById: null });
    expect(h.audits).toEqual([]);
  });

  // Fix round 1 (#3): a sign-up's role is chosen by Approve, never by Save.
  it("updateUser refuses a role change on a sign-up that isn't approved, but still edits its name", async () => {
    for (const state of ["PENDING", "DECLINED"] as const) {
      row("pend").approvalState = state;
      expect(await updateUser({ id: "pend", role: "admin", expectedUpdatedAt: iso("pend") })).toEqual({
        ok: false, kind: "conflict", message: "This sign-up hasn't been approved — choose the role when you approve it.",
      });
      expect(row("pend")).toMatchObject({ role: "viewer", sessionVersion: 0 });
    }
    expect(h.updateManyCalls).toEqual([]);
    expect(await updateUser({ id: "pend", name: "Ana B. Lim", expectedUpdatedAt: iso("pend") })).toMatchObject({ ok: true });
  });
});
