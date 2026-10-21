import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Task 5 (spec §4 way 3): the direct Register — `/inventory/register`'s two submits, `createAsset` at quantity 1 and
 * `registerAssets` for a batch — is IT's (and an admin's) only: Purchasing registers from a purchase order. Neither
 * links a purchase order any more (the old `requestId` is gone), and each submit is one registration group that rings
 * Finance's bell once. Against an in-memory Prisma.
 */

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  actionRole: async (...roles: string[]) => (h.user && roles.includes(h.user.role) ? h.user : null),
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/server/recent-picks", () => ({ rememberPicks: async () => {} }));
vi.mock("@/server/webhooks/emit", () => ({ emitWebhook: async () => {} }));
vi.mock("@/server/modules/finance/queries", () => ({ nextToReview: async () => null }));
vi.mock("@/server/modules/finance/review-queue", () => ({ toReviewCount: async () => 0 }));
vi.mock("@/server/db/client", () => {
  type R = Record<string, unknown>;
  const matches = (rec: R, where: R | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
        const op = v as { in?: unknown[] };
        if (op.in) return op.in.includes(rec[k]);
      }
      return rec[k] === v;
    });
  let n = 0;
  const rows = (name: string) => (h.tables[name] ??= []);
  const table = (name: string) => ({
    findUnique: async ({ where }: { where: R }) => rows(name).find((x) => matches(x, where)) ?? null,
    findFirst: async ({ where }: { where?: R } = {}) => rows(name).find((x) => matches(x, where)) ?? null,
    findMany: async ({ where }: { where?: R } = {}) => rows(name).filter((x) => matches(x, where)),
    count: async ({ where }: { where?: R } = {}) => rows(name).filter((x) => matches(x, where)).length,
    create: async ({ data }: { data: R }) => {
      const row: R = { id: `${name}-${++n}`, createdAt: new Date(), ...data };
      rows(name).push(row);
      return row;
    },
  });
  const client = Object.fromEntries(
    ["asset", "assetCategory", "assetType", "purchaseRecord", "auditEntry", "notification", "purchaseOrder", "user"]
      .map((t) => [t, table(t)]),
  );
  return { prisma: { ...client, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client) } };
});

import { registerAssets } from "./receiving";
import { createAsset } from "@/server/modules/inventory/actions";

const PAT = { id: "u-pat", name: "Pat Lim", role: "purchasing_staff" };
const IVAN = { id: "u-ivan", name: "Ivan Tan", role: "it_staff" };

const t = (name: string) => h.tables[name];

beforeEach(() => {
  h.user = IVAN;
  h.tables = {
    assetCategory: [{ id: "cat-lt", name: "Laptop", cls: "IT" }, { id: "cat-ch", name: "Chairs", cls: "PURCHASING" }],
    assetType: [], asset: [], purchaseRecord: [], auditEntry: [], notification: [],
    purchaseOrder: [{ id: "po1", refNo: "PO-0214", state: "READY" }],
  };
});

const batch = (extra: Record<string, unknown> = {}) => ({
  categoryId: "cat-lt", model: "ThinkPad T14", tags: ["BR-LT-0201", "BR-LT-0202"], serials: ["SN-1", "SN-2"], ...extra,
});
const one = (extra: Record<string, unknown> = {}) => ({
  tag: "BR-LT-0301", serial: "SN-3", model: "ThinkPad T14", categoryId: "cat-lt", requestedStatus: "SPARE", ...extra,
});

describe("direct Register is IT's (spec §4 way 3)", () => {
  it("Purchasing can't register directly, at any quantity or class", async () => {
    h.user = PAT;
    expect(await registerAssets(batch({ categoryId: "cat-ch", serials: [] }))).toMatchObject({ ok: false, kind: "forbidden" });
    expect(await createAsset(one({ categoryId: "cat-ch", requestedStatus: "STORED", serial: "" }))).toMatchObject({ ok: false, kind: "forbidden" });
    expect(t("asset")).toHaveLength(0);
  });

  it("a batch: one group with no purchase order, IT-checked, and one Finance TO_CHECK", async () => {
    // An old client still sending requestId: it is not a field any more, so nothing links to the order.
    const r = await registerAssets(batch({ requestId: "po1" }));
    expect(r).toMatchObject({ ok: true, data: { created: 2 } });
    if (!r.ok) return;
    expect(t("purchaseRecord")).toHaveLength(1);
    expect(t("purchaseRecord")[0].purchaseOrderId ?? null).toBeNull();
    for (const a of t("asset")) {
      expect(a.purchaseOrderId ?? null).toBeNull();
      expect(a.itVerifiedById).toBe(IVAN.id);
    }
    expect(t("notification")).toEqual([expect.objectContaining({
      team: "FINANCE", kind: "TO_CHECK", title: "2 laptops registered by IT, ready to check",
      href: `/finance/review/${r.data.purchaseRecordId}`, entityType: "purchase-record", entityId: r.data.purchaseRecordId,
    })]);
  });

  it("one asset: no purchase order link, and one Finance TO_CHECK", async () => {
    const r = await createAsset(one({ requestId: "po1" }));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(t("purchaseRecord")[0].purchaseOrderId ?? null).toBeNull();
    expect(t("asset")[0].purchaseOrderId ?? null).toBeNull();
    expect(t("notification")).toEqual([expect.objectContaining({
      team: "FINANCE", kind: "TO_CHECK", title: "BR-LT-0301 registered by IT, ready to check",
      href: `/finance/review/${r.data.purchaseRecordId}`,
    })]);
  });
});
