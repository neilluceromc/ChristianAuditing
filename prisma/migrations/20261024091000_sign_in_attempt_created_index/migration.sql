-- Migration 41b (Users & access, fix round 1, M-4): the worker prunes SignInAttempt rows older than a day with
-- "createdAt" < cutoff, which the (emailKey, createdAt) index can't serve. Separate from migration 41 only because
-- that one was already applied to the local dev database.
-- CreateIndex
CREATE INDEX "SignInAttempt_createdAt_idx" ON "SignInAttempt"("createdAt");
