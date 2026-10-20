import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Cloud staging (Task 3): with SIGNUP_REQUIRES_APPROVAL=1 a self sign-up creates the account disabled, writes the
 * audit entry, and never signs the person in. Without it, sign-up behaves as before.
 */

const h = vi.hoisted(() => ({
  userCreate: vi.fn(),
  auditCreate: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("./index", () => ({ signIn: h.signIn, signOut: vi.fn() }));
vi.mock("./guards", () => ({ requireUser: vi.fn() }));
vi.mock("../db/client", () => ({
  prisma: {
    featureFlag: { findUnique: async () => null },
    user: {
      findUnique: async () => null,
      create: h.userCreate,
    },
    auditEntry: { create: h.auditCreate },
  },
}));

import { signUp } from "./actions";

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
