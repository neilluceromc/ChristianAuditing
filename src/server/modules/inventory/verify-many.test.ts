import { beforeEach, describe, expect, it, vi } from "vitest";

/* Worklist split view (H4) Task 2: the IT check's audit id, and Mark checked for several items, each on its own. */

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  rateCalls: 0,
  assets: new Map<string, Record<string, unknown>>(),
  audits: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
  transactions: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => { h.rateCalls += 1; return { allowed: true, retryAfterSec: 0 }; } }));
vi.mock("@/server/webhooks/emit", () => ({ emitWebhook: async () => {} }));
vi.mock("@/server/modules/finance/queries", () => ({ nextToReview: async () => null }));
vi.mock("@/server/modules/finance/review-queue", () => ({ toReviewCount: async () => 0 }));
vi.mock("@/server/db/client", () => {
  const asset = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const a = h.assets.get(where.id);
      return a ? { ...a } : null;
    },
    updateMany: async ({ where, data }: { where: { id: string; itVerifiedAt: null }; data: Record<string, unknown> }) => {
      const a = h.assets.get(where.id);
      if (!a || a.itVerifiedAt !== null) return { count: 0 };
      Object.assign(a, data);
      return { count: 1 };
    },
  };
  const auditEntry = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `aud${String(h.audits.length + 1).padStart(3, "0")}`, createdAt: new Date(), ...data };
      h.audits.push(row);
      return row;
    },
  };
  const client = { asset, auditEntry };
  return {
    prisma: {
      ...client,
      $transaction: async (fn: (tx: typeof client) => Promise<unknown>) => { h.transactions += 1; return fn(client); },
    },
  };
});

import { verifyAssetDetails, verifyMany } from "./actions";
import { TRIAGE_BULK_MAX } from "@/lib/triage-undo";

const NEIL = { id: "u-neil", name: "Neil Lucero", role: "it_staff" };

function seed(id: string, extra: Record<string, unknown> = {}) {
  h.assets.set(id, { id, tag: `BR-LT-${id}`, cls: "IT", itVerifiedAt: null, itVerifiedById: null, ...extra });
}

beforeEach(() => {
  h.user = NEIL;
  h.rateCalls = 0;
  h.assets = new Map();
  h.audits = [];
  h.revalidated = [];
  h.transactions = 0;
});

describe("verifyAssetDetails", () => {
  it("returns the audit id beside the tag", async () => {
    seed("0301");
    expect(await verifyAssetDetails({ id: "0301" })).toEqual({ ok: true, data: { tag: "BR-LT-0301", auditId: "aud001" } });
    expect(h.audits[0]).toMatchObject({ action: "it.verify", entityId: "0301", actorId: NEIL.id });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/inventory/0301", "/inventory/work"]));
  });
});

describe("verifyMany", () => {
  it("mixed results: each item on its own, the checked ones named by audit id", async () => {
    seed("0301");
    seed("0302", { itVerifiedAt: new Date("2026-10-22T00:00:00Z") }); // checked by someone else meanwhile
    seed("0303", { cls: "PURCHASING" });
    seed("0304");
    const r = await verifyMany({ assetIds: ["0301", "0302", "0303", "gone", "0304"] });
    expect(r).toEqual({
      ok: true,
      data: {
        done: ["0301", "0304"],
        failed: [
          { id: "0302", reason: "BR-LT-0302 was already checked." },
          { id: "0303", reason: expect.stringContaining("Purchasing assets are not IT-checked") },
          { id: "gone", reason: "That asset no longer exists." },
        ],
        auditIds: ["aud001", "aud002"],
      },
    });
    expect(h.rateCalls).toBe(1);
    expect(h.transactions).toBe(2); // one per item that got as far as its write
    expect(h.assets.get("0301")).toMatchObject({ itVerifiedById: NEIL.id });
  });

  it("IT and admins only, at most 100 items", async () => {
    seed("0301");
    h.user = { id: "u-ana", name: "Ana Cruz", role: "finance_staff" };
    expect(await verifyMany({ assetIds: ["0301"] })).toMatchObject({ ok: false, kind: "forbidden" });
    h.user = NEIL;
    const many = Array.from({ length: TRIAGE_BULK_MAX + 1 }, (_, i) => `a${i}`);
    expect(await verifyMany({ assetIds: many })).toMatchObject({ ok: false, kind: "validation" });
    expect(await verifyMany({ assetIds: [] })).toMatchObject({ ok: false, kind: "validation" });
    expect(h.audits).toEqual([]);
  });
});
