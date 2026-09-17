import { describe, expect, it } from "vitest";
import {
  adjustSchema,
  categorySchema,
  countSchema,
  issueSchema,
  itemSchema,
  LOT_DOCUMENT_KINDS,
  receiptSchema,
  setLotCostSchema,
  stocktakeOpenSchema,
  writeOffSchema,
} from "./stock-schema";

const todayStr = () => new Date().toISOString().slice(0, 10);

describe("categorySchema (spec §4)", () => {
  it("upper-cases a lower-case prefix then accepts it", () => {
    const r = categorySchema.safeParse({ name: "Office supplies", prefix: "os" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.prefix).toBe("OS");
  });
  it("refuses a prefix that isn't two or three letters", () => {
    expect(categorySchema.safeParse({ name: "X", prefix: "O" }).success).toBe(false);
    expect(categorySchema.safeParse({ name: "X", prefix: "OSXX" }).success).toBe(false);
  });
  it("refuses an empty name", () => {
    expect(categorySchema.safeParse({ name: "", prefix: "OS" }).success).toBe(false);
  });
});

describe("itemSchema", () => {
  it("allows a null pack size", () => {
    const r = itemSchema.safeParse({ categoryId: "c1", name: "Ballpen", unit: "piece", packSize: null, reorderLevel: 10 });
    expect(r.success).toBe(true);
  });
  it("refuses a pack size of 1 (a pack holds at least 2)", () => {
    const r = itemSchema.safeParse({ categoryId: "c1", name: "Ballpen", unit: "piece", packSize: 1, reorderLevel: 10 });
    expect(r.success).toBe(false);
  });
  it("refuses a missing category", () => {
    const r = itemSchema.safeParse({ categoryId: "", name: "Ballpen", unit: "piece", packSize: null, reorderLevel: 0 });
    expect(r.success).toBe(false);
  });
});

describe("receiptSchema", () => {
  const base = { itemId: "i1", quantity: 5, packs: null, supplierId: "", lotDate: "2026-01-01", reference: "", unitCost: 10, occurredAt: "2026-01-01" };
  it("accepts a valid receipt with packs null", () => {
    expect(receiptSchema.safeParse(base).success).toBe(true);
  });
  it("refuses a future occurredAt date", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
    const r = receiptSchema.safeParse({ ...base, occurredAt: future });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["occurredAt"]);
  });
  it("accepts occurredAt of exactly today", () => {
    expect(receiptSchema.safeParse({ ...base, occurredAt: todayStr() }).success).toBe(true);
  });
  it("defaults expiresAt to '' when omitted, and accepts one on or after the lot date", () => {
    const omitted = receiptSchema.safeParse(base);
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.expiresAt).toBe("");
    expect(receiptSchema.safeParse({ ...base, expiresAt: "2026-01-01" }).success).toBe(true); // same day as lotDate
    expect(receiptSchema.safeParse({ ...base, expiresAt: "2026-06-01" }).success).toBe(true);
  });
  it("refuses an expiresAt before the lot date", () => {
    const r = receiptSchema.safeParse({ ...base, lotDate: "2026-06-01", expiresAt: "2026-01-01" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(["expiresAt"]);
      expect(r.error.issues[0]?.message).toBe("Expires cannot be before the lot date");
    }
  });
});

describe("writeOffSchema", () => {
  it("accepts a lot and reason with no quantity (server resolves the default)", () => {
    const r = writeOffSchema.safeParse({ lotId: "lot1", reason: "Expired" });
    expect(r.success).toBe(true);
  });
  it("accepts an explicit positive quantity", () => {
    expect(writeOffSchema.safeParse({ lotId: "lot1", quantity: 5, reason: "Expired" }).success).toBe(true);
  });
  it("refuses a zero or negative quantity", () => {
    expect(writeOffSchema.safeParse({ lotId: "lot1", quantity: 0, reason: "Expired" }).success).toBe(false);
    expect(writeOffSchema.safeParse({ lotId: "lot1", quantity: -1, reason: "Expired" }).success).toBe(false);
  });
  it("refuses a reason under 3 characters, message 'Say why'", () => {
    const r = writeOffSchema.safeParse({ lotId: "lot1", reason: "no" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Say why");
  });
  it("refuses a missing lotId", () => {
    expect(writeOffSchema.safeParse({ lotId: "", reason: "Expired" }).success).toBe(false);
  });
});

describe("setLotCostSchema", () => {
  it("accepts a non-negative two-decimal unit cost", () => {
    expect(setLotCostSchema.safeParse({ lotId: "lot1", unitCost: 9 }).success).toBe(true);
    expect(setLotCostSchema.safeParse({ lotId: "lot1", unitCost: 0.9 }).success).toBe(true);
  });
  it("refuses a negative unit cost", () => {
    expect(setLotCostSchema.safeParse({ lotId: "lot1", unitCost: -1 }).success).toBe(false);
  });
  it("refuses more than two decimals", () => {
    expect(setLotCostSchema.safeParse({ lotId: "lot1", unitCost: 9.001 }).success).toBe(false);
  });
  it("refuses a missing lotId", () => {
    expect(setLotCostSchema.safeParse({ lotId: "", unitCost: 9 }).success).toBe(false);
  });
});

describe("LOT_DOCUMENT_KINDS", () => {
  it("is the three kinds a lot document can carry", () => {
    expect(LOT_DOCUMENT_KINDS).toEqual(["delivery-receipt", "invoice", "other"]);
  });
});

describe("issueSchema", () => {
  it("requires a department", () => {
    const r = issueSchema.safeParse({ itemId: "i1", quantity: 1, departmentId: "" });
    expect(r.success).toBe(false);
  });
  it("accepts a valid issue", () => {
    const r = issueSchema.safeParse({ itemId: "i1", quantity: 1, departmentId: "d1" });
    expect(r.success).toBe(true);
  });
});

describe("adjustSchema", () => {
  it("refuses a delta of zero (changes nothing)", () => {
    const r = adjustSchema.safeParse({ itemId: "i1", mode: "delta", quantity: 0, reason: "recount" });
    expect(r.success).toBe(false);
  });
  it("refuses a negative set target (a balance cannot be negative)", () => {
    const r = adjustSchema.safeParse({ itemId: "i1", mode: "set", quantity: -1, reason: "recount" });
    expect(r.success).toBe(false);
  });
  it("allows a set target of zero", () => {
    const r = adjustSchema.safeParse({ itemId: "i1", mode: "set", quantity: 0, reason: "recount" });
    expect(r.success).toBe(true);
  });
  it("allows a nonzero delta", () => {
    const r = adjustSchema.safeParse({ itemId: "i1", mode: "delta", quantity: -3, reason: "damaged" });
    expect(r.success).toBe(true);
  });
});

describe("stocktakeOpenSchema", () => {
  it("accepts the literal 'all' for every category", () => {
    expect(stocktakeOpenSchema.safeParse({ categoryId: "all", dueAt: "2026-09-20" }).success).toBe(true);
  });
  it("refuses an empty categoryId", () => {
    expect(stocktakeOpenSchema.safeParse({ categoryId: "", dueAt: "2026-09-20" }).success).toBe(false);
  });
  it("refuses a dueAt that isn't YYYY-MM-DD", () => {
    const r = stocktakeOpenSchema.safeParse({ categoryId: "all", dueAt: "20/09/2026" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Use the date picker");
  });
  it("refuses a missing dueAt", () => {
    expect(stocktakeOpenSchema.safeParse({ categoryId: "all" }).success).toBe(false);
  });
});

describe("countSchema", () => {
  it("refuses a negative count", () => {
    expect(countSchema.safeParse({ lineId: "l1", countedQty: -1 }).success).toBe(false);
  });
  it("accepts a zero count", () => {
    expect(countSchema.safeParse({ lineId: "l1", countedQty: 0 }).success).toBe(true);
  });
});
