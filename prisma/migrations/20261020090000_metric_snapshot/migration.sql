-- Phase 46 (spec §2.1): the nightly MetricSnapshot, one row per key per Manila calendar day.
-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "key" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_day_key_key" ON "MetricSnapshot"("day", "key");

-- CreateIndex
CREATE INDEX "MetricSnapshot_key_day_idx" ON "MetricSnapshot"("key", "day");
