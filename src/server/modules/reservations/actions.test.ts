import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Worklist H4 Task 2 fix round 1 (review M1): a hold locks the asset's row before reading it, so a triage undo
 * running at the same moment either lands first (and the hold sees the item back in triage) or waits for the hold.
 */

const h = vi.hoisted(() => ({
  ops: [] as string[],
  asset: null as Record<string, unknown> | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({ actionRole: async () => ({ id: "u-neil", name: "Neil Lucero", role: "it_staff" }) }));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/server/audit", () => ({ writeAudit: async () => { h.ops.push("audit"); return "aud1"; } }));
vi.mock("@/server/modules/approvals/create", () => ({ openApprovalForAsset: async () => null }));
vi.mock("@/server/db/client", () => {
  const client = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      h.ops.push(`lock:${strings.join("$").replace(/\s+/g, " ").trim()}:${values.join(",")}`);
      return [];
    },
    asset: { findUnique: async ({ where }: { where: { id: string } }) => { h.ops.push(`read:${where.id}`); return h.asset; } },
    reservation: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { h.ops.push("hold"); return { id: "r1", ...data }; },
    },
    employee: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: "Ana Reyes", employeeNo: "EMP-0101", employment: "ACTIVE" }) },
  };
  return { prisma: { ...client, $transaction: async (fn: (tx: typeof client) => Promise<unknown>) => fn(client) } };
});

import { reserveAsset } from "./actions";

beforeEach(() => {
  h.ops = [];
  h.asset = { id: "a1", tag: "BR-LT-0230", cls: "IT", status: "SPARE", returnedAt: null };
});

describe("reserveAsset", () => {
  it("locks the asset's row before it reads it", async () => {
    const r = await reserveAsset({ assetId: "a1", employeeId: "emp1", expiresAt: "2099-01-01" });
    expect(r).toEqual({ ok: true, data: { id: "r1", tag: "BR-LT-0230" } });
    expect(h.ops).toEqual(['lock:SELECT "id" FROM "Asset" WHERE "id" = $ FOR UPDATE:a1', "read:a1", "hold", "audit"]);
  });

  it("an item an undo just put back in triage is refused, after the lock", async () => {
    h.asset = { ...h.asset, returnedAt: new Date("2026-10-20T01:00:00Z") };
    expect(await reserveAsset({ assetId: "a1", employeeId: "emp1", expiresAt: "2099-01-01" }))
      .toMatchObject({ ok: false, kind: "conflict", message: "BR-LT-0230 is not a spare." });
    expect(h.ops).toEqual(['lock:SELECT "id" FROM "Asset" WHERE "id" = $ FOR UPDATE:a1', "read:a1"]);
  });
});
