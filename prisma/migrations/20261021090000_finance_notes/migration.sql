-- Phase 47 (spec §4.3-§4.5, §5.5, §6): AssetNote, AuditEntry source/reason, AssetDocument size, CrisConversation clearedAt.
-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "source" TEXT,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "AssetDocument" ADD COLUMN     "size" INTEGER;

-- AlterTable
ALTER TABLE "CrisConversation" ADD COLUMN     "clearedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AssetNote" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorId" TEXT,
    "authorLabel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetNote_assetId_createdAt_idx" ON "AssetNote"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetNote_parentId_idx" ON "AssetNote"("parentId");

-- AddForeignKey
ALTER TABLE "AssetNote" ADD CONSTRAINT "AssetNote_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetNote" ADD CONSTRAINT "AssetNote_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AssetNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetNote" ADD CONSTRAINT "AssetNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
