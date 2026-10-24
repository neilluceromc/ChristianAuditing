import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { recoverPermanentAdmin, runRecover, type RecoverDb } from "./admin-recover";

/*
 * Users & access (spec §4.4, Recovery): `npm run admin:recover -- --email <address>` gives the permanent admin a new
 * temporary password. It works on the permanent admin only, prints the password once, never prints DATABASE_URL,
 * and writes the audit entry password.reset with source "cli". An in-memory double stands in for the database.
 */

type UserRow = {
  id: string; email: string; name: string; isPermanentAdmin: boolean; passwordHash: string | null;
  mustChangePassword: boolean; sessionVersion: number; passwordChangedAt: Date | null;
};

const URL_SECRET = "postgresql://owner:s3cret-pass@db.example.co:5432/postgres";
const TEMP_SHAPE = /^[A-Z][a-z]{3,6}-[2-9]{4}-[a-z]{4,7}$/;

let users: UserRow[];
let attempts: Array<{ id: string; emailKey: string }>;
let audits: Array<Record<string, unknown>>;

function fakeDb(): RecoverDb {
  const tx = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        const u = users.find((r) => r.email === where.email);
        return u ? { ...u } : null;
      },
      updateMany: async ({ where, data }: { where: Partial<UserRow>; data: Record<string, unknown> }) => {
        const hit = users.filter((u) => Object.entries(where).every(([k, v]) => u[k as keyof UserRow] === v));
        for (const u of hit) {
          for (const [k, v] of Object.entries(data)) {
            const inc = v as { increment?: number };
            (u as Record<string, unknown>)[k] = inc && typeof inc === "object" && "increment" in inc ? (u[k as keyof UserRow] as number) + inc.increment! : v;
          }
        }
        return { count: hit.length };
      },
    },
    signInAttempt: {
      deleteMany: async ({ where }: { where: { emailKey: { in: string[] } } }) => {
        const before = attempts.length;
        attempts = attempts.filter((a) => !where.emailKey.in.includes(a.emailKey));
        return { count: before - attempts.length };
      },
    },
    auditEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return { id: `a${audits.length}` };
      },
    },
  };
  return { $transaction: async (fn) => fn(tx as never) } as RecoverDb;
}

beforeEach(() => {
  users = [
    { id: "perm", email: "owner@thebackroomop.com", name: "Owner Admin", isPermanentAdmin: true, passwordHash: "old-hash", mustChangePassword: false, sessionVersion: 4, passwordChangedAt: null },
    { id: "other", email: "m.cruz@thebackroomop.com", name: "M. Cruz", isPermanentAdmin: false, passwordHash: "x", mustChangePassword: false, sessionVersion: 0, passwordChangedAt: null },
  ];
  attempts = [
    { id: "1", emailKey: "owner@thebackroomop.com" },
    { id: "2", emailKey: "CURRENT:perm" },
    { id: "3", emailKey: "m.cruz@thebackroomop.com" },
  ];
  audits = [];
});

describe("recoverPermanentAdmin", () => {
  it("sets a temporary password, owes a new one, bumps the version and clears both failure counts", async () => {
    const r = await recoverPermanentAdmin(fakeDb(), "  Owner@TheBackroomOp.com ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tempPassword).toMatch(TEMP_SHAPE);
    const perm = users[0];
    expect(perm).toMatchObject({ mustChangePassword: true, sessionVersion: 5 });
    expect(perm.passwordChangedAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare(r.tempPassword, perm.passwordHash!)).toBe(true);
    expect(bcrypt.getRounds(perm.passwordHash!)).toBe(10);
    expect(attempts.map((a) => a.emailKey)).toEqual(["m.cruz@thebackroomop.com"]);
  });

  it("writes password.reset with source cli, and no password, hash or temporary password", async () => {
    const r = await recoverPermanentAdmin(fakeDb(), "owner@thebackroomop.com");
    if (!r.ok) throw new Error("expected ok");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "password.reset", entityType: "user", entityId: "perm", actorId: null, source: "cli",
    });
    const text = JSON.stringify(audits[0]);
    expect(text).not.toContain(r.tempPassword);
    expect(text).not.toContain(users[0].passwordHash!);
    expect(text).not.toContain("old-hash");
  });

  it("refuses an account that isn't the permanent admin, and an unknown email, writing nothing", async () => {
    for (const email of ["m.cruz@thebackroomop.com", "nobody@thebackroomop.com", ""]) {
      const r = await recoverPermanentAdmin(fakeDb(), email);
      expect(r.ok).toBe(false);
    }
    expect(users[1]).toMatchObject({ passwordHash: "x", sessionVersion: 0, mustChangePassword: false });
    expect(users[0].passwordHash).toBe("old-hash");
    expect(audits).toEqual([]);
    expect(attempts).toHaveLength(3);
  });
});

describe("runRecover (the command)", () => {
  function run(argv: string[], env: Record<string, string | undefined> = { DATABASE_URL: URL_SECRET }) {
    const out: string[] = [];
    const err: string[] = [];
    return runRecover(argv, env, { db: () => fakeDb(), out: (s) => out.push(s), err: (s) => err.push(s) })
      .then((code) => ({ code, out, err, all: [...out, ...err].join("\n") }));
  }

  it("prints the temporary password exactly once, and never the database URL", async () => {
    const r = await run(["--email", "owner@thebackroomop.com"]);
    expect(r.code).toBe(0);
    const temp = r.all.match(/[A-Z][a-z]{3,6}-[2-9]{4}-[a-z]{4,7}/)?.[0];
    expect(temp).toBeTruthy();
    expect(r.all.split(temp!).length - 1).toBe(1);
    expect(await bcrypt.compare(temp!, users[0].passwordHash!)).toBe(true);
    expect(r.all).not.toContain(URL_SECRET);
    expect(r.all).not.toContain("s3cret-pass");
  });

  it("accepts --email=<address>", async () => {
    expect((await run(["--email=owner@thebackroomop.com"])).code).toBe(0);
  });

  it("refuses another account's email with exit code 1 and no password", async () => {
    const r = await run(["--email", "m.cruz@thebackroomop.com"]);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.err.join("\n")).toMatch(/permanent admin/i);
    expect(audits).toEqual([]);
  });

  it("needs --email, and DATABASE_URL in the environment, before touching the database", async () => {
    let opened = 0;
    const noDb = { db: () => { opened++; return fakeDb(); }, out: () => {}, err: () => {} };
    expect(await runRecover([], { DATABASE_URL: URL_SECRET }, noDb)).toBe(1);
    expect(await runRecover(["--email"], { DATABASE_URL: URL_SECRET }, noDb)).toBe(1);
    expect(await runRecover(["--email", "owner@thebackroomop.com"], {}, noDb)).toBe(1);
    expect(opened).toBe(0);
  });

  it("a database failure is reported without the URL", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const broken = { $transaction: async () => { throw new Error(`Can't reach ${URL_SECRET}`); } } as unknown as RecoverDb;
    const code = await runRecover(["--email", "owner@thebackroomop.com"], { DATABASE_URL: URL_SECRET }, {
      db: () => broken, out: (s) => out.push(s), err: (s) => err.push(s),
    });
    expect(code).toBe(1);
    expect([...out, ...err].join("\n")).not.toContain("s3cret-pass");
  });
});
