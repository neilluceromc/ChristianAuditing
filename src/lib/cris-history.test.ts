import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { decodeApi, encodeApi, modelHistory, openPickCard, spareTagsOf, storedContent, turnInFlight } from "./cris-history";
import { BOX_NOTE_PREFIX } from "./cris-prompt";

const user = (text: string): Anthropic.MessageParam => ({ role: "user", content: [{ type: "text", text }] });
const toolUse = (id: string, input: Record<string, unknown>): Anthropic.MessageParam => ({
  role: "assistant",
  content: [
    { type: "thinking", thinking: "", signature: "sig-" + id },
    { type: "tool_use", id, name: "propose_assign", input, caller: { type: "direct" } } as Anthropic.ToolUseBlockParam,
  ],
});
const results = (id: string): Anthropic.MessageParam => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "{}" }] });
const reply = (text: string): Anthropic.MessageParam => ({ role: "assistant", content: [{ type: "text", text }] });

const row = (role: string, api: Anthropic.MessageParam[] | null, extra: Record<string, unknown> = {}) => ({
  role, content: { text: null, cards: [], ...extra, ...(api ? { api: encodeApi(api) } : {}) },
});

/** Postgres jsonb re-orders object keys (shorter keys first); a string value inside it is kept byte for byte. */
function jsonbRoundTrip(value: unknown): unknown {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1));
      return Object.fromEntries(entries.map(([k, x]) => [k, sortKeys(x)]));
    }
    return v;
  };
  return sortKeys(JSON.parse(JSON.stringify(value)));
}

describe("the stored model history (append-only: every replay is byte-identical to what was sent)", () => {
  it("survives jsonb's key re-ordering, so a tool call's input reads back in the order the model wrote it", () => {
    const sent = [toolUse("t1", { employeeId: "e1", assetId: "a1" }), results("t1")];
    const back = decodeApi(jsonbRoundTrip(storedContent({ text: null, cards: [], api: sent })));
    expect(JSON.stringify(back)).toBe(JSON.stringify(sent));
    const input = (back?.[0].content as Anthropic.ToolUseBlockParam[])[1].input as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(["employeeId", "assetId"]);
  });

  it("replays the turns in order, thinking blocks untouched", () => {
    const rows = [
      row("user", [user("ctx + Check Ana's items")]),
      row("tool", [toolUse("t1", { q: "Ana" }), results("t1")]),
      row("cris", [reply("Ana Reyes has 2 items.")], { text: "Ana Reyes has 2 items." }),
    ];
    const h = modelHistory(rows);
    expect(h).toEqual([user("ctx + Check Ana's items"), toolUse("t1", { q: "Ana" }), results("t1"), reply("Ana Reyes has 2 items.")]);
  });

  it("sends nothing for a reply stored with an empty api (no assistant message is invented)", () => {
    expect(modelHistory([row("user", [user("hi")]), row("cris", [], { text: "Sorry, I didn't catch that." })])).toEqual([user("hi")]);
  });

  it("tells the model what Confirm and Undo posted, as a box note before the person's next message", () => {
    const rows = [
      row("user", [user("first")]),
      row("cris", [reply("Check the card.")]),
      row("cris", null, { text: null, cards: [{ type: "result", pendingId: "p", employeeId: "e", head: "Assigned.", text: "BR-LT-0230 is with Ana.", undoUntil: "x" }] }),
      row("user", [user("second")]),
    ];
    const h = modelHistory(rows);
    expect(h).toHaveLength(4);
    expect(h[2].role).toBe("user");
    expect(String(h[2].content).startsWith(BOX_NOTE_PREFIX)).toBe(true);
    expect(String(h[2].content)).toContain("Assigned. BR-LT-0230 is with Ana.");
    expect(h[3]).toEqual(user("second"));
  });

  it("never lets a box note land inside a turn: one posted mid-turn waits for the next person message", () => {
    // Confirm pressed in another tab while a turn was running: its note row sits between that turn's rows.
    const midTurn = [
      row("user", [user("turn 1")]),
      row("cris", null, { text: "That's already done." }),
      row("tool", [toolUse("t1", { q: "x" }), results("t1")]),
      row("cris", [reply("done")]),
    ];
    const atTurn2 = modelHistory(midTurn);
    // what turn 1 sent the model is untouched; the note follows the turn
    expect(atTurn2.slice(0, 4)).toEqual([user("turn 1"), toolUse("t1", { q: "x" }), results("t1"), reply("done")]);
    expect(String(atTurn2[4].content)).toContain("That's already done.");
    // and turn 3 replays turn 2's prefix exactly as turn 2 sent it
    const atTurn3 = modelHistory([...midTurn, row("user", [user("turn 2")]), row("cris", [reply("ok")])]);
    expect(atTurn3.slice(0, atTurn2.length)).toEqual(atTurn2);
    expect(atTurn3[atTurn2.length]).toEqual(user("turn 2"));
  });

  it("leaves out preview turns (person and Cris rows stored with an empty api): live turns either side stay whole", () => {
    const rows = [
      row("user", [user("live 1")]),
      row("cris", [reply("live answer")], { text: "live answer" }),
      row("user", [], { text: "Hello!" }),
      row("cris", [], { text: "Hello! I'm Cris — I'm still in development." }),
      row("user", [], { text: "What will you do?" }),
      row("cris", [], { text: "Soon I'll check someone's items…" }),
    ];
    expect(modelHistory(rows)).toEqual([user("live 1"), reply("live answer")]);
    expect(modelHistory(rows.slice(2))).toEqual([]);
  });

  it("skips a row whose stored api is not readable rather than sending garbage", () => {
    expect(modelHistory([{ role: "tool", content: { api: "{not json" } }, row("user", [user("hi")])])).toEqual([user("hi")]);
  });
});

describe("turnInFlight (one turn at a time per conversation)", () => {
  const now = new Date(1_000_000);
  const at = (msAgo: number) => new Date(now.getTime() - msAgo);
  const r = (role: string, msAgo: number, api: boolean) => ({ ...row(role, api ? [] : null, { text: "x" }), createdAt: at(msAgo) });
  it("is busy while the newest turn row is a recent person or tool row", () => {
    expect(turnInFlight([r("user", 1000, true)], now, 60_000)).toBe(true);
    expect(turnInFlight([r("tool", 1000, true), r("user", 2000, true)], now, 60_000)).toBe(true);
  });
  it("skips box notes: a Confirm row written mid-turn does not hide the running turn", () => {
    expect(turnInFlight([r("cris", 10, false), r("tool", 1000, true), r("user", 2000, true)], now, 60_000)).toBe(true);
  });
  it("guards preview turns too: their rows store an empty api, which is still a turn row", () => {
    expect(turnInFlight([{ ...row("user", [], { text: "Hello!" }), createdAt: at(1000) }], now, 60_000)).toBe(true);
    expect(turnInFlight([{ ...row("cris", [], { text: "Hi!" }), createdAt: at(10) }, { ...row("user", [], { text: "Hello!" }), createdAt: at(1000) }], now, 60_000)).toBe(false);
  });
  it("is free once the turn's Cris reply is newest, or the turn row is old (a crash)", () => {
    expect(turnInFlight([r("cris", 10, false), r("cris", 1000, true), r("user", 2000, true)], now, 60_000)).toBe(false);
    expect(turnInFlight([r("user", 120_000, true)], now, 60_000)).toBe(false);
    expect(turnInFlight([], now, 60_000)).toBe(false);
  });
});

describe("openPickCard", () => {
  it("finds a spares or Which one? card, and nothing else", () => {
    const which = { type: "which", choices: [] };
    expect(openPickCard({ cards: [{ type: "chips", items: [] }, which] })).toEqual(which);
    expect(openPickCard({ cards: [{ type: "chips", items: [] }] })).toBeNull();
    expect(openPickCard(undefined)).toBeNull();
  });
});

describe("spareTagsOf (the spares card open in the box, read from the server's own last Cris message)", () => {
  it("lists the tags of the last Cris message's spares card", () => {
    const content = { text: null, cards: [{ type: "spares", employeeId: "e1", offset: 0, more: true, options: [
      { assetId: "a1", tag: "BR-LT-0230", model: "Dell", typeName: "Laptop", warrantyEnd: null, backOn: null },
      { assetId: "a2", tag: "BR-LT-0231", model: "Dell", typeName: "Laptop", warrantyEnd: null, backOn: null },
    ] }] };
    expect(spareTagsOf(content)).toEqual(["BR-LT-0230", "BR-LT-0231"]);
  });
  it("is empty when that message has no spares card, or is malformed", () => {
    expect(spareTagsOf({ text: "hi", cards: [] })).toEqual([]);
    expect(spareTagsOf(null)).toEqual([]);
    expect(spareTagsOf({ cards: [{ type: "spares", options: "nope" }] })).toEqual([]);
  });
});
