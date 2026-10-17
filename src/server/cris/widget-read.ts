import { prisma } from "@/server/db/client";
import { dailyLeft, manilaDayStart } from "@/lib/cris-limits";
import { crisSettings } from "./settings-read";

/**
 * What the box starts from on a page load (the (app) layout, for admin and IT only): the person's open
 * conversation, if any — the most recently used, as crisSend picks it — and the questions they have left today.
 * Deliberately NOT "use server": it reads any person it is handed, and the layout hands it the signed-in one.
 * The messages themselves are fetched by crisHistory when the box first opens, so a page load reads no chat.
 */
export async function crisWidgetStart(userId: string, now: Date = new Date()): Promise<{ conversationId: string | null; left: number }> {
  const [settings, conversation, used] = await Promise.all([
    crisSettings(),
    prisma.crisConversation.findFirst({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
    // The same count crisSend's daily limit uses: the person's questions since Manila midnight, in every conversation.
    prisma.crisMessage.count({ where: { role: "user", createdAt: { gte: manilaDayStart(now) }, conversation: { userId } } }),
  ]);
  return { conversationId: conversation?.id ?? null, left: dailyLeft(used, settings.dailyLimit) };
}
