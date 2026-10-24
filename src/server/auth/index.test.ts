import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Cloud staging (Task 3): a self-signed-up account waits disabled for an admin. This pins that the credentials
 * provider's authorize() refuses a disabled user even with the right password, as it does for any disabled account.
 */

type Provider = { authorize?: (credentials: unknown) => Promise<unknown> };

const h = vi.hoisted(() => ({
  config: null as null | { providers: Provider[] },
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (config: { providers: Provider[] }) => {
    h.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (opts: object) => opts }));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({ default: {} }));
// The real sign-in limit over the in-memory SignInAttempt table and advisory-locked transaction
vi.mock("../db/client", async () => {
  const fake = await import("./sign-in-attempts.fake");
  return {
    prisma: {
      user: { findUnique: h.findUnique, update: h.update },
      signInAttempt: fake.signInAttemptTable,
      $transaction: fake.fakeTransaction,
    },
  };
});

import bcrypt from "bcryptjs";
import { attempts, resetAttempts } from "./sign-in-attempts.fake";

// The quick-login provider registers only when QUICK_LOGIN_EMAILS lists someone at startup
vi.stubEnv("QUICK_LOGIN_EMAILS", "it@thebackroomop.com");
await import("./index");
vi.unstubAllEnvs();

async function authorize(email: string, password: string) {
  return h.config!.providers[0].authorize!({ email, password });
}

describe("credentials sign-in and a disabled account", () => {
  beforeEach(() => {
    h.findUnique.mockReset();
    h.update.mockReset().mockResolvedValue({});
    resetAttempts();
  });

  it("refuses a disabled user even with the right password", async () => {
    const passwordHash = await bcrypt.hash("correct horse battery", 4);
    h.findUnique.mockResolvedValue({ id: "u1", email: "nina@thebackroomop.com", name: "Nina", role: "viewer", passwordHash, disabled: true, approvalState: "APPROVED", sessionVersion: 0, mustChangePassword: false });
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toBeNull();
  });

  it("lets the same user in once enabled", async () => {
    const passwordHash = await bcrypt.hash("correct horse battery", 4);
    h.findUnique.mockResolvedValue({ id: "u1", email: "nina@thebackroomop.com", name: "Nina", role: "viewer", passwordHash, disabled: false, approvalState: "APPROVED", sessionVersion: 0, mustChangePassword: false });
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toMatchObject({ id: "u1", role: "viewer" });
  });
});

describe("credentials authorize (Users & access spec §4.2, §4.6)", () => {
  let passwordHash = "";
  const row = (over: Record<string, unknown> = {}) => ({
    id: "u1", email: "nina@thebackroomop.com", name: "Nina", role: "viewer", passwordHash,
    disabled: false, approvalState: "APPROVED", sessionVersion: 3, mustChangePassword: true, ...over,
  });

  beforeEach(async () => {
    passwordHash ||= await bcrypt.hash("correct horse battery", 4);
    h.findUnique.mockReset();
    h.update.mockReset().mockResolvedValue({});
    resetAttempts();
  });

  it("returns sessionVersion and mustChangePassword with the user", async () => {
    h.findUnique.mockResolvedValue(row());
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toEqual({
      id: "u1", email: "nina@thebackroomop.com", name: "Nina", role: "viewer", sessionVersion: 3, mustChangePassword: true,
    });
  });

  it.each([
    ["PENDING", true], ["PENDING", false], ["DECLINED", true], ["DECLINED", false],
  ])("refuses a %s account (disabled: %s) with the right password, without counting it", async (approvalState, disabled) => {
    h.findUnique.mockResolvedValue(row({ approvalState, disabled }));
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toBeNull();
    expect(attempts.rows).toHaveLength(0);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("a direct POST to the callback is paused too: a paused email is refused before the password is checked", async () => {
    h.findUnique.mockResolvedValue(row());
    for (let i = 0; i < 3; i++) expect(await authorize("Nina@thebackroomop.com", `nope-${i}`)).toBeNull();
    const compare = vi.spyOn(bcrypt, "compare");
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toBeNull();
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
    expect(attempts.locked.every((k) => k === "nina@thebackroomop.com")).toBe(true);
  });

  it("a parallel burst through the callback gets at most three tries (fix round 1, I-1; final review M-3)", async () => {
    h.findUnique.mockResolvedValue(row());
    const compare = vi.spyOn(bcrypt, "compare");
    await Promise.all(Array.from({ length: 6 }, (_, i) => authorize("nina@thebackroomop.com", `nope-${i}`)));
    const tried = compare.mock.calls.length;
    expect(tried).toBeGreaterThanOrEqual(1);
    expect(tried).toBeLessThanOrEqual(3);
    compare.mockRestore();
    expect(attempts.rows).toHaveLength(tried);
  });

  it("a wrong password through the callback counts as a failure, for known and unknown emails", async () => {
    h.findUnique.mockResolvedValue(row());
    expect(await authorize("nina@thebackroomop.com", "nope")).toBeNull();
    h.findUnique.mockResolvedValue(null);
    expect(await authorize("ghost@thebackroomop.com", "nope")).toBeNull();
    expect(attempts.rows.map((r) => r.emailKey)).toEqual(["nina@thebackroomop.com", "ghost@thebackroomop.com"]);
  });

  it("the right password for a turned-off APPROVED account is counted, like a wrong one (fix round 1, M-2)", async () => {
    h.findUnique.mockResolvedValue(row({ disabled: true }));
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toBeNull();
    expect(attempts.rows).toHaveLength(1);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("success clears earlier failures and stamps lastSignInAt (fix round 1, M-1)", async () => {
    h.findUnique.mockResolvedValue(row());
    await authorize("nina@thebackroomop.com", "nope-1");
    await authorize("nina@thebackroomop.com", "nope-2");
    attempts.rows.push({ id: "other", emailKey: "someone@else.com", createdAt: new Date() });
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toMatchObject({ id: "u1" });
    expect(attempts.rows.map((r) => r.id)).toEqual(["other"]);
    expect(h.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { lastSignInAt: expect.any(Date) } });
  });
});

describe("quick-login authorize", () => {
  const quick = (email: string) => h.config!.providers[1].authorize!({ email });
  const row = (over: Record<string, unknown> = {}) => ({
    id: "u9", email: "it@thebackroomop.com", name: "IT", role: "it_staff", disabled: false,
    approvalState: "APPROVED", sessionVersion: 5, mustChangePassword: false, ...over,
  });
  beforeEach(() => {
    h.findUnique.mockReset();
    vi.stubEnv("QUICK_LOGIN_EMAILS", "it@thebackroomop.com");
  });

  it("carries sessionVersion and mustChangePassword, so the guards don't sign the person straight out", async () => {
    h.findUnique.mockResolvedValue(row());
    expect(await quick("it@thebackroomop.com")).toEqual({
      id: "u9", email: "it@thebackroomop.com", name: "IT", role: "it_staff", sessionVersion: 5, mustChangePassword: false,
    });
  });

  it("refuses an account that is not approved", async () => {
    h.findUnique.mockResolvedValue(row({ approvalState: "PENDING" }));
    expect(await quick("it@thebackroomop.com")).toBeNull();
  });
});
