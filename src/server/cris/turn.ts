"use server";

import { actionRole } from "@/server/auth/guards";
import { forbidden, type ActionResult } from "@/server/action-result";
import type { CrisViewMessage } from "@/lib/cris-cards";
import { crisHistoryFor, crisNewChatFor, crisTurn, type CrisSendData, type CrisSendInput } from "./turn-core";

/*
 * Spec §8 "Running a turn": the box's three server actions. Every export of this file is callable from the
 * browser, so each one checks the person first (admin and IT only, spec §2); the work is in ./turn-core.ts.
 * crisSend never confirms anything — Confirm and Undo are their own actions (./pending.ts).
 */

/** One message (typed words, or a structured pick of a person or an asset) from the page at `page.path`. */
export async function crisSend(input: CrisSendInput): Promise<ActionResult<CrisSendData>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  return crisTurn(user, input);
}

/** The newest 30 messages of one of the person's own conversations, or the 30 before `before`. */
export async function crisHistory(input: { conversationId: string; before?: string }): Promise<ActionResult<{ messages: CrisViewMessage[]; more: boolean }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  return crisHistoryFor(user, input);
}

/** New chat: a fresh conversation. */
export async function crisNewChat(): Promise<ActionResult<{ conversationId: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  return crisNewChatFor(user);
}
