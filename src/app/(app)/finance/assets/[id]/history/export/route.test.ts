import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditRow, DepLine } from "@/lib/finance-history";

/*
 * Phase 47 (Task 7, spec §4.5): Export log — the Financial history's entries as CSV, guarded like the page
 * (admin, finance_staff) and honouring the tab's kind (`hk`) and person (`hw`) filters, every page of them.
 */

const h = vi.hoisted(() => ({ requireRole: vi.fn(), financeAssetDetail: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireRole: h.requireRole }));
vi.mock("@/server/modules/finance/asset-detail", () => ({ financeAssetDetail: h.financeAssetDetail }));

import { GET } from "./route";

const audit = (i: number, over: Partial<AuditRow> = {}): AuditRow => ({
  id: `e${i}`, actorId: "u1", actorLabel: "Ana Cruz", actorEmail: "ana@example.com", actorRole: "finance_staff",
  entityType: "asset", entityId: "a1", action: "update", diff: { cost: { from: 1, to: 2 } }, source: "web", reason: null,
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)), ...over,
});
const dep = (m: number): DepLine => ({
  id: `dep-${m}`, month: m, label: `M${m}`, at: new Date(Date.UTC(2026, 8, 1)), chargeC: 100, accFromC: 0, accToC: 100, bookFromC: 1000, bookToC: 900,
});

const call = (qs = "") => GET(new Request(`http://localhost/finance/assets/a1/history/export${qs}`), { params: Promise.resolve({ id: "a1" }) });

beforeEach(() => {
  h.requireRole.mockReset().mockResolvedValue({ id: "u1", role: "finance_staff" });
  h.financeAssetDetail.mockReset().mockResolvedValue({
    id: "a1", tag: "IT-0001", category: "Laptops", purchaseUnits: null, historyNames: {},
    audit: [
      ...Array.from({ length: 12 }, (_, i) => audit(i)),
      audit(20, { actorId: "u2", actorLabel: "Ben Reyes", action: "finance.return", diff: null, reason: "Wrong invoice" }),
    ],
    depLines: [dep(24321)],
  });
});

describe("GET /finance/assets/[id]/history/export", () => {
  it("is Finance's (admin, finance_staff)", async () => {
    await call();
    expect(h.requireRole).toHaveBeenCalledWith("admin", "finance_staff");
  });

  it("every entry, not one page: a CSV download named after the tag", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="asset-IT-0001-history-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await res.text()).replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toMatch(/^Reference,/);
    expect(lines).toHaveLength(1 + 14);
  });

  it("honours the kind and person filters", async () => {
    const kind = (await (await call("?hk=review")).text()).split("\r\n");
    expect(kind).toHaveLength(2);
    expect(kind[1]).toContain("Wrong invoice");
    const person = (await (await call("?hw=system")).text()).split("\r\n");
    expect(person).toHaveLength(2);
    expect(person[1]).toContain("System");
  });

  it("a missing asset is 404", async () => {
    h.financeAssetDetail.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
});
