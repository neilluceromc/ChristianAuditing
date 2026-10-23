import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Users & access (spec §4.6): a self sign-up creates the account PENDING (and turned off), writes the audit entry,
 * and never signs the person in. The old SIGNUP_REQUIRES_APPROVAL switch is retired.
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
// The SignInAttempt table and the advisory-locked interactive transaction are the in-memory double; its
// $transaction also takes the array form signOutAction uses.
vi.mock("../db/client", async () => {
  const fake = await import("./sign-in-attempts.fake");
  return {
    prisma: {
      featureFlag: { findUnique: async () => null },
      user: {
        findUnique: h.userFindUnique,
        create: h.userCreate,
        update: h.userUpdate,
      },
      signInAttempt: fake.signInAttemptTable,
      auditEntry: { create: h.auditCreate },
      crisConversation: { updateMany: h.convUpdateMany },
      crisPendingAction: { deleteMany: h.pendingDeleteMany },
      $transaction: fake.fakeTransaction,
    },
  };
});

import bcrypt from "bcryptjs";
import { attempts, resetAttempts } from "./sign-in-attempts.fake";
import { quickSignIn, signInWithCredentials, signOutAction, signUp, switchWorkspace } from "./actions";

// Users & access (spec §4.3): a sign-up password needs letters and at least one number.
function form(): FormData {
  const f = new FormData();
  f.set("name", "Nina Reyes");
  f.set("email", "nina@thebackroomop.com");
  f.set("password", "correct horse battery 9");
  return f;
}

beforeEach(() => {
  h.userCreate.mockReset();
  h.auditCreate.mockReset();
  h.signIn.mockReset();
  h.userCreate.mockResolvedValue({ id: "u-new", name: "Nina Reyes" });
  h.userFindUnique.mockReset().mockResolvedValue(null);
  h.userUpdate.mockReset().mockResolvedValue({});
  resetAttempts();
  h.auditCreate.mockResolvedValue({});
  h.signIn.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signUp (Users & access spec §4.6): every sign-up waits for an admin", () => {
  it("creates the account PENDING and turned off, as a viewer", async () => {
    await signUp({}, form());
    expect(h.userCreate).toHaveBeenCalledTimes(1);
    const data = h.userCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: "Nina Reyes",
      email: "nina@thebackroomop.com",
      role: "viewer",
      approvalState: "PENDING",
      disabled: true,
    });
    // The person chose this password: nothing is owed, and it is stored only as a cost-10 hash.
    expect(data).not.toHaveProperty("mustChangePassword", true);
    expect(bcrypt.getRounds(data.passwordHash)).toBe(10);
    expect(JSON.stringify(data)).not.toContain("correct horse battery 9");
  });

  it("audits the sign-up with its waiting state, and no password", async () => {
    await signUp({}, form());
    expect(h.auditCreate).toHaveBeenCalledTimes(1);
    const data = h.auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ action: "signup", entityType: "user", entityId: "u-new", actorId: "u-new" });
    expect(data.diff).toEqual({
      role: { from: null, to: "viewer" },
      approvalState: { from: null, to: "PENDING" },
      disabled: { from: null, to: true },
    });
    expect(JSON.stringify(data)).not.toContain("correct horse battery 9");
  });

  it("never signs the person in, and reports created", async () => {
    vi.stubEnv("SIGNUP_REQUIRES_APPROVAL", "0"); // retired: the switch no longer changes anything
    const r = await signUp({}, form());
    expect(h.signIn).not.toHaveBeenCalled();
    expect(r).toEqual({ created: true });
  });

  it("refuses an email that matches an existing one once trimmed and lower-cased", async () => {
    h.userFindUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
      where.email === "ana.lim@x.com" ? { id: "u-ana" } : null);
    const f = form();
    f.set("email", " Ana.Lim@X.com ");
    expect(await signUp({}, f)).toEqual({ error: "An account with that email already exists.", field: "email" });
    expect(h.userFindUnique).toHaveBeenCalledWith({ where: { email: "ana.lim@x.com" } });
    expect(h.userCreate).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();
  });

  it("refuses the same way when a differently-cased row wins the race at the unique index", async () => {
    const { Prisma } = await import("@prisma/client");
    h.userCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6", meta: { target: "User_email_lower_key" } }),
    );
    expect(await signUp({}, form())).toEqual({ error: "An account with that email already exists.", field: "email" });
    expect(h.auditCreate).not.toHaveBeenCalled();
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
    expect(attempts.rows).toHaveLength(3);
    expect(await login("ghost@thebackroomop.com", "guess-4")).toEqual({ error: PAUSED });
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("the same for a known email, even with the right password on the 4th attempt", async () => {
    h.userFindUnique.mockResolvedValue(account());
    for (let i = 0; i < 3; i++) expect(await login("Nina@TheBackroomOp.com", `guess-${i}`)).toEqual({ error: WRONG });
    expect(attempts.rows.every((a) => a.emailKey === "nina@thebackroomop.com")).toBe(true);
    const compare = vi.spyOn(bcrypt, "compare");
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: PAUSED });
    expect(compare).not.toHaveBeenCalled(); // paused: the password is not even checked
    compare.mockRestore();
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.userUpdate).not.toHaveBeenCalled();
  });

  it("right password for a PENDING account: the PENDING copy, no failure recorded, no session", async () => {
    // Fix round 1 (I-2): a waiting sign-up is disabled as well; its copy still wins over the generic one
    h.userFindUnique.mockResolvedValue(account({ approvalState: "PENDING", disabled: true }));
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: PENDING });
    expect(attempts.rows).toHaveLength(0);
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("right password for a DECLINED account: the DECLINED copy, even when it is disabled", async () => {
    h.userFindUnique.mockResolvedValue(account({ approvalState: "DECLINED", disabled: true }));
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: DECLINED });
    expect(attempts.rows).toHaveLength(0);
    expect(h.signIn).not.toHaveBeenCalled();
    h.userFindUnique.mockResolvedValue(account({ approvalState: "DECLINED" }));
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: DECLINED });
  });

  it("the PENDING copy shows for an enabled PENDING account too", async () => {
    h.userFindUnique.mockResolvedValue(account({ approvalState: "PENDING" }));
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: PENDING });
  });

  it("a wrong password for a PENDING or DECLINED account says only 'wrong', and counts", async () => {
    for (const approvalState of ["PENDING", "DECLINED"]) {
      h.userFindUnique.mockResolvedValue(account({ approvalState }));
      expect(await login("nina@thebackroomop.com", "not it")).toEqual({ error: WRONG });
    }
    expect(attempts.rows).toHaveLength(2);
  });

  it("the right password for a turned-off (APPROVED) account reads exactly like a wrong one: same copy, counted", async () => {
    h.userFindUnique.mockResolvedValue(account({ disabled: true }));
    for (let i = 0; i < 3; i++) {
      expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: WRONG });
    }
    expect(attempts.rows).toHaveLength(3); // fix round 1, M-2: the 4th is paused, as after three wrong passwords
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: PAUSED });
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("a burst of parallel wrong passwords gets three tries; the rest are paused (fix round 1, I-1)", async () => {
    h.userFindUnique.mockResolvedValue(account());
    const compare = vi.spyOn(bcrypt, "compare");
    const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => login("nina@thebackroomop.com", `guess-${i}`)));
    expect(replies.filter((r) => r.error === WRONG)).toHaveLength(3);
    expect(replies.filter((r) => r.error === PAUSED)).toHaveLength(3);
    expect(compare).toHaveBeenCalledTimes(3); // only the three that got through checked a password
    compare.mockRestore();
    expect(attempts.rows).toHaveLength(3);
    expect(await login("nina@thebackroomop.com", "correct horse battery")).toEqual({ error: PAUSED });
  });

  it("success clears the failures, writes lastSignInAt, then signs in and goes to a safe next", async () => {
    h.userFindUnique.mockResolvedValue(account());
    await login("nina@thebackroomop.com", "nope-1");
    await login("nina@thebackroomop.com", "nope-2");
    attempts.rows.push({ id: "other", emailKey: "someone@else.com", createdAt: new Date() });
    const before = Date.now();
    await expect(login(" NINA@thebackroomop.com ", "correct horse battery", "/finance/assets")).rejects.toThrow(
      "REDIRECT:/finance/assets",
    );
    expect(attempts.rows).toEqual([{ id: "other", emailKey: "someone@else.com", createdAt: expect.any(Date) }]);
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

  // Task 5 (found by e2e): Home would render the first-sign-in page under the "/" address; go there by name instead.
  it("success for someone who owes a password goes straight to /welcome/password, even with a next", async () => {
    h.userFindUnique.mockResolvedValue(account({ mustChangePassword: true }));
    await expect(login("nina@thebackroomop.com", "correct horse battery", "/finance/assets")).rejects.toThrow(
      /^REDIRECT:\/welcome\/password$/,
    );
    expect(h.signIn).toHaveBeenCalledTimes(1);
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
    expect(attempts.rows).toHaveLength(0);
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
