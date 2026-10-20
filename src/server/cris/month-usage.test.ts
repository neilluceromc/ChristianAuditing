import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 spec §5.5 ruling, Review Focus #5: sign-out soft-clears a person's Cris chats (CrisConversation.clearedAt)
 * and never deletes the messages, because the admin's monthly usage and cost are counted from CrisMessage. This in-memory
 * store honours a `conversation: { clearedAt: null }` filter, so a count that wrongly left cleared chats out would fail.
 */

type Msg = { conversationId: string; role: string; createdAt: Date; model: string | null; inputTokens: number | null; outputTokens: number | null };

const h = vi.hoisted(() => ({
  convs: [] as Array<{ id: string; clearedAt: Date | null }>,
  msgs: [] as Msg[],
}));

function matches(m: Msg, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "conversation") {
      const c = h.convs.find((x) => x.id === m.conversationId);
      if ("clearedAt" in (v as object) && (v as { clearedAt: unknown }).clearedAt === null && c?.clearedAt) return false;
    } else if (k === "createdAt") {
      if (m.createdAt < (v as { gte: Date }).gte) return false;
    } else if (k === "model") {
      if (m.model === null) return false;
    } else if ((m as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

vi.mock("@/server/db/client", () => ({
  prisma: {
    crisMessage: {
      count: async ({ where }: { where: Record<string, unknown> }) => h.msgs.filter((m) => matches(m, where)).length,
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        const by = new Map<string, { inputTokens: number; outputTokens: number }>();
        for (const m of h.msgs.filter((x) => matches(x, where))) {
          const g = by.get(m.model!) ?? { inputTokens: 0, outputTokens: 0 };
          g.inputTokens += m.inputTokens ?? 0;
          g.outputTokens += m.outputTokens ?? 0;
          by.set(m.model!, g);
        }
        return [...by].map(([model, s]) => ({ model, _sum: s }));
      },
    },
  },
}));

const { crisMonthUsage } = await import("./settings-read");

const NOW = new Date("2026-10-21T04:00:00Z");
const at = new Date("2026-10-20T04:00:00Z");

function seed(conversationId: string, clearedAt: Date | null) {
  h.convs.push({ id: conversationId, clearedAt });
  h.msgs.push(
    { conversationId, role: "user", createdAt: at, model: null, inputTokens: null, outputTokens: null },
    { conversationId, role: "assistant", createdAt: at, model: "claude-haiku-5-5", inputTokens: 1_000_000, outputTokens: 0 },
  );
}

beforeEach(() => {
  h.convs = [];
  h.msgs = [];
});

describe("crisMonthUsage with chats cleared on sign-out", () => {
  it("counts the questions and the cost of cleared conversations: clearing changes neither", async () => {
    seed("a", null);
    seed("b", null);
    const before = await crisMonthUsage(NOW);
    h.convs.find((c) => c.id === "b")!.clearedAt = new Date("2026-10-20T09:00:00Z");
    const after = await crisMonthUsage(NOW);
    expect(after).toEqual(before);
    expect(after.questions).toBe(2);
    expect(after.costUsd).toBeGreaterThan(0);
  });
});
