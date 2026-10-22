import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 (Task 4, spec §4.2 and §4.5): financeAssetDetail's new data — the cost breakdown per the ruling
 * (price, fees from the purchase record, salvage, base = cost − salvage), the purchase card, the audit rows of the
 * asset AND its purchase record (actor email and role joined), the derived depreciation lines, note and attachment
 * counts, document sizes — and Review Focus 1: no cost, not capitalised or not approved → no schedule, no lines.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  asset: null as Record<string, unknown> | null,
  audits: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  notes: [] as Record<string, unknown>[],
  /** id → name for the supplier / category / type / holder / department lookups. */
  names: {} as Record<string, string>,
  nameReads: [] as string[],
  auditFindMany: vi.fn(),
  userFindMany: vi.fn(),
  noteFindMany: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    asset: { findUnique: vi.fn(async () => h.asset) },
    auditEntry: { findMany: h.auditFindMany },
    user: { findMany: h.userFindMany },
    assetNote: { findMany: h.noteFindMany },
    ...Object.fromEntries(["vendor", "assetCategory", "assetType", "employee", "department"].map((model) => [model, {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        h.nameReads.push(model);
        return where.id.in.filter((id) => id in h.names).map((id) => ({ id, name: h.names[id] }));
      }),
    }])),
  },
}));

import { financeAssetDetail } from "./asset-detail";
import { buildHistory } from "@/lib/finance-history";
import { ledgerYears } from "@/lib/finance-ledger";
import { asOfMonth } from "@/lib/depreciation";

const NOW = new Date("2026-10-19T04:00:00.000Z"); // October 2026, Manila
const APPROVED = new Date("2026-01-10T02:00:00Z");

function asset(extra: Row = {}): Row {
  return {
    id: "a1", tag: "IT-0042", model: "Latitude 7450", brand: "Dell", serial: "SN1", cls: "IT", status: "DEPLOYED",
    categoryId: "cat1", cost: "36000.00", purchasedAt: new Date("2025-12-15T00:00:00Z"),
    itVerifiedAt: new Date("2025-12-20T00:00:00Z"), financeConfirmedAt: APPROVED, financeReturnedAt: null,
    financeNotCapitalised: false, financeReturnFields: [], financeReturnReason: null, financeResubmitNote: null,
    depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null,
    invoiceRef: "SI-1001", receiptRef: "OR-2002", warrantyUntil: new Date("2028-12-15T00:00:00Z"),
    warrantyCoveredBy: "Dell PH", warrantyContact: null, purchaseRecordId: "pr1",
    category: { name: "Laptops", depreciationLifeMonths: 36, depreciationSalvagePercent: "10" },
    assignee: { name: "Carla Diaz" }, vendor: { name: "Octagon" },
    purchaseOrder: { id: "req1", refNo: "PR-2025-0012", requestedBy: { name: "Pia Lim" }, units: [{ qty: 3, unitPrice: "36000.00" }] },
    purchaseRecord: { id: "pr1", fees: "1500.00", quantity: 3 },
    documents: [
      { id: "d1", kind: "invoice", fileName: "invoice.pdf", size: 120_000, createdAt: new Date("2026-01-01T00:00:00Z"), uploadedBy: { name: "Ana Cruz" } },
      { id: "d2", kind: "official-receipt", fileName: "or.png", size: null, createdAt: new Date("2026-01-02T00:00:00Z"), uploadedBy: null },
      { id: "d3", kind: "attachment:quotation", fileName: "quote.pdf", size: 9_000, createdAt: new Date("2026-02-01T00:00:00Z") },
      { id: "d4", kind: "attachment:photo", fileName: "box.jpg", size: 50_000, createdAt: new Date("2026-02-02T00:00:00Z") },
    ],
    financeConfirmedBy: { name: "Ana Cruz" },
    ...extra,
  };
}

let seq = 0;
const audit = (extra: Row): Row => ({
  id: `cmaudit${String(++seq).padStart(6, "0")}`, actorId: "u-ana", actorLabel: "Ana Cruz", entityType: "asset", entityId: "a1",
  action: "update", diff: null, source: null, reason: null, createdAt: new Date("2026-03-01T02:00:00Z"), ...extra,
});

// confirmFinance stamps financeConfirmedAt, then writes the audit entry a few ms later
const CONFIRM_ENTRY_AT = new Date(APPROVED.getTime() + 5);

beforeEach(() => {
  seq = 0;
  h.asset = asset();
  h.names = { "ven-old": "Octagon", "ven-new": "Acme Trading" };
  h.nameReads = [];
  h.audits = [
    audit({ action: "finance.confirm", diff: { financeConfirmed: { from: null, to: "Ana Cruz" } }, createdAt: CONFIRM_ENTRY_AT }),
    audit({ action: "update", diff: { cost: { from: 30000, to: 36000 } } }),
    audit({ action: "update", diff: { vendorId: { from: "ven-old", to: "ven-new" } }, createdAt: new Date("2026-03-02T02:00:00Z") }),
    audit({ action: "update", diff: { location: { from: "A", to: "B" } } }), // not finance history
    audit({ action: "lifecycle.assign", diff: { assignee: { from: null, to: "Carla" } } }), // not finance history
    audit({
      actorId: "u-pia", actorLabel: "Pia Lim", entityType: "purchase-record", entityId: "pr1", action: "purchase.recorded",
      diff: { quantity: { from: null, to: 3 }, total: { from: null, to: "109500.00" } }, createdAt: new Date("2025-12-15T03:00:00Z"),
    }),
    audit({ actorId: null, actorLabel: "System", action: "finance.reopened", diff: { cost: { from: null, to: 36000 } } }),
  ];
  h.users = [
    { id: "u-ana", email: "ana@example.test", role: "finance_staff" },
    { id: "u-pia", email: "pia@example.test", role: "purchasing_staff" },
  ];
  h.notes = [
    { parentId: null, resolvedAt: null },
    { parentId: "n1", resolvedAt: null },
    { parentId: null, resolvedAt: new Date("2026-05-01T00:00:00Z") },
  ];
  h.auditFindMany.mockReset().mockImplementation(async () => h.audits);
  h.userFindMany.mockReset().mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    h.users.filter((u) => where.id.in.includes(u.id as string)));
  h.noteFindMany.mockReset().mockImplementation(async () => h.notes);
});

describe("financeAssetDetail — cost breakdown and purchase (spec §4.2 ruling)", () => {
  it("price is Asset.cost, fees and units from the purchase record, salvage resolved, base = cost − salvage", async () => {
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.cost).toEqual({ priceC: 3_600_000, feesC: 150_000, feesUnits: 3, salvageC: 360_000, baseC: 3_240_000 });
  });

  it("a custom override's salvage is the one used", async () => {
    h.asset = asset({ depreciationLifeMonths: 24, depreciationSalvage: "1000.00" });
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.cost).toMatchObject({ salvageC: 100_000, baseC: 3_500_000 });
  });

  it("the purchase card's fields", async () => {
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.purchase).toEqual({
      pr: { id: "req1", refNo: "PR-2025-0012" }, requestedBy: "Pia Lim", supplier: "Octagon",
      invoiceRef: "SI-1001", receiptRef: "OR-2002", purchasedAt: new Date("2025-12-15T00:00:00Z"),
      warrantyUntil: new Date("2028-12-15T00:00:00Z"), coveredBy: "Dell PH",
    });
  });

  it("no purchase record → no fees or units", async () => {
    h.asset = asset({ purchaseRecord: null, purchaseRecordId: null });
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.cost).toMatchObject({ feesC: null, feesUnits: null });
  });
});

describe("financeAssetDetail — history sources (spec §4.5)", () => {
  it("reads the asset's entries AND its purchase record's", async () => {
    await financeAssetDetail("a1", NOW);
    const where = h.auditFindMany.mock.calls[0][0].where as { OR: Row[] };
    expect(where.OR).toContainEqual({ entityType: "purchase-record", entityId: "pr1" });
    expect(where.OR.some((w) => w.entityType === "asset" && w.entityId === "a1")).toBe(true);
  });

  it("reads the undo of a send-back too (finance follow-up: it does not start with finance.)", async () => {
    await financeAssetDetail("a1", NOW);
    const where = h.auditFindMany.mock.calls[0][0].where as { OR: Array<{ entityType?: string; OR?: Array<{ action?: { in?: string[] } }> }> };
    const asset = where.OR.find((w) => w.entityType === "asset")!;
    expect(asset.OR!.some((w) => w.action?.in?.includes("asset.return.undone"))).toBe(true);
  });

  it("keeps the finance-relevant rows with email and role joined; drops lifecycle and non-finance updates", async () => {
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.audit.map((r) => r.action).sort()).toEqual(["finance.confirm", "finance.reopened", "purchase.recorded", "update", "update"]);
    const fee = d.audit.find((r) => r.entityType === "purchase-record")!;
    expect(fee).toMatchObject({ actorEmail: "pia@example.test", actorRole: "purchasing_staff" });
    const sys = d.audit.find((r) => r.actorId === null)!;
    expect(sys).toMatchObject({ actorEmail: null, actorRole: null });
    expect(d.purchaseUnits).toBe(3);
  });

  it("one derived depreciation line per counted month (Dec 2025 … Oct 2026)", async () => {
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.depLines).toHaveLength(11);
    expect(d.depLines[0].label).toBe("December 2025");
  });

  it("catch-up lines are dated at the finance.confirm entry (ms after financeConfirmedAt), so they list above it", async () => {
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.depLines[0].at).toEqual(CONFIRM_ENTRY_AT);
    const rows = buildHistory(d.audit, d.depLines, { pageSize: 1000 }, { assetTag: d.tag, names: d.historyNames }).rows;
    const confirmAt = rows.findIndex((r) => r.verb.startsWith("approved"));
    const decAt = rows.findIndex((r) => r.verb === "counted December 2025 depreciation");
    expect(decAt).toBeGreaterThanOrEqual(0);
    expect(decAt).toBeLessThan(confirmAt);
  });

  it("resolves the vendor ids in the diffs to names; the chip never shows an id", async () => {
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.historyNames).toMatchObject({ "ven-old": "Octagon", "ven-new": "Acme Trading" });
    expect(h.nameReads).toEqual(["vendor"]);
    const rows = buildHistory(d.audit, d.depLines, { pageSize: 1000 }, { assetTag: d.tag, names: d.historyNames }).rows;
    const r = rows.find((x) => x.changes.some((c) => c.field === "vendor"))!;
    expect(r.changes).toEqual([{ field: "vendor", from: "Octagon", to: "Acme Trading" }]);
    expect(JSON.stringify(rows)).not.toContain("ven-");
  });
});

describe("financeAssetDetail — notes, attachments, documents", () => {
  it("counts note threads (and open ones) and attachments; docs carry size and upload stamp; attachments are not document slots", async () => {
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.noteCount).toBe(2);
    expect(d.openNoteCount).toBe(1);
    expect(d.attachmentCount).toBe(2);
    expect(d.docs.find((x) => x.kind === "invoice")!.file).toEqual({
      id: "d1", fileName: "invoice.pdf", size: 120_000, uploadedAt: "2026-01-01T00:00:00.000Z", uploadedBy: "Ana Cruz",
    });
    expect(d.docs.find((x) => x.kind === "official-receipt")!.file).toEqual({
      id: "d2", fileName: "or.png", size: null, uploadedAt: "2026-01-02T00:00:00.000Z", uploadedBy: null,
    });
    expect(d.docs.some((x) => x.file?.fileName === "quote.pdf")).toBe(false);
  });
});

describe("Review Focus 1: no cost, not capitalised, not approved → no schedule", () => {
  const cases: Array<[string, Row]> = [
    ["no cost", { cost: null }],
    ["not capitalised", { financeNotCapitalised: true }],
    ["not approved", { financeConfirmedAt: null, financeConfirmedBy: null }],
  ];
  for (const [name, extra] of cases) {
    it(`${name}: no years, no ledger rows, no depreciation lines, and a reason note`, async () => {
      h.asset = asset(extra);
      const d = (await financeAssetDetail("a1", NOW))!;
      expect(d.years).toEqual([]);
      expect(ledgerYears(d.years, asOfMonth(NOW))).toEqual([]);
      expect(d.depLines).toEqual([]);
      expect(d.note).toBeTruthy();
    });
  }

  it("no cost → the breakdown has no price or base", async () => {
    h.asset = asset({ cost: null });
    const d = (await financeAssetDetail("a1", NOW))!;
    expect(d.cost).toMatchObject({ priceC: null, salvageC: null, baseC: null });
  });
});
