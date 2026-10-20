import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Cloud staging (Task 3): a self-signed-up account waits disabled for an admin. This pins that the credentials
 * provider's authorize() refuses a disabled user even with the right password, as it does for any disabled account.
 */

type Provider = { authorize?: (credentials: unknown) => Promise<unknown> };

const h = vi.hoisted(() => ({
  config: null as null | { providers: Provider[] },
  findUnique: vi.fn(),
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

import bcrypt from "bcryptjs";

await import("./index");

async function authorize(email: string, password: string) {
  return h.config!.providers[0].authorize!({ email, password });
}

describe("credentials sign-in and a disabled account", () => {
  beforeEach(() => h.findUnique.mockReset());

  it("refuses a disabled user even with the right password", async () => {
    const passwordHash = await bcrypt.hash("correct horse battery", 4);
    h.findUnique.mockResolvedValue({ id: "u1", email: "nina@thebackroomop.com", name: "Nina", role: "viewer", passwordHash, disabled: true });
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toBeNull();
  });

  it("lets the same user in once enabled", async () => {
    const passwordHash = await bcrypt.hash("correct horse battery", 4);
    h.findUnique.mockResolvedValue({ id: "u1", email: "nina@thebackroomop.com", name: "Nina", role: "viewer", passwordHash, disabled: false });
    expect(await authorize("nina@thebackroomop.com", "correct horse battery")).toMatchObject({ id: "u1", role: "viewer" });
  });
});
