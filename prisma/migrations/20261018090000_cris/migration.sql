-- Phase 41 (spec §7): Cris conversations, messages and pending actions.
-- CreateTable
CREATE TABLE "CrisConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "picks" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrisConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrisMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrisMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrisPendingAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "card" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "resultRef" TEXT,

    CONSTRAINT "CrisPendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrisConversation_userId_updatedAt_idx" ON "CrisConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CrisMessage_conversationId_createdAt_idx" ON "CrisMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "CrisPendingAction_userId_createdAt_idx" ON "CrisPendingAction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CrisConversation" ADD CONSTRAINT "CrisConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisMessage" ADD CONSTRAINT "CrisMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CrisConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

