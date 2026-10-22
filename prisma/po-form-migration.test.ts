import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Migration 39 (PO form redesign, spec §4): a pure SQL-text check. Applying it to a real database is the
 * brief's Step 3 command (`migrate deploy` + `migrate status`), not this file.
 */
const file = fileURLToPath(new URL("./migrations/20261023090000_po_form_fields/migration.sql", import.meta.url));
const sql = existsSync(file) ? readFileSync(file, "utf8") : "";

describe("migration 20261023090000_po_form_fields", () => {
  it("exists", () => expect(existsSync(file)).toBe(true));

  it("creates the PaidBy enum", () => {
    expect(sql).toContain(`CREATE TYPE "PaidBy" AS ENUM ('CREDIT_CARD', 'DEBIT_CARD');`);
  });

  it("adds the PO's number, paid by, seven totals and flags", () => {
    for (const col of [
      `"poNumber" TEXT`, `"paidBy" "PaidBy"`, `"totalSales" DECIMAL(12,2)`, `"lessVat" DECIMAL(12,2)`,
      `"netOfVat" DECIMAL(12,2)`, `"discount" DECIMAL(12,2)`, `"amountDue" DECIMAL(12,2)`, `"addVat" DECIMAL(12,2)`,
      `"totalAmountDue" DECIMAL(12,2)`, `"totalsConsistent" BOOLEAN`, `"formV2" BOOLEAN NOT NULL DEFAULT false`,
    ]) {
      expect(sql).toContain(col);
    }
  });

  it("gives every line a unit, pc by default", () => {
    expect(sql).toContain(`ALTER TABLE "PurchaseUnit" ADD COLUMN     "unit" VARCHAR(12) NOT NULL DEFAULT 'pc'`);
  });

  it("backfills every existing category as confirmed", () => {
    expect(sql).toContain(`UPDATE "AssetCategory" SET "confirmedAt" = now()`);
  });

  it("links a category's creator with SET NULL", () => {
    expect(sql).toMatch(/"AssetCategory_createdById_fkey" FOREIGN KEY \("createdById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL/);
  });

  it("adds the document supersede columns", () => {
    expect(sql).toContain(`"supersededAt" TIMESTAMP(3)`);
    expect(sql).toContain(`"supersededById" TEXT`);
  });

  it("makes the PO number unique, case- and space-insensitively, among live POs", () => {
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "PurchaseRequest_poNumber_live_key" ON "PurchaseRequest"(lower(btrim("poNumber"))) WHERE "poNumber" IS NOT NULL AND "state" <> 'CANCELLED'`,
    );
  });

  it("drops nothing and touches no trigger", () => {
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?TRIGGER/i);
  });
});

/** Migration 39b (fix round 1): defaults, the supersede FK and the sanity checks. */
const file2 = fileURLToPath(new URL("./migrations/20261023091000_po_form_defaults/migration.sql", import.meta.url));
const sql2 = existsSync(file2) ? readFileSync(file2, "utf8") : "";

describe("migration 20261023091000_po_form_defaults", () => {
  it("exists", () => expect(existsSync(file2)).toBe(true));

  it("confirms every category created anywhere else by default", () => {
    expect(sql2).toContain(`ALTER TABLE "AssetCategory" ALTER COLUMN "confirmedAt" SET DEFAULT CURRENT_TIMESTAMP;`);
  });

  it("links who superseded a document, RESTRICT like uploadedById", () => {
    expect(sql2).toMatch(
      /"RequestDocument_supersededById_fkey" FOREIGN KEY \("supersededById"\) REFERENCES "User"\("id"\) ON DELETE RESTRICT/,
    );
  });

  it.each(["totalSales", "lessVat", "netOfVat", "discount", "amountDue", "addVat", "totalAmountDue"])(
    "keeps %s non-negative",
    (k) => expect(sql2).toContain(`ADD CONSTRAINT "PurchaseRequest_${k}_nonneg" CHECK ("${k}" IS NULL OR "${k}" >= 0)`),
  );

  it("refuses a blank unit", () => {
    expect(sql2).toContain(`ADD CONSTRAINT "PurchaseUnit_unit_nonblank" CHECK (length(btrim("unit")) >= 1)`);
  });

  it("drops nothing and touches no trigger", () => {
    expect(sql2).not.toMatch(/\bDROP\b/);
    expect(sql2).not.toMatch(/(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?TRIGGER/i);
  });
});
