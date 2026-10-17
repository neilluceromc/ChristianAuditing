import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { User } from "@prisma/client";
import { notePick, type Picks } from "@/lib/cris-picks";
import { CRIS_BRAIN_TEXT, CRIS_REFUSED_TEXT, personTextOf } from "@/lib/cris-prompt";
import { CRIS_DAILY_LIMIT_TEXT } from "@/lib/cris-limits";
import type { CrisCard } from "@/lib/cris-cards";

/*
 * The turn against an in-memory Prisma. Message content goes through a jsonb-like round trip (object keys
 * re-ordered) as Postgres would store it, so the history replay is tested against what really comes back.
 * The model, the tools, the settings and the rate limit are stubbed; tools.test.ts and the fake's tests cover those.
 */

type Row = {
  id: string; conversationId: string; role: string; content: unknown;
  inputTokens: number | null; outputTokens: number | null; model: string | null; createdAt: Date;
};
type Conv = { id: string; userId: string; picks: unknown; updatedAt: Date };
type Reply = { content: Anthropic.ContentBlock[]; stop: string; model: string; usage: { input: number; output: number } };
type ToolCall = { ctx: Record<string, unknown>; name: string; input: unknown };

const h = vi.hoisted(() => ({
  convs: [] as Conv[],
  rows: [] as Row[],
  assets: [] as Array<{ id: string; tag: string; cls: string }>,
  people: [] as Array<{ id: string; name: string; employeeNo: string; department: { name: string } }>,
  clock: 0,
  seq: 0,
  settings: { on: true, dailyLimit: 100, model: "claude-haiku-5-5" },
  rate: { allowed: true } as { allowed: true } | { allowed: false; retryAfterSec: number },
  rateCalls: [] as string[],
  replies: [] as Array<Reply | Error | ((req: { messages: unknown[] }) => Reply)>,
  requests: [] as Array<{ system: string; messages: Anthropic.MessageParam[]; picksAtCall: unknown }>,
  toolCalls: [] as ToolCall[],
  tool: null as null | ((ctx: { picks: Picks }, name: string, input: unknown) => { result: unknown; cards: CrisCard[]; picks: Picks; mood: string }),
  modelId: "fake",
  locks: [] as unknown[][],
}));

/** jsonb: keys re-ordered shorter-first; strings kept byte for byte. */
function jsonb(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonb);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1))
      .map(([k, x]) => [k, jsonb(x)]));
  }
  return v;
}

function whereRow(r: Row, w: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(w)) {
    if (k === "conversation") {
      const conv = h.convs.find((c) => c.id === r.conversationId);
      if (!conv || conv.userId !== (v as { userId: string }).userId) return false;
    } else if (k === "OR") {
      if (!(v as Record<string, unknown>[]).some((o) => whereRow(r, o))) return false;
    } else if (k === "createdAt") {
      const op = v as { gte?: Date; lt?: Date } | Date;
      if (op instanceof Date) { if (r.createdAt.getTime() !== op.getTime()) return false; }
      else if (op.gte && r.createdAt < op.gte) return false;
      else if (op.lt && !(r.createdAt < op.lt)) return false;
    } else if (k === "id" && typeof v === "object" && v !== null) {
      const op = v as { in?: string[]; lt?: string };
      if (op.in && !op.in.includes(r.id)) return false;
      if (op.lt && !(r.id < op.lt)) return false;
    } else if (k === "role" && typeof v === "object" && v !== null) {
      if (!(v as { in: string[] }).in.includes(r.role)) return false;
    } else if ((r as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

const sorted = (rows: Row[], desc: boolean) =>
  [...rows].sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) * (desc ? -1 : 1));

vi.mock("@/server/db/client", () => {
  const nextId = (p: string) => `${p}${String(++h.seq).padStart(4, "0")}`;
  const db = {
    crisConversation: {
      findFirst: async ({ where }: { where: { id?: string; userId: string } }) => {
        const mine = h.convs.filter((c) => c.userId === where.userId && (where.id === undefined || c.id === where.id));
        mine.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        return mine[0] ? { id: mine[0].id, picks: mine[0].picks } : null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const c = h.convs.find((x) => x.id === where.id);
        if (!c) throw new Error("no conversation");
        return { picks: c.picks };
      },
      create: async ({ data }: { data: { userId: string; picks?: unknown } }) => {
        const c = { id: nextId("conv"), userId: data.userId, picks: jsonb(data.picks ?? {}), updatedAt: new Date(++h.clock) };
        h.convs.push(c);
        return { id: c.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: { picks?: unknown; updatedAt?: Date } }) => {
        const c = h.convs.find((x) => x.id === where.id);
        if (!c) throw new Error("no conversation");
        if (data.picks !== undefined) c.picks = jsonb(data.picks);
        if (data.updatedAt) c.updatedAt = data.updatedAt;
        return c;
      },
    },
    crisMessage: {
      count: async ({ where }: { where: Record<string, unknown> }) => h.rows.filter((r) => whereRow(r, where)).length,
      findMany: async ({ where, orderBy, take }: { where: Record<string, unknown>; orderBy: Array<{ createdAt: string }>; take?: number }) => {
        const rows = sorted(h.rows.filter((r) => whereRow(r, where)), orderBy[0].createdAt === "desc");
        return rows.slice(0, take ?? rows.length);
      },
      findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Array<{ createdAt: string }> }) =>
        sorted(h.rows.filter((r) => whereRow(r, where)), orderBy?.[0]?.createdAt === "desc")[0] ?? null,
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
        const row: Row = {
          id: nextId("msg"), conversationId: data.conversationId, role: data.role, content: jsonb(data.content),
          inputTokens: data.inputTokens ?? null, outputTokens: data.outputTokens ?? null, model: data.model ?? null,
          createdAt: new Date(++h.clock),
        };
        h.rows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = h.rows.length;
        h.rows = h.rows.filter((r) => !whereRow(r, where));
        return { count: before - h.rows.length };
      },
    },
    asset: {
      findFirst: async ({ where }: { where: { AND: [{ id: string }, { cls?: { in: string[] } }] } }) => {
        const [{ id }, vis] = where.AND;
        const a = h.assets.find((x) => x.id === id && (!vis.cls || vis.cls.in.includes(x.cls)));
        return a ? { id: a.id, tag: a.tag } : null;
      },
    },
    employee: {
      findUnique: async ({ where }: { where: { id: string } }) => h.people.find((p) => p.id === where.id) ?? null,
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      h.locks.push([strings.join("?"), ...values]);
      return [];
    },
    $transaction: async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])),
  };
  return { prisma: db };
});

vi.mock("./settings-read", () => ({ crisSettings: async () => h.settings }));
vi.mock("@/server/rate-limit", () => ({
  checkRate: async (_userId: string, kind = "mutation") => { h.rateCalls.push(kind); return h.rate; },
}));
vi.mock("./tools", () => ({
  CRIS_TOOLS: [],
  runTool: async (ctx: { picks: Picks }, name: string, input: unknown) => {
    h.toolCalls.push({ ctx: ctx as unknown as Record<string, unknown>, name, input });
    return h.tool!(ctx, name, input);
  },
}));
vi.mock("./model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./model")>();
  return {
    ...actual,
    pickModel: () => ({
      id: h.modelId,
      async reply(req: { system: string; messages: Anthropic.MessageParam[] }) {
        const conv = h.convs[h.convs.length - 1];
        h.requests.push({ system: req.system, messages: JSON.parse(JSON.stringify(req.messages)), picksAtCall: conv?.picks });
        const next = h.replies.shift();
        if (!next) throw new Error("test: no reply queued");
        if (next instanceof Error) throw next;
        return typeof next === "function" ? next(req) : next;
      },
    }),
  };
});

const {
  crisTurn, crisHistoryFor, crisNewChatFor, CRIS_ROUNDS_TEXT, CRIS_OFF_NO_KEY, CRIS_RATE_TEXT, CRIS_MAX_ROUNDS, CRIS_BUSY_TEXT,
  CRIS_TOO_LONG_TEXT, CRIS_FRESH_TEXT, CRIS_MAX_TURNS,
} = await import("./turn-core");
const { CrisProviderError } = await import("./model");

const user = { id: "u1", name: "Neil Lucero", role: "it_staff" } as User;
const NOW = new Date("2026-10-17T04:00:00Z"); // midday in Manila

const text = (t: string): Reply => ({ content: [{ type: "text", text: t, citations: null }], stop: "end_turn", model: "claude-haiku-5-5", usage: { input: 10, output: 5 } });
const call = (id: string, name: string, input: Record<string, unknown>): Reply => ({
  content: [
    { type: "thinking", thinking: "", signature: `sig-${id}` },
    { type: "tool_use", id, name, input, caller: { type: "direct" } },
  ],
  stop: "tool_use",
  model: "claude-haiku-5-5",
  usage: { input: 20, output: 8 },
});
const send = (over: Record<string, unknown> = {}) => crisTurn(user, { text: "Check Ana Reyes's items", page: { path: "/inventory" }, ...over }, NOW);

function seedUserRows(n: number, at: Date) {
  const conv = { id: "conv-old", userId: user.id, picks: {}, updatedAt: at };
  h.convs.push(conv);
  for (let i = 0; i < n; i++) {
    h.rows.push({ id: `old${i}`, conversationId: conv.id, role: "user", content: { text: "q" }, inputTokens: null, outputTokens: null, model: null, createdAt: at });
  }
}

beforeEach(() => {
  vi.stubEnv("CRIS_MODEL", "fake");
  vi.stubEnv("NODE_ENV", "test");
  Object.assign(h, {
    convs: [], rows: [], assets: [], people: [], clock: NOW.getTime() - 1_000_000, seq: 0,
    settings: { on: true, dailyLimit: 100, model: "claude-haiku-5-5" }, rate: { allowed: true }, rateCalls: [],
    replies: [], requests: [], toolCalls: [], modelId: "fake", locks: [],
    tool: (ctx: { picks: Picks }) => ({ result: { ok: true }, cards: [], picks: notePick(ctx.picks, { person: "e9" }), mood: "search" }),
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("the daily limit (Review Focus #5) — checked before any model call", () => {
  it("refuses the 101st question with the spec's copy, Sad, and saves nothing", async () => {
    seedUserRows(100, new Date(NOW.getTime() - 60_000));
    const before = h.rows.length;
    const r = await send();
    expect(r.ok && r.data).toMatchObject({ left: 0, mood: "sad" });
    expect(r.ok && r.data.messages.map((m) => m.text)).toEqual([CRIS_DAILY_LIMIT_TEXT]);
    expect(h.rows.length).toBe(before);
    expect(h.requests).toHaveLength(0);
    expect(h.rateCalls).toHaveLength(0); // the limit comes before the rate check
    expect(r.ok && r.data.conversationId).toBeNull(); // none sent: null, never ""
  });

  it("returns the sent conversation only when it is the person's own", async () => {
    seedUserRows(100, new Date(NOW.getTime() - 60_000));
    h.convs.push({ id: "theirs", userId: "u2", picks: {}, updatedAt: new Date(0) });
    const mine = await send({ conversationId: "conv-old" });
    expect(mine.ok && mine.data.conversationId).toBe("conv-old");
    const other = await send({ conversationId: "theirs" });
    expect(other.ok && other.data.conversationId).toBeNull();
  });

  it("answers the 100th question", async () => {
    seedUserRows(99, new Date(NOW.getTime() - 60_000));
    h.replies.push(text("Ana Reyes has 2 items."));
    const r = await send();
    expect(r.ok && r.data.left).toBe(0);
    expect(r.ok && r.data.messages.map((m) => m.text)).toEqual(["Check Ana Reyes's items", "Ana Reyes has 2 items."]);
  });

  it("counts from Manila midnight: yesterday evening's (Manila) questions don't count", async () => {
    // 15:59 UTC on the 16th is 23:59 in Manila — the day before NOW's Manila day.
    seedUserRows(100, new Date("2026-10-16T15:59:00Z"));
    h.replies.push(text("ok"));
    const r = await send();
    expect(r.ok && r.data.left).toBe(99);
  });
});

describe("a provider failure or a refusal (Review Focus #4)", () => {
  it("takes the question back out (not counted) and says so, Frustrated", async () => {
    h.replies.push(new CrisProviderError("connection"));
    const r = await send();
    expect(r.ok && r.data).toMatchObject({ mood: "cross", left: 100 });
    expect(r.ok && r.data.messages.map((m) => m.text)).toEqual([CRIS_BRAIN_TEXT]);
    expect(h.rows).toHaveLength(0);
  });

  it("takes out every round of the turn when the provider fails part-way", async () => {
    h.replies.push(call("t1", "find_people", { q: "Ana Reyes" }), new CrisProviderError("timeout"));
    const r = await send();
    expect(r.ok && r.data.messages[0].text).toBe(CRIS_BRAIN_TEXT);
    expect(h.rows).toHaveLength(0);
    // and the picks the turn made are put back
    expect(h.convs[0].picks).toEqual({ people: [], assets: [] });
  });

  it("says the refusal copy for a refusal stop reason", async () => {
    h.replies.push({ content: [], stop: "refusal", model: "claude-haiku-5-5", usage: { input: 5, output: 0 } });
    const r = await send();
    expect(r.ok && r.data).toMatchObject({ mood: "cross", left: 100 });
    expect(r.ok && r.data.messages[0].text).toBe(CRIS_REFUSED_TEXT);
    expect(h.rows).toHaveLength(0);
  });

  it("treats tool calls cut off by max_tokens as a failed reply", async () => {
    h.replies.push({ ...call("t1", "find_people", { q: "Ana" }), stop: "max_tokens" });
    const r = await send();
    expect(r.ok && r.data.messages[0].text).toBe(CRIS_TOO_LONG_TEXT);
    expect(h.rows).toHaveLength(0);
  });

  it("never keeps a reply cut off by max_tokens as an answer (text or thinking only)", async () => {
    h.replies.push({ ...text("Ana Reyes has 2 items: BR-LT-01"), stop: "max_tokens" });
    const r = await send();
    expect(r.ok && r.data).toMatchObject({ mood: "cross", left: 100 });
    expect(r.ok && r.data.messages.map((m) => m.text)).toEqual([CRIS_TOO_LONG_TEXT]);
    expect(h.rows).toHaveLength(0);
    h.replies.push({ content: [{ type: "thinking", thinking: "", signature: "s" }], stop: "max_tokens", model: "claude-haiku-5-5", usage: { input: 1, output: 2000 } });
    const r2 = await send();
    expect(r2.ok && r2.data.messages[0].text).toBe(CRIS_TOO_LONG_TEXT);
    expect(h.rows).toHaveLength(0);
  });

  it("takes the turn out and lets a non-provider error surface", async () => {
    h.replies.push(new Error("db down"));
    await expect(send()).rejects.toThrow("db down");
    expect(h.rows).toHaveLength(0);
  });
});

describe("a history the API rejects (400) never bricks the chat", () => {
  let warned: string[] = [];
  beforeEach(() => {
    warned = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warned.push(args.join(" ")); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("retries once without the history; accepted, it moves the person to a fresh conversation and leaves the old one as it was", async () => {
    h.replies.push(text("first answer"));
    const first = await send();
    const oldId = first.ok ? first.data.conversationId : "";
    const oldRows = h.rows.map((r) => r.id);
    h.replies.push(new CrisProviderError("bad-request", 400, "invalid_request_error"), text("the retry's answer"));
    const r = await send({ conversationId: oldId, text: "and now?" });
    // the retry sent this message alone: no history
    expect(h.requests.at(-2)!.messages.length).toBeGreaterThan(1);
    expect(h.requests.at(-1)!.messages).toHaveLength(1);
    expect(personTextOf(h.requests.at(-1)!.messages[0])).toBe("and now?");
    expect(r.ok && r.data).toMatchObject({ mood: "cross", left: 99 });
    expect(r.ok && r.data.messages.map((m) => m.text)).toEqual([CRIS_FRESH_TEXT]);
    const freshId = r.ok ? r.data.conversationId : null;
    expect(freshId).not.toBe(oldId);
    expect(h.convs.find((c) => c.id === freshId)?.userId).toBe(user.id);
    expect(h.rows.map((x) => x.id)).toEqual(oldRows); // the failed question is not counted or kept
    // the next message in the fresh conversation starts a clean history
    h.replies.push(text("ok"));
    await send({ conversationId: freshId, text: "Check Ana Reyes's items" });
    expect(h.requests.at(-1)!.messages).toHaveLength(1);
  });

  it("I1: a 400 again without the history is not the history — the person keeps the conversation, the turn is not counted", async () => {
    h.replies.push(text("first answer"));
    const first = await send();
    const oldId = first.ok ? first.data.conversationId : "";
    const oldRows = h.rows.map((r) => r.id);
    // e.g. the owner's credit or spend limit is used up: every request is a 400, history or not
    h.replies.push(new CrisProviderError("bad-request", 400, "invalid_request_error"), new CrisProviderError("bad-request", 400, "invalid_request_error"));
    const r = await send({ conversationId: oldId, text: "and now?" });
    expect(r).toEqual({
      ok: true,
      data: expect.objectContaining({ conversationId: oldId, mood: "cross", left: 99, status: "Ready" }),
    });
    expect(r.ok && r.data.messages.map((m) => m.text)).toEqual([CRIS_BRAIN_TEXT]);
    expect(h.convs).toHaveLength(1); // no fresh conversation
    expect(h.rows.map((x) => x.id)).toEqual(oldRows); // the failed turn is deleted
    expect(h.requests).toHaveLength(3); // the first answer, the turn, one retry — never more
    expect(h.requests.at(-1)!.messages).toHaveLength(1);
    // logged: the status and the API's error type
    expect(warned.join("\n")).toContain("400 invalid_request_error");
    // and the next message still replays the old history
    h.replies.push(text("back"));
    await send({ conversationId: oldId, text: "and now?" });
    expect(h.requests.at(-1)!.messages.length).toBeGreaterThan(1);
  });

  it("I1: the retry failing some other way also keeps the conversation", async () => {
    h.replies.push(text("first answer"));
    const first = await send();
    const oldId = first.ok ? first.data.conversationId : "";
    h.replies.push(new CrisProviderError("bad-request", 400), new CrisProviderError("timeout"));
    const r = await send({ conversationId: oldId, text: "and now?" });
    expect(r.ok && r.data).toMatchObject({ conversationId: oldId, mood: "cross" });
    expect(r.ok && r.data.messages[0].text).toBe(CRIS_BRAIN_TEXT);
  });

  it("stays put with the brain copy when the conversation had no history to blame, with no retry", async () => {
    h.replies.push(new CrisProviderError("bad-request", 400));
    const r = await send();
    expect(r.ok && r.data.messages[0].text).toBe(CRIS_BRAIN_TEXT);
    expect(h.convs).toHaveLength(1);
    expect(h.requests).toHaveLength(1);
  });
});

describe("the turn", () => {
  it("is refused when Cris is off, with the spec's no-key copy", async () => {
    vi.stubEnv("CRIS_MODEL", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const r = await send();
    expect(r).toMatchObject({ ok: false, kind: "conflict", message: CRIS_OFF_NO_KEY });
  });

  it("is rate limited after the daily limit and before zod", async () => {
    h.rate = { allowed: false, retryAfterSec: 12 };
    const r = await crisTurn(user, { garbage: true }, NOW);
    expect(r).toMatchObject({ ok: false, kind: "rate_limited", message: CRIS_RATE_TEXT, retryAfterSec: 12 });
    expect(h.rateCalls).toEqual(["cris"]);
  });

  it("validates: a message or a pick, not both", async () => {
    const r = await send({ pick: { kind: "person", employeeId: "e1" } });
    expect(r).toMatchObject({ ok: false, kind: "validation" });
  });

  it("loops the tools, saves each round with its usage, and returns the person's message and Cris's reply with the cards", async () => {
    h.modelId = "claude-haiku-5-5";
    const card: CrisCard = { type: "which", choices: [] };
    h.tool = (ctx) => ({ result: { people: [] }, cards: [card], picks: notePick(ctx.picks, { person: "e-ana" }), mood: "look" });
    h.replies.push(call("t1", "find_people", { q: "Ana" }), text("Which one?"));
    const r = await send({ text: "Check Ana's items" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.messages.map((m) => [m.role, m.text])).toEqual([["user", "Check Ana's items"], ["cris", "Which one?"]]);
    expect(r.data.messages[1].cards).toEqual([card]);
    expect(r.data).toMatchObject({ mood: "look", status: "Ready", left: 99 });
    expect(h.rows.map((x) => x.role)).toEqual(["user", "tool", "cris"]);
    expect(h.rows.map((x) => [x.inputTokens, x.model])).toEqual([[null, null], [20, "claude-haiku-5-5"], [10, "claude-haiku-5-5"]]);
    // the picks a tool returned were saved before the next round asked the model
    expect(h.requests[1].picksAtCall).toEqual({ people: ["e-ana"], assets: [] });
    // the tool result went back as a JSON string, in one user message
    const results = h.requests[1].messages.at(-1)!;
    expect(results).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ people: [] }) }] });
  });

  it("marks a tool's refusal as an error result", async () => {
    h.tool = (ctx) => ({ result: { error: "ask the person to pick or scan" }, cards: [], picks: ctx.picks, mood: "look" });
    h.replies.push(call("t1", "propose_assign", { employeeId: "e1", assetId: "a1" }), text("Pick one first."));
    await send();
    const results = h.requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(results[0].is_error).toBe(true);
  });

  it("says Waiting for your Confirm when a Confirm card is shown", async () => {
    const confirm = { type: "confirm", pendingId: "p1", kind: "assign", person: { id: "e1", name: "A", employeeNo: "1", worksFor: "X", initials: "A" },
      gets: { assetId: "a1", tag: "BR-LT-0230", model: "M", typeName: null, warrantyEnd: null, backOn: null, serial: null, scanned: false } } as CrisCard;
    h.tool = (ctx) => ({ result: { shown: "card" }, cards: [confirm], picks: ctx.picks, mood: "look" });
    h.replies.push(call("t1", "propose_assign", {}), text("Check the card."));
    const r = await send();
    expect(r.ok && r.data).toMatchObject({ status: "Waiting for your Confirm", mood: "look" });
  });

  it("stops after 6 rounds", async () => {
    for (let i = 0; i < CRIS_MAX_ROUNDS + 2; i++) h.replies.push(call(`t${i}`, "find_people", { q: "x" }));
    const r = await send();
    expect(h.requests).toHaveLength(CRIS_MAX_ROUNDS);
    expect(r.ok && r.data.messages.at(-1)?.text).toBe(CRIS_ROUNDS_TEXT);
  });

  it("stores no token usage for the fake model", async () => {
    h.replies.push(text("ok"));
    await send();
    expect(h.rows.every((x) => x.inputTokens === null && x.model === null)).toBe(true);
  });

  it("prices each reply at the model that served it (a server-side fallback), or the asked model when unknown", async () => {
    h.modelId = "claude-sonnet-5-5";
    h.replies.push({ ...call("t1", "find_people", { q: "x" }), model: "claude-sonnet-5" }, { ...text("ok"), model: "some-new-model" });
    await send();
    expect(h.rows.filter((x) => x.role !== "user").map((x) => x.model)).toEqual(["claude-sonnet-5", "claude-sonnet-5-5"]);
  });
});

describe("Cris off: history and new chat refuse too", () => {
  it("refuses both with the off copy", async () => {
    vi.stubEnv("CRIS_MODEL", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await crisNewChatFor(user)).toMatchObject({ ok: false, kind: "conflict", message: CRIS_OFF_NO_KEY });
    expect(await crisHistoryFor(user, { conversationId: "c1" })).toMatchObject({ ok: false, kind: "conflict", message: CRIS_OFF_NO_KEY });
    expect(h.convs).toHaveLength(0);
  });
});

describe("rolling over a full conversation", () => {
  const spares: CrisCard = { type: "spares", employeeId: "e1", offset: 0, more: false, options: [
    { assetId: "a230", tag: "BR-LT-0230", model: "M", typeName: "Laptop", warrantyEnd: null, backOn: null },
  ] };

  function fullConversation(lastCards: CrisCard[]) {
    h.convs.push({ id: "full", userId: user.id, picks: { people: ["e1"], assets: [] }, updatedAt: new Date(NOW.getTime() - 60_000) });
    const at = new Date("2026-10-15T00:00:00Z"); // an earlier day: not counted today
    for (let i = 0; i < CRIS_MAX_TURNS; i++) {
      h.rows.push({ id: `u${String(i).padStart(3, "0")}`, conversationId: "full", role: "user", content: { text: "q", api: "[]" }, inputTokens: null, outputTokens: null, model: null, createdAt: new Date(at.getTime() + i * 2) });
      h.rows.push({ id: `c${String(i).padStart(3, "0")}`, conversationId: "full", role: "cris", content: { text: "a", cards: i === CRIS_MAX_TURNS - 1 ? lastCards : [], api: "[]" }, inputTokens: null, outputTokens: null, model: null, createdAt: new Date(at.getTime() + i * 2 + 1) });
    }
  }

  it("moves on after CRIS_MAX_TURNS questions, carrying the picks and the open spares card, so the pick still works", async () => {
    fullConversation([spares]);
    h.assets.push({ id: "a230", tag: "BR-LT-0230", cls: "IT" });
    h.tool = (ctx) => ({ result: { shown: "card" }, cards: [], picks: ctx.picks, mood: "look" });
    h.replies.push(call("t1", "propose_assign", { employeeId: "e1", assetId: "a230" }), text("Check the card."));
    const r = await crisTurn(user, { conversationId: "full", pick: { kind: "asset", assetId: "a230", scanned: false }, page: { path: "/" } }, NOW);
    const freshId = r.ok ? r.data.conversationId : null;
    expect(freshId).not.toBe("full");
    // the person's picks came along, plus this pick
    expect(h.toolCalls[0].ctx.picks).toEqual({ people: ["e1"], assets: ["a230"] });
    // the open card came along as the new conversation's first Cris message: it is the open spares card
    expect(h.toolCalls[0].ctx.openSpareTags).toEqual(["BR-LT-0230"]);
    const carried = h.rows.filter((x) => x.conversationId === freshId);
    expect(carried[0].role).toBe("cris");
    expect((carried[0].content as { cards: CrisCard[] }).cards).toEqual([spares]);
    // and the model reads it as a box note naming the ids, before the person's pick
    const sent = h.requests[0].messages;
    expect(sent).toHaveLength(2);
    expect(String(sent[0].content)).toContain("Spares listed for person id e1: BR-LT-0230 (asset id a230).");
    expect(personTextOf(sent[1])).toBe("I picked BR-LT-0230.");
    // the full conversation is left as it was
    expect(h.rows.filter((x) => x.conversationId === "full")).toHaveLength(CRIS_MAX_TURNS * 2);
  });

  it("carries the picks but no card when nothing was waiting", async () => {
    fullConversation([]);
    h.replies.push(text("ok"));
    const r = await send({ conversationId: "full" });
    const freshId = r.ok ? r.data.conversationId : null;
    expect(freshId).not.toBe("full");
    expect(h.convs.find((c) => c.id === freshId)?.picks).toEqual({ people: ["e1"], assets: [] });
    expect(h.rows.filter((x) => x.conversationId === freshId).map((x) => x.role)).toEqual(["user", "cris"]);
  });
});

describe("the page person is this message's page only (Review Focus #1)", () => {
  it("passes the current page's person, and none once the person has moved on", async () => {
    h.replies.push(call("t1", "get_holdings", { employeeId: "e1" }), text("ok"));
    const first = await send({ page: { path: "/employees/e1/timeline" } });
    const conversationId = first.ok ? first.data.conversationId : "";
    h.replies.push(call("t2", "get_holdings", { employeeId: "e1" }), text("ok"));
    await send({ conversationId, page: { path: "/inventory" } });
    expect(h.toolCalls.map((c) => c.ctx.pageEmployeeId)).toEqual(["e1", null]);
  });

  it("tells the model the page in this message's context block", async () => {
    h.replies.push(text("ok"));
    await send({ page: { path: "/employees/e1" } });
    const sent = h.requests[0].messages.at(-1)!;
    expect(JSON.stringify(sent)).toContain("Page person: e1");
    expect(personTextOf(sent)).toBe("Check Ana Reyes's items");
  });
});

describe("picks and the open spares card", () => {
  it("notes a scanned asset pick first, marks it scanned, and sends it as short words", async () => {
    h.assets.push({ id: "a230", tag: "BR-LT-0230", cls: "IT" });
    h.replies.push(call("t1", "propose_assign", { employeeId: "e1", assetId: "a230" }), text("Check the card."));
    h.tool = (ctx) => ({ result: { shown: "card" }, cards: [], picks: ctx.picks, mood: "look" });
    const r = await crisTurn(user, { pick: { kind: "asset", assetId: "a230", scanned: true }, page: { path: "/inventory" } }, NOW);
    expect(r.ok && r.data.messages[0].text).toBe("I picked BR-LT-0230 (scanned).");
    expect(personTextOf(h.requests[0].messages.at(-1)!)).toBe("I picked BR-LT-0230 (scanned).");
    const ctx = h.toolCalls[0].ctx;
    expect((ctx.picks as Picks).assets).toContain("a230");
    expect(ctx.scannedAssetIds).toEqual(["a230"]);
    expect(ctx.userText).toBe("");
    expect(h.requests[0].picksAtCall).toEqual({ people: [], assets: ["a230"] });
  });

  it("names a picked person from their row", async () => {
    h.people.push({ id: "e1", name: "Ana Reyes", employeeNo: "EMP-0101", department: { name: "Acme" } });
    h.replies.push(text("ok"));
    const r = await crisTurn(user, { pick: { kind: "person", employeeId: "e1" }, page: { path: "/" } }, NOW);
    expect(r.ok && r.data.messages[0].text).toBe("I picked Ana Reyes (EMP-0101).");
  });

  it("refuses a pick of an asset the person can't see, saving nothing", async () => {
    h.assets.push({ id: "p1", tag: "BR-FN-0001", cls: "PURCHASING" });
    const r = await crisTurn(user, { pick: { kind: "asset", assetId: "p1", scanned: false }, page: { path: "/" } }, NOW);
    expect(r).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.rows).toHaveLength(0);
  });

  it("reads the open spares card from the server's last Cris message, not the browser", async () => {
    const spares: CrisCard = { type: "spares", employeeId: "e1", offset: 0, more: false, options: [
      { assetId: "a1", tag: "BR-LT-0230", model: "M", typeName: "Laptop", warrantyEnd: null, backOn: null },
    ] };
    h.replies.push(call("t1", "list_spares", { employeeId: "e1" }), text("Pick one."));
    h.tool = (ctx) => ({ result: { spares: [] }, cards: [spares], picks: ctx.picks, mood: "look" });
    const first = await send({ text: "Assign a laptop to Ana Reyes" });
    const conversationId = first.ok ? first.data.conversationId : "";
    h.replies.push(call("t2", "propose_assign", {}), text("ok"));
    await send({ conversationId, text: "0230" });
    expect(h.toolCalls[1].ctx.openSpareTags).toEqual(["BR-LT-0230"]);
  });

  it("refuses spares tags, scans or picks the browser tries to slip in beside the message", async () => {
    expect(await send({ openSpareTags: ["BR-LT-0230"] })).toMatchObject({ ok: false, kind: "validation" });
    expect(await send({ scannedAssetIds: ["a1"] })).toMatchObject({ ok: false, kind: "validation" });
    expect(h.rows).toHaveLength(0);
  });
});

describe("the history the model reads (append-only)", () => {
  it("replays the earlier turn exactly as it was sent, thinking blocks included", async () => {
    h.replies.push(call("t1", "find_people", { q: "Ana Reyes", extra: "z", a: 1 }), text("Ana Reyes has 2 items."));
    const first = await send();
    const conversationId = first.ok ? first.data.conversationId : "";
    const sentInTurn1 = h.requests[1].messages; // round 2 of turn 1: everything turn 1 had sent
    h.replies.push(text("ok"));
    await send({ conversationId, text: "thanks", page: { path: "/employees/e5" } });
    const turn2 = h.requests[2];
    const prefix = [...sentInTurn1, { role: "assistant", content: text("Ana Reyes has 2 items.").content }];
    expect(JSON.stringify(turn2.messages.slice(0, prefix.length))).toBe(JSON.stringify(prefix));
    expect(turn2.system).toBe(h.requests[0].system); // the system prompt never changes under a conversation
  });

  it("answers one turn at a time per conversation: a second tab waits while a turn is running", async () => {
    h.convs.push({ id: "c1", userId: user.id, picks: {}, updatedAt: new Date(0) });
    h.rows.push({ id: "m1", conversationId: "c1", role: "user", content: { text: "q", api: "[]" }, inputTokens: null, outputTokens: null, model: null, createdAt: new Date(NOW.getTime() - 5_000) });
    expect(await send({ conversationId: "c1" })).toMatchObject({ ok: false, kind: "conflict", message: CRIS_BUSY_TEXT });
    expect(h.requests).toHaveLength(0);
    expect(h.rows).toHaveLength(1); // nothing written
    // a crashed turn's rows stop blocking after a few minutes
    h.rows[0].createdAt = new Date(NOW.getTime() - 4 * 60_000);
    h.replies.push(text("ok"));
    expect((await send({ conversationId: "c1" })).ok).toBe(true);
  });

  it("is not fooled by a Confirm or Undo message written while a turn runs (box notes are skipped)", async () => {
    h.convs.push({ id: "c1", userId: user.id, picks: {}, updatedAt: new Date(0) });
    h.rows.push(
      { id: "m1", conversationId: "c1", role: "user", content: { text: "q", api: "[]" }, inputTokens: null, outputTokens: null, model: null, createdAt: new Date(NOW.getTime() - 5_000) },
      { id: "m2", conversationId: "c1", role: "cris", content: { text: "That's already done.", cards: [] }, inputTokens: null, outputTokens: null, model: null, createdAt: new Date(NOW.getTime() - 1_000) },
    );
    expect(await send({ conversationId: "c1" })).toMatchObject({ ok: false, kind: "conflict", message: CRIS_BUSY_TEXT });
  });

  it("locks the conversation row in the transaction that writes the person's message", async () => {
    h.replies.push(text("ok"));
    const r = await send();
    const convId = r.ok ? r.data.conversationId : "";
    expect(h.locks).toHaveLength(1);
    expect(h.locks[0][0]).toMatch(/FROM "CrisConversation" WHERE "id" = \? FOR UPDATE/);
    expect(h.locks[0][1]).toBe(convId);
  });

  it("never answers in someone else's conversation", async () => {
    h.convs.push({ id: "theirs", userId: "u2", picks: {}, updatedAt: new Date(0) });
    h.replies.push(text("ok"));
    const r = await send({ conversationId: "theirs" });
    expect(r.ok && r.data.conversationId).not.toBe("theirs");
    expect(h.rows.every((x) => x.conversationId !== "theirs")).toBe(true);
  });
});

describe("crisHistory", () => {
  it("pages 30 at a time, oldest first, tool rows left out, and is private to its person", async () => {
    h.convs.push({ id: "c1", userId: user.id, picks: {}, updatedAt: new Date(0) });
    for (let i = 0; i < 70; i++) {
      h.rows.push({ id: `m${String(i).padStart(3, "0")}`, conversationId: "c1", role: i % 2 ? "cris" : "user", content: { text: `#${i}`, cards: [] }, inputTokens: null, outputTokens: null, model: null, createdAt: new Date(1000 + i) });
      h.rows.push({ id: `t${String(i).padStart(3, "0")}`, conversationId: "c1", role: "tool", content: { api: "[]" }, inputTokens: null, outputTokens: null, model: null, createdAt: new Date(1000 + i) });
    }
    const page1 = await crisHistoryFor(user, { conversationId: "c1" });
    expect(page1.ok && page1.data.more).toBe(true);
    const texts1 = page1.ok ? page1.data.messages.map((m) => m.text) : [];
    expect(texts1[0]).toBe("#40");
    expect(texts1.at(-1)).toBe("#69");
    const page3 = await crisHistoryFor(user, { conversationId: "c1", before: "m010" });
    expect(page3.ok && page3.data.messages.map((m) => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `#${i}`));
    expect(page3.ok && page3.data.more).toBe(false);
    const other = await crisHistoryFor({ ...user, id: "u2" } as User, { conversationId: "c1" });
    expect(other).toMatchObject({ ok: false, kind: "forbidden" });
  });
});
