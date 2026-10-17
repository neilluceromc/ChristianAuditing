import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import type { ConfirmCard } from "@/lib/cris-cards";
import { EMPTY_PICKS, type Picks } from "@/lib/cris-picks";

/*
 * The tools against a stubbed Prisma: the definitions' strict schemas, the pick enforcement on the propose tools
 * (spec §6.6), and find_people's "never guesses a person" (spec §3(d)). createPending is stubbed — pending-core.test.ts
 * covers it.
 */

type Person = {
  id: string; name: string; employeeNo: string; title: string; employment: string;
  department: { name: string; kind: "INTERNAL" | "CLIENT" };
};

const h = vi.hoisted(() => ({
  people: [] as Person[],
  assets: [] as Array<{ id: string; tag: string; cls: string; assigneeId: string | null; typeId: string | null }>,
  pendingCalls: [] as Array<{ kind: string; input: unknown; meta: unknown }>,
  pendingResult: null as unknown,
  employeeWhere: null as unknown,
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    employee: {
      findMany: async (args: { where: unknown; take?: number }) => {
        h.employeeWhere = args.where;
        return h.people.slice(0, args.take ?? h.people.length);
      },
      findUnique: async ({ where }: { where: { id: string } }) => h.people.find((p) => p.id === where.id) ?? null,
    },
    asset: {
      findMany: async ({ where }: { where: { AND: Array<{ tag?: { in: string[] } }> } }) => {
        const tags = where.AND.find((w) => w.tag)?.tag?.in ?? [];
        return h.assets.filter((a) => tags.includes(a.tag) && a.cls === "IT").map((a) => ({ id: a.id, tag: a.tag }));
      },
      findUnique: async ({ where }: { where: { id: string } }) => h.assets.find((a) => a.id === where.id) ?? null,
      count: async ({ where }: { where: { assigneeId: string; typeId: string | null } }) =>
        h.assets.filter((a) => a.assigneeId === where.assigneeId && a.typeId === where.typeId).length,
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  },
}));
vi.mock("./pending-core", () => ({
  createPending: async (_tx: unknown, _user: unknown, _conv: string, kind: string, input: unknown, meta: unknown) => {
    h.pendingCalls.push({ kind, input, meta });
    return h.pendingResult;
  },
}));
vi.mock("@/server/modules/employees/queries", () => ({ holdingsRows: async () => [] }));
vi.mock("@/server/modules/inventory/queries", () => ({ exactTagMatch: () => null }));

const { CRIS_TOOLS, REFUSE_PICK, runTool } = await import("./tools");

const user = { id: "u1", role: "it_staff", name: "Neil" } as User;
const ctx = (over: Partial<{ picks: Picks; pageEmployeeId: string | null; userText: string; scannedAssetIds: string[] }> = {}) => ({
  user, conversationId: "c1", picks: EMPTY_PICKS, pageEmployeeId: null, userText: "", ...over,
});
const person = (id: string, name: string, no: string): Person => ({
  id, name, employeeNo: no, title: "Agent", employment: "ACTIVE", department: { name: "Acme", kind: "CLIENT" },
});
const card = { type: "confirm", pendingId: "p1" } as ConfirmCard;

beforeEach(() => {
  h.people = [];
  h.assets = [];
  h.pendingCalls = [];
  h.pendingResult = { ok: true, data: { card } };
});

describe("CRIS_TOOLS (spec §8)", () => {
  it("is the six tools, each strict with additionalProperties false", () => {
    expect(CRIS_TOOLS.map((t) => t.name)).toEqual([
      "find_people", "get_holdings", "find_asset", "list_spares", "propose_assign", "propose_replace",
    ]);
    for (const t of CRIS_TOOLS) {
      expect(t.strict).toBe(true);
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema.additionalProperties).toBe(false);
      for (const r of t.input_schema.required) expect(Object.keys(t.input_schema.properties)).toContain(r);
    }
  });
  it("uses no keyword strict mode rejects (numeric or length bounds)", () => {
    const json = JSON.stringify(CRIS_TOOLS);
    for (const k of ["minimum", "maximum", "minLength", "maxLength", "multipleOf"]) expect(json).not.toContain(`"${k}"`);
  });
});

describe("propose_* pick enforcement (spec §6.6)", () => {
  it("refuses a person the person never picked: the refusal, no card, Looking", async () => {
    const out = await runTool(ctx({ picks: { people: [], assets: ["a1"] } }), "propose_assign", { employeeId: "e2", assetId: "a1" });
    expect(out).toEqual({ result: { error: REFUSE_PICK }, cards: [], picks: { people: [], assets: ["a1"] }, mood: "look" });
    expect(REFUSE_PICK).toBe("ask the person to pick or scan");
    expect(h.pendingCalls).toHaveLength(0);
  });
  it("refuses an asset never picked, even for the page person", async () => {
    const out = await runTool(ctx({ pageEmployeeId: "e1" }), "propose_assign", { employeeId: "e1", assetId: "a1" });
    expect(out.result).toEqual({ error: REFUSE_PICK });
    expect(out.cards).toEqual([]);
    expect(h.pendingCalls).toHaveLength(0);
  });
  it("Review Focus #1: the page person of an earlier message is not allowed from another page", async () => {
    const out = await runTool(ctx({ picks: { people: [], assets: ["a1"] }, pageEmployeeId: null }), "propose_assign", { employeeId: "e1", assetId: "a1" });
    expect(out.result).toEqual({ error: REFUSE_PICK });
  });
  it("proposes for the page person and a tag the person typed exactly — the Confirm card comes back", async () => {
    h.assets = [{ id: "a7", tag: "BR-LT-0230", cls: "IT", assigneeId: null, typeId: "t1" }];
    const out = await runTool(ctx({ pageEmployeeId: "e1", userText: "give them br-lt-0230" }), "propose_assign", { employeeId: "e1", assetId: "a7" });
    expect(out.cards).toEqual([card]);
    expect(out.mood).toBe("look");
    expect(out.picks.assets).toEqual(["a7"]);
    expect(h.pendingCalls).toEqual([{ kind: "assign", input: { employeeId: "e1", assetId: "a7" }, meta: { scanned: false } }]);
  });
  it("says Scanned when the person scanned the spare", async () => {
    await runTool(ctx({ picks: { people: ["e1"], assets: ["a1"] }, scannedAssetIds: ["a1"] }), "propose_assign", { employeeId: "e1", assetId: "a1" });
    expect(h.pendingCalls[0].meta).toEqual({ scanned: true });
  });
  it("a dry-run refusal goes back to the model in the action's own words, with no card", async () => {
    h.pendingResult = { ok: false, kind: "conflict", message: "BR-LT-0230 isn't a spare." };
    const out = await runTool(ctx({ picks: { people: ["e1"], assets: ["a1"] } }), "propose_assign", { employeeId: "e1", assetId: "a1" });
    expect(out).toMatchObject({ result: { error: "BR-LT-0230 isn't a spare." }, cards: [], mood: "sad" });
  });
  it("replace: the old item needs no pick only when it is the person's sole item of its type", async () => {
    h.assets = [
      { id: "old1", tag: "BR-LT-0001", cls: "IT", assigneeId: "e1", typeId: "lt" },
      { id: "old2", tag: "BR-LT-0002", cls: "IT", assigneeId: "e1", typeId: "lt" },
      { id: "mon", tag: "BR-MN-0001", cls: "IT", assigneeId: "e1", typeId: "mn" },
    ];
    const picks = { people: ["e1"], assets: ["new"] };
    const sole = await runTool(ctx({ picks }), "propose_replace", { employeeId: "e1", oldAssetId: "mon", newAssetId: "new", outcome: "TRIAGE" });
    expect(sole.cards).toEqual([card]);
    const twoLaptops = await runTool(ctx({ picks }), "propose_replace", { employeeId: "e1", oldAssetId: "old1", newAssetId: "new", outcome: "TRIAGE" });
    expect(twoLaptops.result).toEqual({ error: REFUSE_PICK });
    const notTheirs = await runTool(ctx({ picks: { people: ["e2"], assets: ["new"] } }), "propose_replace", { employeeId: "e2", oldAssetId: "mon", newAssetId: "new", outcome: "TRIAGE" });
    expect(notTheirs.result).toEqual({ error: REFUSE_PICK });
    const newNotPicked = await runTool(ctx({ picks: { people: ["e1"], assets: [] } }), "propose_replace", { employeeId: "e1", oldAssetId: "mon", newAssetId: "new", outcome: "TRIAGE" });
    expect(newNotPicked.result).toEqual({ error: REFUSE_PICK });
    expect(h.pendingCalls).toHaveLength(1);
  });
  it("never proposes a Buyout", async () => {
    const out = await runTool(ctx({ picks: { people: ["e1"], assets: ["new", "mon"] } }), "propose_replace", { employeeId: "e1", oldAssetId: "mon", newAssetId: "new", outcome: "BUYOUT" });
    expect(out.result).toHaveProperty("error");
    expect(h.pendingCalls).toHaveLength(0);
  });
});

describe("find_people (spec §3(d))", () => {
  it("searches ACTIVE and leaving people only", async () => {
    await runTool(ctx({ userText: "ana" }), "find_people", { q: "ana" });
    expect(h.employeeWhere).toMatchObject({ employment: { in: ["ACTIVE", "OFFBOARDING"] } });
  });
  it("two or more matches: a Which one? card, and nobody is picked", async () => {
    h.people = [person("e1", "Ana Reyes", "EMP-1"), person("e2", "Ana Cruz", "EMP-2")];
    const out = await runTool(ctx({ userText: "check Ana" }), "find_people", { q: "Ana" });
    expect(out.cards).toEqual([{
      type: "which",
      choices: [
        { id: "e1", name: "Ana Reyes", employeeNo: "EMP-1", worksFor: "Acme", initials: "AR" },
        { id: "e2", name: "Ana Cruz", employeeNo: "EMP-2", worksFor: "Acme", initials: "AC" },
      ],
    }]);
    expect(out.picks.people).toEqual([]);
    expect(out.mood).toBe("look");
  });
  it("a single whole-name match of the person's own words is their pick", async () => {
    h.people = [person("e1", "Ana Reyes", "EMP-1")];
    const out = await runTool(ctx({ userText: "Check Ana Reyes's items" }), "find_people", { q: "Ana Reyes" });
    expect(out.picks.people).toEqual(["e1"]);
    expect(out.cards).toEqual([]);
    expect(out.result).toMatchObject({ picked: true, people: [{ employeeId: "e1", name: "Ana Reyes", employeeNo: "EMP-1", title: "Agent", worksFor: "Acme", client: true }] });
  });
  it("a single match on part of a name still asks", async () => {
    h.people = [person("e1", "Ana Reyes", "EMP-1")];
    const out = await runTool(ctx({ userText: "Check Ana's items" }), "find_people", { q: "Ana" });
    expect(out.picks.people).toEqual([]);
    expect(out.cards[0]).toMatchObject({ type: "which" });
  });
  it("a whole name the model made up (not in the person's words) is not a pick", async () => {
    h.people = [person("e1", "Ana Reyes", "EMP-1")];
    const out = await runTool(ctx({ userText: "check the new hire" }), "find_people", { q: "Ana Reyes" });
    expect(out.picks.people).toEqual([]);
    expect(out.cards[0]).toMatchObject({ type: "which" });
  });
  it("the result holds only the allowed fields", async () => {
    h.people = [{ ...person("e1", "Ana Reyes", "EMP-1"), ...({ notes: "x", cost: 9 } as object) } as Person];
    const out = await runTool(ctx({ userText: "Ana Reyes" }), "find_people", { q: "Ana Reyes" });
    const json = JSON.stringify(out.result);
    expect(json).not.toContain("notes");
    expect(json).not.toContain("cost");
  });
});

describe("runTool", () => {
  it("an unknown tool or a malformed input is an error to the model, never a throw", async () => {
    expect((await runTool(ctx(), "drop_tables", {})).result).toHaveProperty("error");
    expect((await runTool(ctx(), "find_people", { q: 3 })).result).toHaveProperty("error");
  });
});
