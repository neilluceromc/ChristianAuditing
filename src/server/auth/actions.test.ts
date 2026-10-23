import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Cloud staging (Task 3): with SIGNUP_REQUIRES_APPROVAL=1 a self sign-up creates the account disabled, writes the
 * audit entry, and never signs the person in. Without it, sign-up behaves as before.
 */

const h = vi.hoisted(() => ({
  userCreate: vi.fn(),
  auditCreate: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  auth: vi.fn(),
  requireUser: vi.fn(),
  calls: [] as string[],
  convUpdateMany: vi.fn(),
  pendingDeleteMany: vi.fn(),
  saveUiPref: vi.fn(),
  cookieSet: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  attempts: [] as Array<{ emailKey: string; createdAt: Date }>,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: h.cookieSet }) }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("./index", () => ({ signIn: h.signIn, signOut: h.signOut, auth: h.auth }));
vi.mock("./guards", () => ({ requireUser: h.requireUser }));
vi.mock("@/server/ui-prefs", () => ({ saveUiPref: h.saveUiPref }));
vi.mock("../db/client", () => ({
  prisma: {
    featureFlag: { findUnique: async () => null },
    user: {
      findUnique: h.userFindUnique,
      create: h.userCreate,
      update: h.userUpdate,
    },
    // The SignInAttempt table in memory, filtered the way Postgres would (sign-in-limit.ts's three queries)
    signInAttempt: {
      create: async ({ data }: { data: { emailKey: string; createdAt?: Date } }) => {
        h.attempts.push({ emailKey: data.emailKey, createdAt: data.createdAt ?? new Date() });
        return {};
      },
      findMany: async ({ where, orderBy, take }: {
        where: { emailKey: string; createdAt: { gt: Date } };
        orderBy?: { createdAt: "asc" | "desc" };
        take?: number;
      }) => {
        const found = h.attempts
          .filter((r) => r.emailKey === where.emailKey && r.createdAt > where.createdAt.gt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (orderBy?.createdAt === "desc") found.reverse();
        return (take ? found.slice(0, take) : found).map((r) => ({ createdAt: r.createdAt }));
      },
      deleteMany: async ({ where }: { where: { emailKey: string } }) => {
        const before = h.attempts.length;
        h.attempts = h.attempts.filter((r) => r.emailKey !== where.emailKey);
        return { count: before - h.attempts.length };
      },
    },
    auditEntry: { create: h.auditCreate },
    crisConversation: { updateMany: h.convUpdateMany },
    crisPendingAction: { deleteMany: h.pendingDeleteMany },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  },
}));

import bcrypt from "bcryptjs";
import { quickSignIn, signInWithCredentials, signOutAction, signUp, switchWorkspace } from "./actions";

function form(): FormData {
  const f = new FormData();
  f.set("name", "Nina Reyes");
  f.set("email", "nina@thebackroomop.com");
  f.set("password", "correct horse battery");
  return f;
}

beforeEach(() => {
  h.userCreate.mockReset();
  h.auditCreate.mockReset();
  h.signIn.mockReset();
  h.userCreate.mockResolvedValue({ id: "u-new", name: "Nina Reyes" });
  h.userFindUnique.mockReset().mockResolvedValue(null);
  h.userUpdate.mockReset().mockResolvedValue({});
  h.attempts = [];
  h.auditCreate.mockResolvedValue({});
  h.signIn.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signUp when SIGNUP_REQUIRES_APPROVAL=1", () => {
  beforeEach(() => vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "1"));

  it("creates the account disabled, as a viewer", async () => {
    await signUp({}, form());
    expect(h.userCreate).toHaveBeenCalledTimes(1);
    expect(h.userCreate.mock.calls[0][0].data).toMatchObject({
      email: "nina@thebackroomop.com",
      role: "viewer",
      disabled: true,
    });
  });

  it("audits the signup with the disabled flag in the diff", async () => {
    await signUp({}, form());
    expect(h.auditCreate).toHaveBeenCalledTimes(1);
    const data = h.auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ action: "signup", entityType: "user", entityId: "u-new", actorId: "u-new" });
    expect(data.diff).toEqual({ role: { from: null, to: "viewer" }, disabled: { from: null, to: true } });
  });

  it("does not sign the person in, and returns pendingApproval", async () => {
    const r = await signUp({}, form());
    expect(h.signIn).not.toHaveBeenCalled();
    expect(r).toEqual({ created: true, pendingApproval: true });
  });
});

describe("signUp when SIGNUP_REQUIRES_APPROVAL is unset or not 1", () => {
  it.each(["", "0", "true"])("behaves as before (value %j)", async (value) => {
    vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", value);
    const r = await signUp({}, form());
    expect(h.userCreate.mock.calls[0][0].data).not.toHaveProperty("disabled");
    expect(h.auditCreate.mock.calls[0][0].data.diff).toEqual({ role: { from: null, to: "viewer" } });
    expect(h.signIn).toHaveBeenCalledWith("credentials", {
      email: "nina@thebackroomop.com",
      password: "correct horse battery",
      redirect: false,
    });
    expect(r).toEqual({ created: true });
  });

  it("behaves as before when the variable is absent", async () => {
    delete process.env.SIGNUP_REQUIRES_APPROVAL;
    const r = await signUp({}, form());
    expect(h.userCreate.mock.calls[0][0].data).not.toHaveProperty("disabled");
    expect(h.signIn).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ created: true });
  });
});

describe("signOutAction (Phase 47 spec §5.5, Review Focus #5: Cris chats cleared, TEMPORARY)", () => {
  beforeEach(() => {
    h.calls = [];
    h.auth.mockReset().mockResolvedValue({ user: { id: "u1", role: "it_staff" } });
    h.convUpdateMany.mockReset().mockImplementation(async () => { h.calls.push("clear"); return { count: 2 }; });
    h.pendingDeleteMany.mockReset().mockImplementation(async () => { h.calls.push("pending"); return { count: 1 }; });
    h.signOut.mockReset().mockImplementation(async () => { h.calls.push("signOut"); });
  });

  it("soft-clears the person's uncleared chats (rows kept for the usage counts), then signs out", async () => {
    const before = Date.now();
    await signOutAction();
    expect(h.convUpdateMany).toHaveBeenCalledTimes(1);
    const { where, data } = h.convUpdateMany.mock.calls[0][0];
    expect(where).toEqual({ userId: "u1", clearedAt: null });
    expect(data.clearedAt).toBeInstanceOf(Date);
    expect(data.clearedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(Object.keys(data)).toEqual(["clearedAt"]);
    expect(h.signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
    expect(h.calls.at(-1)).toBe("signOut");
  });

  it("deletes the person's pending Cris actions by userId (no foreign key)", async () => {
    await signOutAction();
    expect(h.pendingDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(h.calls).toEqual(expect.arrayContaining(["clear", "pending"]));
  });

  it("still signs out with no session, or when the clear fails", async () => {
    h.auth.mockResolvedValue(null);
    await signOutAction();
    expect(h.convUpdateMany).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledTimes(1);

    h.auth.mockResolvedValue({ user: { id: "u1", role: "it_staff" } });
    h.convUpdateMany.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await signOutAction();
    expect(h.signOut).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});

describe("switchWorkspace (Phase 47 spec §5.4: the workspace follows the person)", () => {
  beforeEach(() => {
    h.requireUser.mockReset().mockResolvedValue({ id: "u1", role: "admin" });
    h.saveUiPref.mockReset().mockResolvedValue(null);
    h.cookieSet.mockReset();
  });

  it("saves the choice to the person's prefs as well as the br.dept cookie", async () => {
    await expect(switchWorkspace("finance")).rejects.toThrow("REDIRECT:/finance/assets");
    expect(h.saveUiPref).toHaveBeenCalledWith({ workspace: "finance" });
    expect(h.cookieSet).toHaveBeenCalledWith("br.dept", "finance", expect.objectContaining({ path: "/" }));
  });

  it("still switches when saving the preference fails", async () => {
    h.saveUiPref.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(switchWorkspace("finance")).rejects.toThrow("REDIRECT:/finance/assets");
    expect(h.cookieSet).toHaveBeenCalledWith("br.dept", "finance", expect.objectContaining({ path: "/" }));
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it("saves nothing for a workspace the role can't open", async () => {
    h.requireUser.mockResolvedValue({ id: "u1", role: "it_staff" });
    await expect(switchWorkspace("finance")).rejects.toThrow("REDIRECT:/inventory");
    expect(h.saveUiPref).not.toHaveBeenCalled();
  });
});

describe("signInWithCredentials (Users & access spec §4.6, Review Focus #5)", () => {
  const PAUSED = "Too many tries — wait 15 minutes or ask an admin to reset your password.";
  const WRONG = "Wrong email or password — or the account is disabled.";
  const PENDING = "Your account is waiting for an admin to approve it.";
  const DECLINED = "Your sign-up wasn't approved. Ask an admin if you think this is a mistake.";
  let passwordHash = "";

  const login = (email: string, password: string, next?: string) => {
    const f = new FormData();
    f.set("email", email);
    f.set("password", password);
    if (next) f.set("next", next);
    return signInWithCredentials({}, f);
  };
  const account = (over: Record<string, unknown> = {}) => ({
    id: "u1", email: "nina@thebackroomop.com", name: "Nina", role: "viewer", passwordHash,
    disabled: false, approvalState: "APPROVED", sessionVersion: 0, mustChangePassword: false, ...over,
  });

  beforeEach(async () => {
    passwordHash ||= await bcrypt.hash("correct horse battery", 4);
  });

  it("three wrong passwords for an unknown email: the 4th attempt gets the pause copy", async () => {
    for (let i = 0; i < 3; i++) expect(await login("ghost@thebackroomop.com", `guess-${i}`)).toEqual({ error: WRONG });
    expect(h.attempts).toHaveLength(3);
    expect(await login("ghost@thebackroomop.com", "guess-4")).toEqual({ error: PAUSED });
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("the same for a known email, even with the right password on the 4th attempt", async () => {
    h.userFindUnique.mockResolvedValue(account());
    for (let i = 0; i < 3; i++) expect(await login("Nina@TheBackroomOp.com", `guess-${i}`)).toEqual({ error: WRONG });
    expect(h.attempts.every((a) => a.emailKey === "nina@thebackroomop.com")).toBe(true);
    const compare = vi.spyOn(bcrypt, "compare");
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: PAUSED });
    expect(compare).not.toHaveBeenCalled(); // paused: the password is not even checked
    compare.mockRestore();
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.userUpdate).not.toHaveBeenCalled();
  });

  it("right password for a PENDING account: the PENDING copy, no failure recorded, no session", async () => {
    h.userFindUnique.mockResolvedValue(account({ approvalState: "PENDING" }));
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: PENDING });
    expect(h.attempts).toHaveLength(0);
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("right password for a DECLINED account: the DECLINED copy", async () => {
    h.userFindUnique.mockResolvedValue(account({ approvalState: "DECLINED" }));
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: DECLINED });
    expect(h.attempts).toHaveLength(0);
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("a wrong password for a PENDING or DECLINED account says only 'wrong', and counts", async () => {
    for (const approvalState of ["PENDING", "DECLINED"]) {
      h.userFindUnique.mockResolvedValue(account({ approvalState }));
      expect(await login("nina@thebackroomop.com", "not it")).toEqual({ error: WRONG });
    }
    expect(h.attempts).toHaveLength(2);
  });

  it("the right password for a disabled account is refused with the usual copy", async () => {
    h.userFindUnique.mockResolvedValue(account({ disabled: true }));
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: WRONG });
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("success clears the failures, writes lastSignInAt, then signs in and goes to a safe next", async () => {
    h.userFindUnique.mockResolvedValue(account());
    await login("nina@thebackroomop.com", "nope-1");
    await login("nina@thebackroomop.com", "nope-2");
    h.attempts.push({ emailKey: "someone@else.com", createdAt: new Date() });
    const before = Date.now();
    await expect(login(" NINA@thebackroomop.com ", "correct horse battery", "/finance/assets")).rejects.toThrow(
      "REDIRECT:/finance/assets",
    );
    expect(h.attempts).toEqual([{ emailKey: "someone@else.com", createdAt: expect.any(Date) }]);
    expect(h.userUpdate).toHaveBeenCalledTimes(1);
    const { where, data } = h.userUpdate.mock.calls[0][0];
    expect(where).toEqual({ id: "u1" });
    expect(data.lastSignInAt).toBeInstanceOf(Date);
    expect(data.lastSignInAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(h.signIn).toHaveBeenCalledWith("credentials", {
      email: "nina@thebackroomop.com",
      password: "correct horse battery",
      redirect: false,
    });
    expect(h.userUpdate.mock.invocationCallOrder[0]).toBeLessThan(h.signIn.mock.invocationCallOrder[0]);
  });

  it("success with no next goes Home", async () => {
    h.userFindUnique.mockResolvedValue(account());
    await expect(login("nina@thebackroomop.com", "correct horse battery")).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("checks the password with bcrypt once per failed attempt", async () => {
    h.userFindUnique.mockResolvedValue(account());
    const compare = vi.spyOn(bcrypt, "compare");
    await login("nina@thebackroomop.com", "nope");
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockClear();
    h.userFindUnique.mockResolvedValue(null);
    await login("ghost@thebackroomop.com", "nope"); // unknown email: still one compare, against the dummy hash
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });

  it("an empty email or password is refused without counting", async () => {
    expect(await login("", "x")).toEqual({ error: WRONG });
    expect(await login("nina@thebackroomop.com", "")).toEqual({ error: WRONG });
    expect(h.attempts).toHaveLength(0);
  });
});

describe("quickSignIn writes lastSignInAt (spec §4.1)", () => {
  beforeEach(() => vi.stubEnv("QUICK_LOGIN_EMAILS", "it@thebackroomop.com"));

  it("after a successful quick sign-in", async () => {
    const f = new FormData();
    f.set("email", "IT@thebackroomop.com");
    await expect(quickSignIn(f)).rejects.toThrow(/^REDIRECT:\/$/);
    expect(h.signIn).toHaveBeenCalledWith("quick-login", { email: "it@thebackroomop.com", redirect: false });
    expect(h.userUpdate).toHaveBeenCalledWith({
      where: { email: "it@thebackroomop.com" },
      data: { lastSignInAt: expect.any(Date) },
    });
  });

  it("not when the quick sign-in is refused", async () => {
    const { AuthError } = await import("next-auth");
    h.signIn.mockRejectedValue(new AuthError("no"));
    const f = new FormData();
    f.set("email", "it@thebackroomop.com");
    await expect(quickSignIn(f)).rejects.toThrow("REDIRECT:/login?quick=refused");
    expect(h.userUpdate).not.toHaveBeenCalled();
  });
});
