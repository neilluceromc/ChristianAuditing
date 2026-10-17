import type Anthropic from "@anthropic-ai/sdk";
import { fakeDecide, type FakeMemory, type FakeToolResult } from "@/lib/cris-fake";
import { personTextOf } from "@/lib/cris-prompt";
import type { CrisModel, CrisReply, CrisRequest } from "./model";

/*
 * Spec §8: the scripted model for e2e and the battery (`CRIS_MODEL=fake`, never in production — see pickModel).
 * It reads the conversation it is sent, asks the pure script (src/lib/cris-fake.ts) for the next step, and answers
 * in the real API's content-block shapes, so the turn loop runs exactly as it does against Anthropic.
 */

type Turn = { text: string; results: FakeToolResult[] };

const parse = (s: unknown): unknown => {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return s; }
};

/** The conversation as turns: each person message, and the tool calls and results that followed it. */
function turnsOf(messages: Anthropic.MessageParam[]): Turn[] {
  const turns: Turn[] = [];
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  for (const m of messages) {
    const words = personTextOf(m);
    if (words !== null) { turns.push({ text: words, results: [] }); continue; }
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_use") calls.set(b.id, { name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
      if (b.type === "tool_result") {
        const call = calls.get(b.tool_use_id);
        if (call && turns.length > 0) turns[turns.length - 1].results.push({ ...call, result: parse(b.content) });
      }
    }
  }
  return turns;
}

export const fakeModel: CrisModel = {
  id: "fake",
  async reply({ messages }: CrisRequest): Promise<CrisReply> {
    const turns = turnsOf(messages);
    const current = turns[turns.length - 1] ?? { text: "", results: [] };
    const earlier: FakeMemory = {
      texts: turns.slice(0, -1).map((t) => t.text),
      results: turns.slice(0, -1).flatMap((t) => t.results),
    };
    const next = fakeDecide(current.text, current.results, earlier);
    const usage = { input: 0, output: 0 };
    if (next.kind === "text") {
      return { content: [{ type: "text", text: next.text, citations: null }], stop: "end_turn", usage };
    }
    // Deterministic, and unique within the conversation: one id per message sent so far.
    const id = `toolu_fake_${messages.length}`;
    return {
      content: [{ type: "tool_use", id, name: next.name, input: next.input, caller: { type: "direct" } }],
      stop: "tool_use",
      usage,
    };
  },
};
