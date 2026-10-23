import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Users & access (spec §4.3, §4.5): the person's own password. setOwnPassword runs only while a new password is owed
 * (its own guard, passwordOwedUser); changeOwnPassword is Account settings', checks the current password under the
 * mutation rate limit, and is refused with "Choose your own password first" from a stale tab (Review Focus #2).
 * The real guards run against a mocked session and user row.
 */

const h = vi.hoisted(() => {
  process.env.AUTH_SECRET = "account-actions-test-secret";
  return {
    session: null as { user: { id: string; role: string; sessionVersion: number; mustChangePassword: boolean } } | null,
    user: null as Record<string, unknown> | null,
    updateMany: vi.fn(),
    bump: vi.fn(),
    transactions: 0,
    audits: [] as Array<Record<string, unknown>>,
    unstableUpdate: vi.fn(),
    checkRate: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/dist/server/app-render/work-unit-async-storage.external", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { workUnitAsyncStorage: new AsyncLocalStorage<object>() };
});
vi.mock("@/server/auth/index", () => ({ auth: async () => h.session, unstable_update: h.unstableUpdate }));
vi.mock("@/server/rate-limit", () => ({ checkRate: h.checkRate }));
vi.mock("@/server/audit", () => ({
  writeAudit: async (_tx: unknown, entry: Record<string, unknown>) => {
    h.audits.push(entry);
    return "a1";
  },
}));
vi.mock("@/server/db/client", () => ({
  prisma: {
    user: { findUnique: async () => h.user },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.transactions += 1;
      return fn({ user: { updateMany: h.updateMany, update: h.bump } });
    },
  },
}));

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { PASSWORD_COPY } from "@/lib/password-rules";
import { changeOwnPassword, setOwnPassword } from "./actions";

const TEMP = "Harbor-4207-cedar";
const CURRENT = "my-old-password-7";
let tempHash = "";
let currentHash = "";

/** Next runs a server action inside its per-request work-unit store. */
const inRequest = <T,>(fn: () => Promise<T>) =>
  (workUnitAsyncStorage as unknown as { run: (s: object, f: () => Promise<T>) => Promise<T> }).run({}, fn);

function signIn(row: Record<string, unknown>) {
  h.user = { id: "u1", name: "Nina Reyes", email: "nina@example.com", role: "it_staff", disabled: false, approvalState: "APPROVED", sessionVersion: 0, passwordChangedAt: null, ...row };
  h.session = { user: { id: "u1", role: "it_staff", sessionVersion: h.user.sessionVersion as number, mustChangePassword: !!h.user.mustChangePassword } };
}

beforeAll(async () => {
  // A low cost keeps the fixture quick; compare works at any cost. The action itself must hash at cost 10.
  [tempHash, currentHash] = await Promise.all([bcrypt.hash(TEMP, 4), bcrypt.hash(CURRENT, 4)]);
});

beforeEach(() => {
  vi.clearAllMocks();
  h.transactions = 0;
  h.audits = [];
  h.updateMany.mockResolvedValue({ count: 1 });
  h.bump.mockResolvedValue({ sessionVersion: 1 });
  h.checkRate.mockResolvedValue({ allowed: true, retryAfterSec: 0 });
});

describe("setOwnPassword (first sign-in)", () => {
  it("is refused when no new password is owed, and writes nothing", async () => {
    signIn({ mustChangePassword: false, passwordHash: currentHash });
    const r = await inRequest(() => setOwnPassword({ password: "Brand-new-pass9", confirm: "Brand-new-pass9" }));
    expect(r).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.transactions).toBe(0);
    expect(h.unstableUpdate).not.toHaveBeenCalled();
  });

  it("is refused for a signed-out caller", async () => {
    h.session = null;
    h.user = null;
    expect(await setOwnPassword({ password: "Brand-new-pass9", confirm: "Brand-new-pass9" })).toMatchObject({ kind: "forbidden" });
  });

  it("saves: clears the flag, stamps passwordChangedAt, bumps the version, audits password.change without the password", async () => {
    signIn({ mustChangePassword: true, passwordHash: tempHash });
    const r = await inRequest(() => setOwnPassword({ password: "Brand-new-pass9", confirm: "Brand-new-pass9" }));
    expect(r).toEqual({ ok: true, data: { sessionVersion: 1 } });

    // One guarded write: only while still owed and at the version this request read.
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = h.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "u1", mustChangePassword: true, sessionVersion: 0 });
    expect(data.mustChangePassword).toBe(false);
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
    expect(data.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare("Brand-new-pass9", data.passwordHash)).toBe(true);

    expect(h.bump).toHaveBeenCalledWith({ where: { id: "u1" }, data: { sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });

    expect(h.audits).toHaveLength(1);
    const audit = h.audits[0];
    expect(audit).toMatchObject({ actorId: "u1", entityType: "user", entityId: "u1", action: "password.change" });
    const text = JSON.stringify(audit);
    expect(text).not.toContain("Brand-new-pass9");
    expect(text).not.toContain(TEMP);
    expect(text).not.toContain("$2");
    expect(Object.keys(audit.diff as object)).not.toContain("passwordHash");

    // This device's token takes the new version server-side (with a proof that never reaches the browser).
    expect(h.unstableUpdate).toHaveBeenCalledTimes(1);
    expect(h.unstableUpdate.mock.calls[0][0]).toMatchObject({ sessionVersion: 1, mustChangePassword: false, proof: expect.any(String) });
    expect(JSON.stringify(r)).not.toContain("proof");
  });

  it("enforces the rules on the server", async () => {
    signIn({ mustChangePassword: true, passwordHash: tempHash });
    const cases: Array<[Record<string, string>, string, string]> = [
      [{ password: "abcdefghij", confirm: "abcdefghij" }, "password", PASSWORD_COPY.mixed],
      [{ password: "short1", confirm: "short1" }, "password", PASSWORD_COPY.long],
      [{ password: "Brand-new-pass9", confirm: "Brand-new-pass8" }, "confirm", PASSWORD_COPY.mismatch],
      [{ password: TEMP, confirm: TEMP }, "password", PASSWORD_COPY.sameAsTemporary],
    ];
    for (const [input, field, copy] of cases) {
      const r = await inRequest(() => setOwnPassword(input));
      expect(r).toMatchObject({ ok: false, kind: "validation", fieldErrors: { [field]: copy } });
    }
    expect(await inRequest(() => setOwnPassword({ password: 42 }))).toMatchObject({ ok: false, kind: "validation" });
    expect(h.transactions).toBe(0);
    expect(h.unstableUpdate).not.toHaveBeenCalled();
  });

  it("an account changed meanwhile (an admin reset, another tab) is a conflict, and nothing else is written", async () => {
    signIn({ mustChangePassword: true, passwordHash: tempHash });
    h.updateMany.mockResolvedValue({ count: 0 });
    const r = await inRequest(() => setOwnPassword({ password: "Brand-new-pass9", confirm: "Brand-new-pass9" }));
    expect(r).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.bump).not.toHaveBeenCalled();
    expect(h.audits).toHaveLength(0);
    expect(h.unstableUpdate).not.toHaveBeenCalled();
  });
});

describe("changeOwnPassword (Account settings)", () => {
  it("a wrong current password returns the exact copy, after the mutation rate check", async () => {
    signIn({ mustChangePassword: false, passwordHash: currentHash });
    const r = await inRequest(() => changeOwnPassword({ current: "not-it-at-all-1", password: "Brand-new-pass9", confirm: "Brand-new-pass9" }));
    expect(r).toMatchObject({
      ok: false,
      kind: "validation",
      message: "That isn't your current password",
      fieldErrors: { current: "That isn't your current password" },
    });
    expect(h.checkRate).toHaveBeenCalledWith("u1", "mutation");
    expect(h.transactions).toBe(0);
  });

  it("is refused once the rate limit is reached, before any password check", async () => {
    signIn({ mustChangePassword: false, passwordHash: currentHash });
    h.checkRate.mockResolvedValue({ allowed: false, retryAfterSec: 42 });
    const r = await inRequest(() => changeOwnPassword({ current: CURRENT, password: "Brand-new-pass9", confirm: "Brand-new-pass9" }));
    expect(r).toMatchObject({ ok: false, kind: "rate_limited", retryAfterSec: 42 });
    expect(h.transactions).toBe(0);
  });

  it("enforces the rules on the server, including not reusing the current password", async () => {
    signIn({ mustChangePassword: false, passwordHash: currentHash });
    const cases: Array<[Record<string, string>, string, string]> = [
      [{ current: CURRENT, password: CURRENT, confirm: CURRENT }, "password", PASSWORD_COPY.sameAsCurrent],
      [{ current: CURRENT, password: "abcdefghij", confirm: "abcdefghij" }, "password", PASSWORD_COPY.mixed],
      [{ current: CURRENT, password: "abc1", confirm: "abc1" }, "password", PASSWORD_COPY.long],
      [{ current: CURRENT, password: "Brand-new-pass9", confirm: "nope" }, "confirm", PASSWORD_COPY.mismatch],
    ];
    for (const [input, field, copy] of cases) {
      const r = await inRequest(() => changeOwnPassword(input));
      expect(r).toMatchObject({ ok: false, kind: "validation", fieldErrors: { [field]: copy } });
    }
    expect(h.transactions).toBe(0);
  });

  it("saves: new hash at cost 10, passwordChangedAt, version bump, audit without the password, this device kept", async () => {
    signIn({ mustChangePassword: false, passwordHash: currentHash, sessionVersion: 3 });
    h.bump.mockResolvedValue({ sessionVersion: 4 });
    const r = await inRequest(() => changeOwnPassword({ current: CURRENT, password: "Brand-new-pass9", confirm: "Brand-new-pass9" }));
    expect(r).toMatchObject({ ok: true, data: { sessionVersion: 4, passwordChangedAt: expect.any(String) } });
    const { where, data } = h.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: "u1", sessionVersion: 3, mustChangePassword: false });
    expect(data.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
    expect(h.audits[0]).toMatchObject({ action: "password.change", entityId: "u1" });
    const text = JSON.stringify(h.audits[0]);
    expect(text).not.toContain("Brand-new-pass9");
    expect(text).not.toContain(CURRENT);
    expect(h.unstableUpdate.mock.calls[0][0]).toMatchObject({ sessionVersion: 4, mustChangePassword: false });
  });

  it("from a stale tab while a new password is owed: refused with \"Choose your own password first\" (Review Focus #2)", async () => {
    signIn({ mustChangePassword: true, passwordHash: tempHash });
    const r = await inRequest(() => changeOwnPassword({ current: TEMP, password: "Brand-new-pass9", confirm: "Brand-new-pass9" }));
    expect(r).toMatchObject({ ok: false, kind: "forbidden", reason: "password_owed", message: "Choose your own password first" });
    expect(h.checkRate).not.toHaveBeenCalled();
    expect(h.transactions).toBe(0);
  });
});
