import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Users & access (spec §4.1): the one hand-written migration. Read as text, like the earlier migration tests, so a
 * column, the enum, the unique employee link, the attempts index or the data step can't silently go missing.
 */

const sql = readFileSync(
  path.resolve(__dirname, "../../../prisma/migrations/20261024090000_access_management/migration.sql"),
  "utf8",
);
const flat = sql.replace(/\s+/g, " ");

describe("access management migration", () => {
  it("creates the AccountApprovalState enum (ApprovalState is the approvals queue's)", () => {
    expect(flat).toContain(`CREATE TYPE "AccountApprovalState" AS ENUM ('APPROVED', 'PENDING', 'DECLINED');`);
  });

  it.each([
    `"employeeId" TEXT`,
    `"mustChangePassword" BOOLEAN NOT NULL DEFAULT false`,
    `"passwordChangedAt" TIMESTAMP(3)`,
    `"lastSignInAt" TIMESTAMP(3)`,
    `"sessionVersion" INTEGER NOT NULL DEFAULT 0`,
    `"approvalState" "AccountApprovalState" NOT NULL DEFAULT 'APPROVED'`,
    `"approvalDecidedAt" TIMESTAMP(3)`,
    `"approvalDecidedById" TEXT`,
    `"createdById" TEXT`,
  ])("adds User.%s", (column) => {
    expect(flat).toMatch(new RegExp(`ALTER TABLE "User"[^;]*ADD COLUMN ${column.replace(/[()"]/g, "\\$&")}[,;]`));
  });

  it("makes the employee link unique, and SET NULL when the employee goes", () => {
    expect(flat).toContain(`CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");`);
    expect(flat).toContain(
      `ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,
    );
  });

  it("points the decided-by and created-by links at User, SET NULL", () => {
    for (const col of ["approvalDecidedById", "createdById"]) {
      expect(flat).toContain(
        `ALTER TABLE "User" ADD CONSTRAINT "User_${col}_fkey" FOREIGN KEY ("${col}") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;`,
      );
    }
  });

  it("creates SignInAttempt with its (emailKey, createdAt) index", () => {
    expect(flat).toMatch(/CREATE TABLE "SignInAttempt" \( "id" TEXT NOT NULL, "emailKey" TEXT NOT NULL, "createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SignInAttempt_pkey" PRIMARY KEY \("id"\) \);/);
    expect(flat).toContain(`CREATE INDEX "SignInAttempt_emailKey_createdAt_idx" ON "SignInAttempt"("emailKey", "createdAt");`);
  });

  it("turns waiting sign-ups (disabled, a signup entry, never enabled or disabled by an admin) into PENDING", () => {
    const update = /UPDATE "User" u SET "approvalState" = 'PENDING' WHERE (.*?);/.exec(flat);
    expect(update, "the data step's UPDATE").not.toBeNull();
    const where = update![1];
    expect(where).toContain(`u."disabled" = true`);
    expect(where).toMatch(/EXISTS \( SELECT 1 FROM "AuditEntry" a WHERE a\."entityType" = 'user' AND a\."entityId" = u\."id" AND a\."action" = 'signup' \)/);
    expect(where).toMatch(/NOT EXISTS \( SELECT 1 FROM "AuditEntry" a WHERE a\."entityType" = 'user' AND a\."entityId" = u\."id" AND a\."action" IN \('enable', 'disable'\) \)/);
  });

  it("leaves them disabled too (fix round 1, I-2): code still serving during the deploy, or after a rollback, refuses them", () => {
    expect(flat).not.toMatch(/"disabled" = false/);
    const set = /UPDATE "User" u SET (.*?) WHERE/.exec(flat)![1];
    expect(set).toBe(`"approvalState" = 'PENDING'`);
  });

  it("indexes SignInAttempt.createdAt for the prune, in the follow-up migration (fix round 1, M-4)", () => {
    const followUp = readFileSync(
      path.resolve(__dirname, "../../../prisma/migrations/20261024091000_sign_in_attempt_created_index/migration.sql"),
      "utf8",
    );
    expect(followUp).toContain(`CREATE INDEX "SignInAttempt_createdAt_idx" ON "SignInAttempt"("createdAt");`);
  });

  it("runs the data step after the columns exist", () => {
    expect(sql.indexOf(`UPDATE "User" u`)).toBeGreaterThan(sql.indexOf(`"approvalState" "AccountApprovalState"`));
  });
});
