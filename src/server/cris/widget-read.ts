import { dailyLeft } from "@/lib/cris-limits";
import { crisSettings } from "./settings-read";
import { latestConversationId, usedToday } from "./turn-core";

/**
 * What the box starts from on a page load (the (app) layout, for admin and IT only): the person's open
 * conversation, if any — the most recently used, as crisSend picks it — and the questions they have left today.
 * Deliberately NOT "use server": it reads any person it is handed, and the layout hands it the signed-in one.
 * The messages themselves are fetched by crisHistory when the box first opens, so a page load reads no chat.
 * Both reads are turn-core's own (the daily limit's count, the open conversation), so the two never drift apart.
 */
export async function crisWidgetStart(userId: string, now: Date = new Date()): Promise<{ conversationId: string | null; left: number }> {
  const [settings, conversationId, used] = await Promise.all([
    crisSettings(),
    latestConversationId(userId),
    usedToday(userId, now),
  ]);
  return { conversationId, left: dailyLeft(used, settings.dailyLimit) };
}
