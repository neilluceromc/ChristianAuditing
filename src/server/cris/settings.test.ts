import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 41 final review M2: "Your Cris" is saved by admin and IT only, like every other Cris action (spec §2).
 */

const h = vi.hoisted(() => ({
  roles: [] as string[][],
  user: { id: "u1", name: "Neil Lucero", role: "it_staff" } as { id: string; name: string; role: string } | null,
  upserts: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({
  actionRole: async (...roles: string[]) => { h.roles.push(roles); return h.user && roles.includes(h.user.role) ? h.user : null; },
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true }) }));
vi.mock("@/server/audit", () => ({ writeAudit: async () => {} }));
vi.mock("./settings-read", () => ({ ensureCrisFlag: async () => ({}) }));
vi.mock("@/server/db/client", () => ({
  prisma: {
    userPreference: {
      findUnique: async () => null,
      upsert: async () => { h.upserts += 1; return {}; },
    },
  },
}));

import { saveCrisPrefs } from "./settings";

beforeEach(() => {
  h.roles.length = 0;
  h.upserts = 0;
  h.user = { id: "u1", name: "Neil Lucero", role: "it_staff" };
});

describe("saveCrisPrefs", () => {
  it("asks for admin or IT", async () => {
    const r = await saveCrisPrefs({ seenHint: true });
    expect(h.roles).toEqual([["admin", "it_staff"]]);
    expect(r).toMatchObject({ ok: true, data: { seenHint: true } });
    expect(h.upserts).toBe(1);
  });

  it("merges tucked alone over the stored prefs", async () => {
    const r = await saveCrisPrefs({ tucked: true });
    expect(r).toMatchObject({ ok: true, data: { tucked: true, side: "right", bottom: 20, seenHint: false } });
    expect(h.upserts).toBe(1);
  });

  it("refuses a tucked that isn't a boolean, writing nothing", async () => {
    expect(await saveCrisPrefs({ tucked: "yes" })).toMatchObject({ ok: false, kind: "validation" });
    expect(h.upserts).toBe(0);
  });

  it("refuses a viewer, writing nothing", async () => {
    h.user = { id: "u2", name: "Vee Wer", role: "viewer" };
    expect(await saveCrisPrefs({ seenHint: true })).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.upserts).toBe(0);
  });
});
