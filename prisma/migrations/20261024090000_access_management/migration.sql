-- Migration 41 (Users & access, spec §4.1): the account fields, the account approval state, and the sign-in attempts
-- table. Existing rows take the defaults: everyone stays APPROVED, version 0, nothing owed, and existing passwords
-- stay valid. Only waiting sign-ups move (step 5). Nothing is dropped.

-- ── 1. The account approval state ─────────────────────────────────────
-- Named AccountApprovalState: "ApprovalState" is already the approvals queue's enum.
-- CreateEnum
CREATE TYPE "AccountApprovalState" AS ENUM ('APPROVED', 'PENDING', 'DECLINED');

-- ── 2. The account fields ─────────────────────────────────────────────
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approvalDecidedAt" TIMESTAMP(3),
ADD COLUMN     "approvalDecidedById" TEXT,
ADD COLUMN     "approvalState" "AccountApprovalState" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "lastSignInAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- ── 3. Failed sign-ins, per lower-cased email (RateEvent needs a user) ─
-- CreateTable
CREATE TABLE "SignInAttempt" (
    "id" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignInAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignInAttempt_emailKey_createdAt_idx" ON "SignInAttempt"("emailKey", "createdAt");

-- ── 4. Links: one account per employee; who decided, who created ──────
-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_approvalDecidedById_fkey" FOREIGN KEY ("approvalDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 5. Data: sign-ups still waiting become PENDING ────────────────────
-- Before this release a sign-up under SIGNUP_REQUIRES_APPROVAL=1 was created disabled, with a `signup` audit entry
-- (entityType 'user', entityId = the new user), and an admin "approved" it by enabling it. So a disabled account
-- with a signup entry and no enable or disable entry has only ever waited: it becomes PENDING. An account an admin
-- ever enabled or disabled keeps its state. Everyone else stays APPROVED (the column default).
-- Fix round 1 (I-2, owner's ruling): a waiting sign-up STAYS disabled as well. The previous deployment keeps serving
-- while this migration runs in the build (and again after any rollback past this release); it knows only
-- `disabled`, so it must keep refusing them. Approving a sign-up clears `disabled` together with setting APPROVED.
UPDATE "User" u
SET "approvalState" = 'PENDING'
WHERE u."disabled" = true
  AND EXISTS (
    SELECT 1 FROM "AuditEntry" a
    WHERE a."entityType" = 'user' AND a."entityId" = u."id" AND a."action" = 'signup'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "AuditEntry" a
    WHERE a."entityType" = 'user' AND a."entityId" = u."id" AND a."action" IN ('enable', 'disable')
  );
