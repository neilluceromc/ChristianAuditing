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
      findUnique: async () => null,
      create: h.userCreate,
    },
    auditEntry: { create: h.auditCreate },
    crisConversation: { updateMany: h.convUpdateMany },
    crisPendingAction: { deleteMany: h.pendingDeleteMany },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  },
}));

import { signOutAction, signUp, switchWorkspace } from "./actions";

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
