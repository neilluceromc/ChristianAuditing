import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Cloud staging (Task 3): a self-signed-up account waits disabled for an admin. This pins that the credentials
 * provider's authorize() refuses a disabled user even with the right password, as it does for any disabled account.
 */

type Provider = { authorize?: (credentials: unknown) => Promise<unknown> };

const h = vi.hoisted(() => ({
  config: null as null | { providers: Provider[] },
  findUnique: vi.fn(),
  paused: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (config: { providers: Provider[] }) => {
    h.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (opts: object) => opts }));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({ default: {} }));
vi.mock("../db/client", () => ({ prisma: { user: { findUnique: h.findUnique } } }));
vi.mock("./sign-in-limit", () => ({ signInPaused: h.paused, recordSignInFailure: h.recordFailure }));

import bcrypt from "bcryptjs";

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
    h.paused.mockReset().mockResolvedValue(false);
    h.recordFailure.mockReset().mockResolvedValue(undefined);
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
    h.paused.mockReset().mockResolvedValue(false);
    h.recordFailure.mockReset().mockResolvedValue(undefined);
  });

  it("returns sessionVersion and mustChangePassword with the user", async () => {
    h.findUnique.mockResolvedValue(row());
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toEqual({
      id: "u1", email: "nina@thebackroomop.com", name: "Nina", role: "viewer", sessionVersion: 3, mustChangePassword: true,
    });
  });

  it.each(["PENDING", "DECLINED"])("refuses a %s account even with the right password", async (approvalState) => {
    h.findUnique.mockResolvedValue(row({ approvalState }));
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toBeNull();
    expect(h.recordFailure).not.toHaveBeenCalled();
  });

  it("a direct POST to the callback is paused too: a paused email is refused before the password is checked", async () => {
    h.findUnique.mockResolvedValue(row());
    h.paused.mockResolvedValue(true);
    const compare = vi.spyOn(bcrypt, "compare");
    expect(await authorize("Nina@thebackroomop.com", "correct horse battery")).toBeNull();
    expect(h.paused).toHaveBeenCalledWith("nina@thebackroomop.com");
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
  });

  it("a wrong password through the callback counts as a failure, for known and unknown emails", async () => {
    h.findUnique.mockResolvedValue(row());
    expect(await authorize("nina@thebackroomop.com", "nope")).toBeNull();
    h.findUnique.mockResolvedValue(null);
    expect(await authorize("ghost@thebackroomop.com", "nope")).toBeNull();
    expect(h.recordFailure.mock.calls).toEqual([["nina@thebackroomop.com"], ["ghost@thebackroomop.com"]]);
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
