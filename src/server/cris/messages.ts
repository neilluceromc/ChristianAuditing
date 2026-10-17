import type { CrisMessage, Prisma } from "@prisma/client";
import { toViewMessage, type CrisCard, type CrisViewMessage } from "@/lib/cris-cards";

/*
 * The conversation's message store, shared by Confirm/Undo (./pending-core.ts) and the turn loop (Task 5).
 * Deliberately NOT "use server": it takes a transaction and writes any conversation it is handed.
 */

export type CrisMessageRow = CrisMessage;
export type CrisMessageRole = "user" | "cris" | "tool";
/** What a "user" or "cris" row holds; a "tool" row holds the model's tool working as-is. */
export type CrisMessageContent = { text: string | null; cards: CrisCard[] };

export { toViewMessage };
export type { CrisViewMessage };

/**
 * Appends one message and bumps the conversation's `updatedAt` (the box opens the most recently used
 * conversation). `usage` is the model reply's token count and model, for the daily cost.
 */
export async function appendCrisMessage(
  tx: Prisma.TransactionClient,
  conversationId: string,
  role: CrisMessageRole,
  content: CrisMessageContent | unknown,
  usage?: { input: number; output: number; model: string },
): Promise<CrisMessageRow> {
  const row = await tx.crisMessage.create({
    data: {
      conversationId, role,
      content: content as Prisma.InputJsonValue,
      ...(usage ? { inputTokens: usage.input, outputTokens: usage.output, model: usage.model } : {}),
    },
  });
  await tx.crisConversation.update({ where: { id: conversationId }, data: { updatedAt: row.createdAt } });
  return row;
}

/** The box's view of freshly appended rows, tool rows left out. */
export function viewMessages(rows: CrisMessageRow[]): CrisViewMessage[] {
  return rows.map(toViewMessage).filter((m): m is CrisViewMessage => m !== null);
}
