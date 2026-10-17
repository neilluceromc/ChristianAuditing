import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 41 final review M1: Confirm and Undo answer nothing while Cris is off — the off copy, checked after the
 * role and before the rate limit (so a refused press spends no write budget). The cores are stubbed
 * (pending-core.test.ts covers them).
 */

const h = vi.hoisted(() => ({
  user: { id: "u1", name: "Neil Lucero", role: "it_staff" } as { id: string; name: string; role: string } | null,
  availability: { on: true } as { on: true } | { on: false; reason: "off" | "no-key" },
  calls: [] as string[],
}));

vi.mock("@/server/db/client", () => ({ prisma: {} }));
vi.mock("@/server/auth/guards", () => ({
  actionRole: async (...roles: string[]) => { h.calls.push(`role:${roles.join(",")}`); return h.user; },
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => { h.calls.push("rate"); return { allowed: true }; } }));
vi.mock("@/server/modules/lifecycle/revalidate", () => ({ revalidateAsset: () => {} }));
vi.mock("./settings-read", () => ({ crisAvailability: async () => { h.calls.push("availability"); return h.availability; } }));
vi.mock("./pending-core", () => ({
  confirmPending: async () => { h.calls.push("confirm"); return { result: { ok: true, data: { messages: [] } }, affected: null }; },
  undoPending: async () => { h.calls.push("undo"); return { result: { ok: true, data: { messages: [] } }, affected: null }; },
}));

import { crisConfirm, crisUndo } from "./pending";
import { CRIS_OFF_NO_KEY, CRIS_OFF_SWITCH } from "./turn-core";

beforeEach(() => {
  h.user = { id: "u1", name: "Neil Lucero", role: "it_staff" };
  h.availability = { on: true };
  h.calls.length = 0;
});

describe.each([
  ["crisConfirm", crisConfirm, "confirm"],
  ["crisUndo", crisUndo, "undo"],
] as const)("%s", (_name, action, core) => {
  it("runs role → availability → rate limit → the core while Cris is on", async () => {
    expect((await action({ pendingId: "p1" })).ok).toBe(true);
    expect(h.calls).toEqual(["role:admin,it_staff", "availability", "rate", core]);
  });

  it("refuses with the switch's off copy while an admin has Cris off, before the rate limit", async () => {
    h.availability = { on: false, reason: "off" };
    expect(await action({ pendingId: "p1" })).toEqual({ ok: false, kind: "conflict", message: CRIS_OFF_SWITCH });
    expect(h.calls).toEqual(["role:admin,it_staff", "availability"]);
  });

  it("refuses with the no-key copy when no AI key is set", async () => {
    h.availability = { on: false, reason: "no-key" };
    expect(await action({ pendingId: "p1" })).toMatchObject({ kind: "conflict", message: CRIS_OFF_NO_KEY });
  });

  it("checks the role first: a refused person learns nothing about Cris's state", async () => {
    h.user = null;
    h.availability = { on: false, reason: "off" };
    expect(await action({ pendingId: "p1" })).toMatchObject({ kind: "forbidden" });
    expect(h.calls).toEqual(["role:admin,it_staff"]);
  });
});
