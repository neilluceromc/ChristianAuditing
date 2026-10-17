import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 41 final review M1: Confirm answers nothing while Cris is off — the off copy, checked after the role and
 * before the rate limit (so a refused press spends no write budget). Undo is the exception: switching Cris off must
 * never stop someone reversing a change they made a moment ago. The cores are stubbed (pending-core.test.ts covers them).
 */

const h = vi.hoisted(() => ({
  user: { id: "u1", name: "Neil Lucero", role: "it_staff" } as { id: string; name: string; role: string } | null,
  availability: { on: true } as { on: true; preview?: true } | { on: false; reason: "off" },
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
import { CRIS_OFF_SWITCH, CRIS_PREVIEW_ONLY_CHAT } from "./turn-core";

beforeEach(() => {
  h.user = { id: "u1", name: "Neil Lucero", role: "it_staff" };
  h.availability = { on: true };
  h.calls.length = 0;
});

describe("crisConfirm", () => {
  it("runs role → availability → rate limit → the core while Cris is on", async () => {
    expect((await crisConfirm({ pendingId: "p1" })).ok).toBe(true);
    expect(h.calls).toEqual(["role:admin,it_staff", "availability", "rate", "confirm"]);
  });

  it("refuses with the switch's off copy while an admin has Cris off, before the rate limit", async () => {
    h.availability = { on: false, reason: "off" };
    expect(await crisConfirm({ pendingId: "p1" })).toEqual({ ok: false, kind: "conflict", message: CRIS_OFF_SWITCH });
    expect(h.calls).toEqual(["role:admin,it_staff", "availability"]);
  });

  it("refuses in preview (no AI key: Cris only chats), before the rate limit and the core", async () => {
    h.availability = { on: true, preview: true };
    expect(await crisConfirm({ pendingId: "p1" })).toEqual({ ok: false, kind: "conflict", message: CRIS_PREVIEW_ONLY_CHAT });
    expect(h.calls).toEqual(["role:admin,it_staff", "availability"]);
  });
});

describe("crisUndo", () => {
  it("runs role → rate limit → the core while Cris is on", async () => {
    expect((await crisUndo({ pendingId: "p1" })).ok).toBe(true);
    expect(h.calls).toEqual(["role:admin,it_staff", "rate", "undo"]);
  });

  it("still undoes while Cris is switched off — the off switch never traps a fresh mistake", async () => {
    h.availability = { on: false, reason: "off" };
    expect((await crisUndo({ pendingId: "p1" })).ok).toBe(true);
    expect(h.calls).toEqual(["role:admin,it_staff", "rate", "undo"]);
  });
});

describe.each([
  ["crisConfirm", crisConfirm],
  ["crisUndo", crisUndo],
] as const)("%s", (_name, action) => {
  it("checks the role first: a refused person learns nothing about Cris's state", async () => {
    h.user = null;
    h.availability = { on: false, reason: "off" };
    expect(await action({ pendingId: "p1" })).toMatchObject({ kind: "forbidden" });
    expect(h.calls).toEqual(["role:admin,it_staff"]);
  });
});
