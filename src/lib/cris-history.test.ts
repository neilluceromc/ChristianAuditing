import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { decodeApi, encodeApi, modelHistory, spareTagsOf, storedContent } from "./cris-history";
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

  it("skips a row whose stored api is not readable rather than sending garbage", () => {
    expect(modelHistory([{ role: "tool", content: { api: "{not json" } }, row("user", [user("hi")])])).toEqual([user("hi")]);
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
