import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Follow-up spec §7.1: every sign-in lands on Home ("/") unless a safe `next` link was given. The role's old landing
 * (ROLE_LANDING) stays only in the page guards. The DB lookup returns a role whose landing is NOT "/", so a redirect
 * to the old role landing would show up here.
 */

const h = vi.hoisted(() => ({
  signIn: vi.fn(),
  cookieSet: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: h.cookieSet }) }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("./index", () => ({ signIn: h.signIn, signOut: vi.fn(), auth: vi.fn() }));
vi.mock("./guards", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/ui-prefs", () => ({ saveUiPref: vi.fn() }));
// Users & access: the pause and the password check have their own tests (sign-in-limit, actions); here they pass.
vi.mock("./sign-in-limit", () => ({
  reserveSignInAttempt: async () => ({ paused: false, attemptId: "a1" }),
  releaseSignInAttempt: async () => {},
  clearSignInFailures: async () => {},
}));
vi.mock("./password-check", () => ({ passwordMatches: async () => true }));
vi.mock("../db/client", () => ({
  prisma: {
    featureFlag: { findUnique: async () => null },
    user: { findUnique: h.userFindUnique, count: async () => 0, create: vi.fn(), update: vi.fn() },
    auditEntry: { create: vi.fn() },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { count: async () => 0, create: async () => ({ id: "u1", name: "Admin" }) },
        featureFlag: { upsert: async () => ({}) },
        auditEntry: { create: async () => ({}) },
      }),
  },
}));

import { createBootstrapAdmin, quickSignIn, signInWithCredentials } from "./actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function destination(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const m = /^REDIRECT:(.*)$/.exec((err as Error).message);
    if (m) return m[1];
    throw err;
  }
  throw new Error("no redirect");
}

beforeEach(() => {
  h.signIn.mockReset();
  h.signIn.mockResolvedValue(undefined);
  h.cookieSet.mockReset();
  h.userFindUnique.mockReset();
  h.userFindUnique.mockResolvedValue({
    id: "u1", role: "finance_staff", passwordHash: "hash", disabled: false, approvalState: "APPROVED",
  });
  vi.stubEnv("QUICK_LOGIN_EMAILS", "fin@thebackroomop.com");
  vi.stubEnv("VERCEL", "");
});

const creds = { email: "fin@thebackroomop.com", password: "correct horse battery" };

describe("signInWithCredentials", () => {
  it("goes to Home with no next", async () => {
    expect(await destination(() => signInWithCredentials({}, form(creds)))).toBe("/");
  });
  it("goes to a safe next when one was given", async () => {
    expect(await destination(() => signInWithCredentials({}, form({ ...creds, next: "/inventory/abc" })))).toBe(
      "/inventory/abc",
    );
  });
  it("ignores an unsafe next", async () => {
    expect(await destination(() => signInWithCredentials({}, form({ ...creds, next: "//evil.example" })))).toBe("/");
  });
});

describe("quickSignIn", () => {
  const q = { email: "fin@thebackroomop.com" };
  it("goes to Home with no next", async () => {
    expect(await destination(() => quickSignIn(form(q)))).toBe("/");
  });
  it("goes to a safe next when one was given", async () => {
    expect(await destination(() => quickSignIn(form({ ...q, next: "/inventory/abc" })))).toBe("/inventory/abc");
  });
  it("ignores an unsafe next", async () => {
    expect(await destination(() => quickSignIn(form({ ...q, next: "/\\evil" })))).toBe("/");
  });
});

describe("createBootstrapAdmin", () => {
  it("opens Home", async () => {
    const f = form({ name: "Admin One", email: "admin@thebackroomop.com", password: "long enough password 7", domain: "" });
    expect(await destination(() => createBootstrapAdmin({}, f))).toBe("/");
    expect(h.cookieSet).toHaveBeenCalledWith("br.dept", "it", expect.any(Object));
  });

  // Final review M-8: the first admin's password follows the same rules as every new password.
  it("refuses a password that breaks the shared rules, with their copy", async () => {
    const base = { name: "Admin One", email: "admin@thebackroomop.com", domain: "" };
    expect(await createBootstrapAdmin({}, form({ ...base, password: "short1" }))).toEqual({
      error: "Password must be at least 10 characters.",
    });
    expect(await createBootstrapAdmin({}, form({ ...base, password: "long enough password" }))).toEqual({
      error: "Password must use letters and at least one number.",
    });
  });
});
