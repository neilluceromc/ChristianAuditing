import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { legacyPoState } from "../src/lib/po-flow";

/**
 * Migration 38 (spec §3, §8): a pure SQL-text check. The data check against a real database is the
 * brief's Step 4 command (`migrate deploy` + a state/refNo count), not this file.
 */
const file = fileURLToPath(new URL("./migrations/20261022090000_purchase_orders/migration.sql", import.meta.url));
const sql = existsSync(file) ? readFileSync(file, "utf8") : "";

describe("migration 20261022090000_purchase_orders", () => {
  it("exists", () => expect(existsSync(file)).toBe(true));

  it.each(["DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED"] as const)(
    "maps %s the way legacyPoState does",
    (old) => expect(sql).toContain(`WHEN '${old}' THEN '${legacyPoState(old)}'`),
  );

  it("spells out the five CASE lines", () => {
    for (const line of [
      "WHEN 'DRAFT' THEN 'SENT_BACK'",
      "WHEN 'SUBMITTED' THEN 'WITH_IT'",
      "WHEN 'IT_REVIEWED' THEN 'WITH_IT'",
      "WHEN 'COMPLETED' THEN 'READY'",
      "WHEN 'CANCELLED' THEN 'CANCELLED'",
    ]) {
      expect(sql).toContain(line);
    }
  });

  it("rewrites PR- refs to PO-", () => {
    expect(sql).toContain(`'PO-' ||`);
    expect(sql).toMatch(/WHERE "refNo" LIKE 'PR-%'/);
  });

  it("creates the notification tables", () => {
    expect(sql).toContain(`CREATE TABLE "Notification"`);
    expect(sql).toContain(`CREATE TABLE "NotificationRead"`);
  });

  it("keeps the table names (no drop, no rename)", () => {
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain(`RENAME TO "Purchase`);
  });

  it("leaves the NoteEntry append-only trigger alone", () => {
    expect(sql).not.toMatch(/(CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?TRIGGER/i);
    expect(sql).not.toContain(`ALTER TABLE "NoteEntry"`);
  });
});
