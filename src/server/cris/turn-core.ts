import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { visibleClassWhere } from "@/lib/asset-class";
import { pathAllowedForRole } from "@/lib/workspaces";
import { crisAvailabilityFrom, type CrisSettings } from "@/lib/cris-settings";
import { CRIS_DAILY_LIMIT_TEXT, dailyLeft, limitReached, manilaDayStart } from "@/lib/cris-limits";
import { isPricedModel } from "@/lib/cris-cost";
import { notePick, pageEntity, parsePicks, type Picks } from "@/lib/cris-picks";
import { CRIS_BRAIN_TEXT, CRIS_REFUSED_TEXT, CRIS_SYSTEM, manilaToday, pickText, userTurn } from "@/lib/cris-prompt";
import { modelHistory, openPickCard, spareTagsOf, storedContent, turnInFlight } from "@/lib/cris-history";
import type { CrisCard, CrisViewMessage } from "@/lib/cris-cards";
import type { CrisMood } from "@/lib/cris-mood";
import { crisSettings } from "./settings-read";
import { readPerson } from "./cards";
import { appendCrisMessage, viewMessages, type CrisMessageRow } from "./messages";
import { CRIS_TOOLS, runTool, type ToolMood } from "./tools";
import { CrisProviderError, pickModel, type CrisReply } from "./model";

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
export const CRIS_TOO_LONG_TEXT = "That got too long for me — try asking a smaller question.";
export const CRIS_FRESH_TEXT = "Something went wrong in our chat — I've started a fresh one. Ask me again?";
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
/** `conversationId` is null only on the daily-limit reply when the browser sent no conversation of the person's. */
export type CrisSendData = { conversationId: string | null; messages: CrisViewMessage[]; left: number; mood: CrisMood; status: string };

type Db = Prisma.TransactionClient;

/** A Cris message shown once and never stored (the limit, a provider failure, a refusal). */
function transient(text: string, now: Date): CrisViewMessage {
  return { id: `transient-${now.getTime()}`, role: "cris", text, cards: [], at: now.toISOString() };
}

/** Cris off (the admin switch, or no key): the refusal every Cris action gives; null when Cris is on. */
function offRefusal(settings: CrisSettings): ActionResult<never> | null {
  const availability = crisAvailabilityFrom(settings, process.env);
  if (availability.on) return null;
  return conflict(availability.reason === "no-key" ? CRIS_OFF_NO_KEY : CRIS_OFF_SWITCH);
}

/** The conversation the browser sent, when it is the person's own (checked by id and owner); otherwise null. */
async function ownedConversationId(userId: string, raw: unknown): Promise<string | null> {
  const v = typeof raw === "object" && raw !== null ? (raw as { conversationId?: unknown }).conversationId : undefined;
  if (typeof v !== "string" || v.length === 0 || v.length > 64) return null;
  const c = await prisma.crisConversation.findFirst({ where: { id: v, userId }, select: { id: true } });
  return c?.id ?? null;
}

/** Questions asked today (Manila): the person's saved messages since Manila midnight, in every conversation. */
function usedToday(userId: string, now: Date): Promise<number> {
  return prisma.crisMessage.count({ where: { role: "user", createdAt: { gte: manilaDayStart(now) }, conversation: { userId } } });
}

/**
 * The conversation to answer in:
 *  - with an id: that conversation when it is the person's own; an id that is not theirs (or no longer exists)
 *    gets a NEW conversation — someone else's is never used, and theirs is never guessed;
 *  - without one: their most recent (one open conversation per person), or a new one if they have none;
 *  - one that has reached CRIS_MAX_TURNS moves on to a new one, carrying over the person's picks and the pick
 *    card still open in it (a spares or "Which one?" list), so the pick that answers that card still works.
 */
async function openConversation(userId: string, requested: string | undefined): Promise<string> {
  const found = await prisma.crisConversation.findFirst({
    where: requested ? { id: requested, userId } : { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true, picks: true },
  });
  if (!found) return (await prisma.crisConversation.create({ data: { userId }, select: { id: true } })).id;
  const turns = await prisma.crisMessage.count({ where: { conversationId: found.id, role: "user" } });
  if (turns < CRIS_MAX_TURNS) return found.id;
  return rollOver(userId, found.id, parsePicks(found.picks));
}

/** A fresh conversation for a full one: the picks, and the open pick card as a Cris message (a box note to the model). */
async function rollOver(userId: string, fromId: string, picks: Picks): Promise<string> {
  const lastCris = await prisma.crisMessage.findFirst({
    where: { conversationId: fromId, role: "cris" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { content: true },
  });
  const card = openPickCard(lastCris?.content);
  return prisma.$transaction(async (tx) => {
    const created = await tx.crisConversation.create({ data: { userId, picks }, select: { id: true } });
    if (card) await appendCrisMessage(tx, created.id, "cris", { text: null, cards: [card] });
    return created.id;
  });
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

/** How a turn ended without an answer: the copy to show, and whether the conversation's history must be left behind. */
type Failure = { text: string; fresh?: true };

/**
 * Spec §8 "Running a turn". Returns ok with Cris's messages for every outcome the box shows as a message —
 * including the daily limit (mood sad) and a provider failure or refusal (mood cross, not counted).
 */
export async function crisTurn(user: SessionUser, raw: unknown, now: Date = new Date()): Promise<ActionResult<CrisSendData>> {
  const settings = await crisSettings();
  const off = offRefusal(settings);
  if (off) return off;

  // Review Focus #5: the limit is checked before any model call, and the refused question saves nothing.
  const used = await usedToday(user.id, now);
  if (limitReached(used, settings.dailyLimit)) {
    return ok({
      conversationId: await ownedConversationId(user.id, raw),
      messages: [transient(CRIS_DAILY_LIMIT_TEXT, now)], left: 0, mood: "sad", status: STATUS_READY,
    });
  }

  const rate = await checkRate(user.id, "cris");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec, CRIS_RATE_TEXT);

  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const input = parsed.data;

  // The page person is THIS message's page only — never an earlier message's (Review Focus #1).
  const page = { path: input.page.path, ...pageEntity(input.page.path) };

  let words = input.text ?? "";
  let pickAdd: { person?: string; asset?: string } = {};
  const scannedAssetIds: string[] = [];
  if (input.pick) {
    const pw = await pickWords(user, input.pick);
    if (!pw) return forbidden();
    words = pw.text;
    pickAdd = pw.add;
    if (input.pick.kind === "asset" && input.pick.scanned) scannedAssetIds.push(input.pick.assetId);
  }

  const conversationId = await openConversation(user.id, input.conversationId);
  const userMsg = userTurn({ firstName: firstNameOf(user.name), todayManila: manilaToday(now), page }, words);

  // One turn at a time per conversation (a second tab): two turns' rounds interleaved would garble the history both
  // are replayed from. The conversation row is locked, and the history read, the in-flight check and the person's
  // message written under that lock, so two sends can't both pass.
  const begun = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CrisConversation" WHERE "id" = ${conversationId} FOR UPDATE`;
    const rows = await tx.crisMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { role: true, content: true, createdAt: true },
    });
    if (turnInFlight([...rows].reverse(), now, CRIS_TURN_GUARD_MS)) return null;
    const conv = await tx.crisConversation.findUniqueOrThrow({ where: { id: conversationId }, select: { picks: true } });
    const picksBefore = parsePicks(conv.picks);
    // a structured pick is the person's own choice: noted before the model runs
    const picks = input.pick ? notePick(picksBefore, pickAdd) : picksBefore;
    const userRow = await appendCrisMessage(tx, conversationId, "user", storedContent({ text: words, cards: [], api: [userMsg] }));
    await tx.crisConversation.update({ where: { id: conversationId }, data: { picks } });
    return { rows, userRow, picksBefore, picks };
  });
  if (!begun) return conflict(CRIS_BUSY_TEXT);
  const { rows, userRow, picksBefore } = begun;
  let picks = begun.picks;
  const turnRows = [userRow.id];

  // The spares card open in the box is the server's own: the last Cris message's, never the browser's say-so.
  const lastCris = [...rows].reverse().find((r) => r.role === "cris");
  const openSpareTags = spareTagsOf(lastCris?.content);

  const model = pickModel(settings);
  // Priced at the model that served the reply (a server-side fallback may differ); the fake stores no usage.
  const usageOf = (r: CrisReply) => (model.id === "fake" ? undefined : { ...r.usage, model: isPricedModel(r.model) ? r.model : model.id });
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

  /**
   * Review Focus #4: take the whole turn back out — the question is not counted — and say so, Frustrated. When the
   * API refused the request itself (400), the conversation's history is what it will no longer take, so the person
   * is moved to a fresh conversation (unless this one had no history to blame).
   */
  const takeBack = async (f: Failure): Promise<ActionResult<CrisSendData>> => {
    await prisma.$transaction([
      prisma.crisMessage.deleteMany({ where: { id: { in: turnRows } } }),
      prisma.crisConversation.update({ where: { id: conversationId }, data: { picks: picksBefore } }),
    ]);
    const left = dailyLeft(used, settings.dailyLimit);
    if (f.fresh && rows.length > 0) {
      const fresh = await prisma.crisConversation.create({ data: { userId: user.id }, select: { id: true } });
      return ok({ conversationId: fresh.id, messages: [transient(CRIS_FRESH_TEXT, now)], left, mood: "cross", status: STATUS_READY });
    }
    return ok({ conversationId, messages: [transient(f.text, now)], left, mood: "cross", status: STATUS_READY });
  };

  let finalRow: CrisMessageRow | null = null;
  let failed: Failure | null = null;
  try {
    for (let round = 0; round < CRIS_MAX_ROUNDS; round++) {
      const reply = await model.reply({ system: CRIS_SYSTEM, messages, tools: CRIS_TOOLS });
      if (reply.stop === "refusal") { failed = { text: CRIS_REFUSED_TEXT }; break; }
      // Cut off: half an answer is never shown or kept as one, and half a tool call can't be run.
      if (reply.stop === "max_tokens") { failed = { text: CRIS_TOO_LONG_TEXT }; break; }
      const uses = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const assistant: Anthropic.MessageParam = { role: "assistant", content: reply.content };

      if (uses.length === 0) {
        const text = reply.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n\n").trim();
        const shown = text || (cards.length > 0 ? null : CRIS_EMPTY_TEXT);
        // An empty reply sends nothing back: no assistant message is invented for the history.
        const api = reply.content.length > 0 ? [assistant] : [];
        finalRow = await append("cris", storedContent({ text: shown, cards, api }), usageOf(reply));
        break;
      }
      // Tool calls with any other stop reason can't be trusted to be whole: treat as a failed reply.
      if (reply.stop !== "tool_use") { failed = { text: CRIS_BRAIN_TEXT }; break; }

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
      const toolRow = await append("tool", { api: JSON.stringify([assistant, resultsMsg]) }, usageOf(reply));
      turnRows.push(toolRow.id);
      messages.push(assistant, resultsMsg);
    }
    if (!failed) finalRow ??= await append("cris", storedContent({ text: CRIS_ROUNDS_TEXT, cards, api: [] }));
  } catch (err) {
    if (!(err instanceof CrisProviderError)) {
      // A bug or a database error: leave no half turn behind (its rounds would be replayed), then let it surface.
      await takeBack({ text: CRIS_BRAIN_TEXT });
      throw err;
    }
    failed = err.kind === "bad-request" ? { text: CRIS_BRAIN_TEXT, fresh: true } : { text: CRIS_BRAIN_TEXT };
  }
  if (failed || !finalRow) return takeBack(failed ?? { text: CRIS_BRAIN_TEXT });

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
  const off = offRefusal(await crisSettings());
  if (off) return off;
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
  const off = offRefusal(await crisSettings());
  if (off) return off;
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const created = await prisma.crisConversation.create({ data: { userId: user.id }, select: { id: true } });
  return ok({ conversationId: created.id });
}
