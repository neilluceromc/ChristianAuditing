import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 41 final review M9: the `cris` FeatureFlag is changed only through Settings › Cris (saveCrisSettings,
 * audited `cris-settings`); the generic flag actions refuse it before any read or write.
 */

const h = vi.hoisted(() => ({ transactions: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({ actionRole: async () => ({ id: "u1", name: "Admin", role: "admin" }) }));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true }) }));
vi.mock("@/server/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/server/db/client", () => ({
  prisma: { $transaction: async () => { h.transactions += 1; return { ok: true, data: { changed: false } }; } },
}));

import { setFlag, setFlagValue } from "./flag-actions";

beforeEach(() => { h.transactions = 0; });

describe("the generic flag actions and the cris key", () => {
  it("setFlag refuses the cris key, writing nothing", async () => {
    const r = await setFlag({ key: "cris", enabled: false });
    expect(r).toMatchObject({ ok: false, kind: "conflict", message: "Cris is switched on and off in Settings › Cris." });
    expect(h.transactions).toBe(0);
  });

  it("setFlagValue refuses the cris key, writing nothing", async () => {
    const r = await setFlagValue({ key: "cris", value: "{}" });
    expect(r).toMatchObject({ ok: false, kind: "conflict", message: "Cris is switched on and off in Settings › Cris." });
    expect(h.transactions).toBe(0);
  });

  it("still runs for the other flags", async () => {
    const r = await setFlag({ key: "m365_sso", enabled: true });
    expect(r.ok).toBe(true);
    expect(h.transactions).toBe(1);
  });
});
