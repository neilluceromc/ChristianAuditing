import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { visibleClassWhere } from "@/lib/asset-class";
import { pathAllowedForRole } from "@/lib/workspaces";
import { crisAvailabilityFrom } from "@/lib/cris-settings";
import { CRIS_DAILY_LIMIT_TEXT, dailyLeft, limitReached, manilaDayStart } from "@/lib/cris-limits";
import { notePick, pageEntity, parsePicks, type Picks } from "@/lib/cris-picks";
import { CRIS_BRAIN_TEXT, CRIS_REFUSED_TEXT, CRIS_SYSTEM, manilaToday, pickText, userTurn } from "@/lib/cris-prompt";
import { modelHistory, spareTagsOf, storedContent } from "@/lib/cris-history";
import type { CrisCard, CrisViewMessage } from "@/lib/cris-cards";
import type { CrisMood } from "@/lib/cris-mood";
import { crisSettings } from "./settings-read";
import { readPerson } from "./cards";
import { appendCrisMessage, viewMessages, type CrisMessageRow } from "./messages";
import { CRIS_TOOLS, runTool, type ToolMood } from "./tools";
import { CrisProviderError, pickModel } from "./model";

/*
 * Spec §8 "Running a turn": one person message, answered. NOT "use server" — it takes a user the action in
 * ./turn.ts has already authenticated (actionRole("admin", "it_staff")). Order: availability, the daily limit
 * (before any model call, Review Focus #5), the rate limit, then zod. The person's message is saved, then the
 * model and the tools loop at most 6 rounds, each round saved with its token usage. A provider failure or a
 * refusal takes the whole turn back out, so the question is not counted (Review Focus #4).
 */

export const CRIS_MAX_ROUNDS = 6;
/** Spec §7 "Paging": the box shows the newest 30 messages; "Earlier messages" loads 30 more. */
export const CRIS_HISTORY_PAGE = 30;
/**
 * The history is replayed in full on every request (append-only), so a conversation this many questions long
 * moves on to a fresh one rather than growing every request's cost without end.
 */
export const CRIS_MAX_TURNS = 40;

/** Spec §8 "The key", verbatim. */
export const CRIS_OFF_NO_KEY = "Cris is off — no AI key is set on the server";
export const CRIS_OFF_SWITCH = "Cris is off — an admin can switch Cris on in Settings › Cris.";
export const CRIS_RATE_TEXT = "Cris can take 10 questions a minute — try again in a moment.";
export const CRIS_ROUNDS_TEXT = "That took more steps than I'm allowed — try asking a simpler way.";
export const CRIS_EMPTY_TEXT = "Sorry, I didn't catch that — could you say it another way?";
export const CRIS_BUSY_TEXT = "Cris is still answering your last message — wait for it, then ask again.";
/** How long a turn's unanswered rows block another turn in the same conversation (a crashed turn's stop blocking after this). */
export const CRIS_TURN_GUARD_MS = 3 * 60_000;

export const STATUS_READY = "Ready";
export const STATUS_CONFIRM = "Waiting for your Confirm";

const id = z.string().trim().min(1).max(64);
export const sendSchema = z
  .object({
    conversationId: id.optional(),
    text: z.string().trim().min(1, "Type a message.").max(2000).optional(),
    pick: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("person"), employeeId: id }).strict(),
      z.object({ kind: z.literal("asset"), assetId: id, scanned: z.boolean() }).strict(),
    ]).optional(),
    page: z.object({ path: z.string().max(500) }).strict(),
  })
  .strict()
  .refine((v) => (v.text === undefined) !== (v.pick === undefined), { message: "Send a message or a pick.", path: ["text"] });

export type CrisSendInput = z.input<typeof sendSchema>;
export type CrisSendData = { conversationId: string; messages: CrisViewMessage[]; left: number; mood: CrisMood; status: string };

type Db = Prisma.TransactionClient;

/** A Cris message shown once and never stored (the limit, a provider failure, a refusal). */
function transient(text: string, now: Date): CrisViewMessage {
  return { id: `transient-${now.getTime()}`, role: "cris", text, cards: [], at: now.toISOString() };
}

/** The conversation id the browser sent, echoed only for the limit reply, which runs before zod and saves nothing. */
function sentConversationId(raw: unknown): string {
  const v = typeof raw === "object" && raw !== null ? (raw as { conversationId?: unknown }).conversationId : undefined;
  return typeof v === "string" && v.length <= 64 ? v : "";
}

/** Questions asked today (Manila): the person's saved messages since Manila midnight, in every conversation. */
function usedToday(userId: string, now: Date): Promise<number> {
  return prisma.crisMessage.count({ where: { role: "user", createdAt: { gte: manilaDayStart(now) }, conversation: { userId } } });
}

/**
 * The conversation to answer in: the one asked for when it is theirs, otherwise their most recent (one open
 * conversation per person), otherwise a new one. Someone else's id is never used. A conversation that has reached
 * CRIS_MAX_TURNS moves on to a new one.
 */
async function openConversation(userId: string, requested: string | undefined): Promise<{ id: string; picks: Picks }> {
  const found = await prisma.crisConversation.findFirst({
    where: requested ? { id: requested, userId } : { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true, picks: true },
  });
  if (found) {
    const turns = await prisma.crisMessage.count({ where: { conversationId: found.id, role: "user" } });
    if (turns < CRIS_MAX_TURNS) return { id: found.id, picks: parsePicks(found.picks) };
  }
  const created = await prisma.crisConversation.create({ data: { userId }, select: { id: true } });
  return { id: created.id, picks: { people: [], assets: [] } };
}

type Pick = NonNullable<z.output<typeof sendSchema>["pick"]>;

/** A structured pick as words, from DB reads by id — refused when the person can't see that record on the normal screens. */
async function pickWords(user: SessionUser, pick: Pick): Promise<{ text: string; add: { person?: string; asset?: string } } | null> {
  if (pick.kind === "person") {
    if (!pathAllowedForRole("/employees/x", user.role)) return null;
    const p = await readPerson(prisma, pick.employeeId);
    return p ? { text: pickText({ kind: "person", name: p.name, employeeNo: p.employeeNo }), add: { person: p.id } } : null;
  }
  if (!pathAllowedForRole("/inventory/x", user.role)) return null;
  const a = await prisma.asset.findFirst({ where: { AND: [{ id: pick.assetId }, visibleClassWhere(user.role)] }, select: { id: true, tag: true } });
  return a ? { text: pickText({ kind: "asset", tag: a.tag, scanned: pick.scanned }), add: { asset: a.id } } : null;
}

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/**
 * Spec §8 "Running a turn". Returns ok with Cris's messages for every outcome the box shows as a message —
 * including the daily limit (mood sad) and a provider failure or refusal (mood cross, not counted).
 */
export async function crisTurn(user: SessionUser, raw: unknown, now: Date = new Date()): Promise<ActionResult<CrisSendData>> {
  const settings = await crisSettings();
  const availability = crisAvailabilityFrom(settings, process.env);
  if (!availability.on) return conflict(availability.reason === "no-key" ? CRIS_OFF_NO_KEY : CRIS_OFF_SWITCH);

  // Review Focus #5: the limit is checked before any model call, and the refused question saves nothing.
  const used = await usedToday(user.id, now);
  if (limitReached(used, settings.dailyLimit)) {
    return ok({ conversationId: sentConversationId(raw), messages: [transient(CRIS_DAILY_LIMIT_TEXT, now)], left: 0, mood: "sad", status: STATUS_READY });
  }

  const rate = await checkRate(user.id, "cris");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec, CRIS_RATE_TEXT);

  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const input = parsed.data;

  // The page person is THIS message's page only — never an earlier message's (Review Focus #1).
  const page = { path: input.page.path, ...pageEntity(input.page.path) };
  const conversation = await openConversation(user.id, input.conversationId);
  const conversationId = conversation.id;
  const picksBefore = conversation.picks;
  let picks = picksBefore;

  let words = input.text ?? "";
  const scannedAssetIds: string[] = [];
  if (input.pick) {
    const pw = await pickWords(user, input.pick);
    if (!pw) return forbidden();
    words = pw.text;
    picks = notePick(picks, pw.add); // a structured pick is the person's own choice: noted before the model runs
    if (input.pick.kind === "asset" && input.pick.scanned) scannedAssetIds.push(input.pick.assetId);
  }

  const rows = await prisma.crisMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { role: true, content: true, createdAt: true },
  });
  // One turn at a time per conversation (a second tab): two turns' rounds interleaved would garble the history
  // both are replayed from. A turn's last row is its Cris reply; a recent person or tool row means one is running.
  const last = rows[rows.length - 1];
  if (last && last.role !== "cris" && now.getTime() - last.createdAt.getTime() < CRIS_TURN_GUARD_MS) return conflict(CRIS_BUSY_TEXT);
  // The spares card open in the box is the server's own: the last Cris message's, never the browser's say-so.
  const lastCris = [...rows].reverse().find((r) => r.role === "cris");
  const openSpareTags = spareTagsOf(lastCris?.content);

  const userMsg = userTurn({ firstName: firstNameOf(user.name), todayManila: manilaToday(now), page }, words);
  const userRow = await prisma.$transaction(async (tx) => {
    const row = await appendCrisMessage(tx, conversationId, "user", storedContent({ text: words, cards: [], api: [userMsg] }));
    await tx.crisConversation.update({ where: { id: conversationId }, data: { picks } });
    return row;
  });
  const turnRows = [userRow.id];

  const model = pickModel(settings);
  const usageOf = (u: { input: number; output: number }) => (model.id === "fake" ? undefined : { ...u, model: model.id });
  const messages: Anthropic.MessageParam[] = [...modelHistory(rows), userMsg];
  const cards: CrisCard[] = [];
  let lastMood: ToolMood | null = null;

  const append = (role: "tool" | "cris", content: unknown, usage?: { input: number; output: number; model: string }) =>
    prisma.$transaction(async (tx: Db) => {
      const row = await appendCrisMessage(tx, conversationId, role, content, usage);
      // Picks are saved with each round, before the next one runs.
      if (role === "tool") await tx.crisConversation.update({ where: { id: conversationId }, data: { picks } });
      return row;
    });

  /** Review Focus #4: take the whole turn back out — the question is not counted — and say so, Frustrated. */
  const takeBack = async (text: string): Promise<ActionResult<CrisSendData>> => {
    await prisma.$transaction([
      prisma.crisMessage.deleteMany({ where: { id: { in: turnRows } } }),
      prisma.crisConversation.update({ where: { id: conversationId }, data: { picks: picksBefore } }),
    ]);
    return ok({ conversationId, messages: [transient(text, now)], left: dailyLeft(used, settings.dailyLimit), mood: "cross", status: STATUS_READY });
  };

  let finalRow: CrisMessageRow | null = null;
  let failed: string | null = null;
  try {
    for (let round = 0; round < CRIS_MAX_ROUNDS; round++) {
      const reply = await model.reply({ system: CRIS_SYSTEM, messages, tools: CRIS_TOOLS });
      if (reply.stop === "refusal") { failed = CRIS_REFUSED_TEXT; break; }
      const uses = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const assistant: Anthropic.MessageParam = { role: "assistant", content: reply.content };

      if (uses.length === 0) {
        const text = reply.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n\n").trim();
        const shown = text || (cards.length > 0 ? null : CRIS_EMPTY_TEXT);
        // An empty reply sends nothing back: no assistant message is invented for the history.
        const api = reply.content.length > 0 ? [assistant] : [];
        finalRow = await append("cris", storedContent({ text: shown, cards, api }), usageOf(reply.usage));
        break;
      }
      // Tool calls cut off mid-way (max_tokens) can't be run or answered: treat as a failed reply.
      if (reply.stop !== "tool_use") { failed = CRIS_BRAIN_TEXT; break; }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const out = await runTool(
          { user, conversationId, picks, pageEmployeeId: page.employeeId, userText: input.text ?? "", openSpareTags, scannedAssetIds },
          use.name, use.input,
        );
        picks = out.picks;
        cards.push(...out.cards);
        lastMood = out.mood;
        const isError = typeof out.result === "object" && out.result !== null && "error" in out.result;
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.result), ...(isError ? { is_error: true } : {}) });
      }
      const resultsMsg: Anthropic.MessageParam = { role: "user", content: results };
      const toolRow = await append("tool", { api: JSON.stringify([assistant, resultsMsg]) }, usageOf(reply.usage));
      turnRows.push(toolRow.id);
      messages.push(assistant, resultsMsg);
    }
    if (!failed) finalRow ??= await append("cris", storedContent({ text: CRIS_ROUNDS_TEXT, cards, api: [] }));
  } catch (err) {
    if (!(err instanceof CrisProviderError)) {
      // A bug or a database error: leave no half turn behind (its rounds would be replayed), then let it surface.
      await takeBack(CRIS_BRAIN_TEXT);
      throw err;
    }
    failed = CRIS_BRAIN_TEXT;
  }
  if (failed || !finalRow) return takeBack(failed ?? CRIS_BRAIN_TEXT);

  const waiting = cards.some((c) => c.type === "confirm" || c.type === "spares" || c.type === "which");
  const mood: CrisMood = waiting ? "look" : lastMood === "sad" ? "sad" : "talk";
  return ok({
    conversationId,
    messages: viewMessages([userRow, finalRow]),
    left: dailyLeft(used + 1, settings.dailyLimit),
    mood,
    status: cards.some((c) => c.type === "confirm") ? STATUS_CONFIRM : STATUS_READY,
  });
}

// ── history and new chat ────────────────────────────────────────────────────

export const historySchema = z.object({ conversationId: id, before: id.optional() }).strict();

/** Spec §7 "Paging": 30 messages before `before` (or the newest 30), oldest first; `more` when earlier ones exist. */
export async function crisHistoryFor(user: SessionUser, raw: unknown): Promise<ActionResult<{ messages: CrisViewMessage[]; more: boolean }>> {
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec, CRIS_RATE_TEXT);
  const parsed = historySchema.safeParse(raw);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { conversationId, before } = parsed.data;

  // Chats are private to their person (spec §7).
  const conv = await prisma.crisConversation.findFirst({ where: { id: conversationId, userId: user.id }, select: { id: true } });
  if (!conv) return forbidden();

  const where: Prisma.CrisMessageWhereInput = { conversationId, role: { in: ["user", "cris", "assistant"] } };
  if (before) {
    const b = await prisma.crisMessage.findFirst({ where: { id: before, conversationId }, select: { id: true, createdAt: true } });
    if (!b) return validationError({ before: "That message isn't in this chat." });
    where.OR = [{ createdAt: { lt: b.createdAt } }, { createdAt: b.createdAt, id: { lt: b.id } }];
  }
  const rows = await prisma.crisMessage.findMany({
    where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CRIS_HISTORY_PAGE + 1,
  });
  return ok({ messages: viewMessages(rows.slice(0, CRIS_HISTORY_PAGE).reverse()), more: rows.length > CRIS_HISTORY_PAGE });
}

/** Spec §7: New chat starts a fresh conversation; the old one stays until the 30-day prune. */
export async function crisNewChatFor(user: SessionUser): Promise<ActionResult<{ conversationId: string }>> {
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const created = await prisma.crisConversation.create({ data: { userId: user.id }, select: { id: true } });
  return ok({ conversationId: created.id });
}
