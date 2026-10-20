import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn(async () => [{ email: "a@b.co", role: "admin" }]));
vi.mock("@/server/db/client", () => ({
  prisma: {
    featureFlag: { findUnique: vi.fn(async () => null) },
    user: { findMany },
  },
}));
vi.mock("@/server/auth", () => ({ signIn: vi.fn() }));

import { loadCardProps } from "./card-props";

beforeEach(() => {
  findMany.mockClear();
  vi.stubEnv("QUICK_LOGIN_EMAILS", "a@b.co");
});
afterEach(() => vi.unstubAllEnvs());

describe("loadCardProps quick sign-in", () => {
  it("shows the quick section and looks the accounts up when QUICK_LOGIN_EMAILS is set off Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    const card = await loadCardProps({});
    expect(card.quick?.accounts.map((a) => a.email)).toEqual(["a@b.co"]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("hides the quick section, with no lookup, whenever VERCEL is set", async () => {
    vi.stubEnv("VERCEL", "1");
    const card = await loadCardProps({});
    expect(card.quick).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
