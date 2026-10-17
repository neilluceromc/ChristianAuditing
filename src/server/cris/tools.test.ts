import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role, User } from "@prisma/client";
import type { ConfirmCard } from "@/lib/cris-cards";
import { EMPTY_PICKS, type Picks } from "@/lib/cris-picks";

/*
 * The tools against an in-memory Prisma that APPLIES the where it is given (class filters, ORs, relations), so the
 * visibility rules are tested for real: deleting a `visibleClassWhere` makes a test here fail. Covered: the strict
 * definitions, the pick enforcement on the propose tools (spec §6.6), find_people's "never guesses a person"
 * (spec §3(d)), and each read's visibility and data minimisation (spec §3(b), §8). createPending and sparesCard are
 * stubbed — pending-core.test.ts covers them.
 */

type Person = {
  id: string; name: string; employeeNo: string; title: string; employment: string; departmentId: string;
  department: { name: string; kind: "INTERNAL" | "CLIENT" };
};
type AssetRow = {
  id: string; tag: string; model: string; serial: string | null; status: string; cls: "IT" | "PURCHASING";
  typeId: string | null; assigneeId: string | null; type: { name: string } | null;
  assignee: { id: string; name: string; employeeNo: string } | null;
  // never to be sent: present so a leak would show
  cost: number; notes: string;
};

const h = vi.hoisted(() => {
  type Where = Record<string, unknown> | undefined;
  /** A small Prisma where evaluator: AND, OR, equality, in, equals/contains (insensitive), relation `is`. Unknown operators fail closed. */
  function match(row: Record<string, unknown>, where: Where): boolean {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === "AND") return (v as Where[]).every((w) => match(row, w));
      if (k === "OR") return (v as Where[]).some((w) => match(row, w));
      const val = row[k];
      if (v !== null && typeof v === "object") {
        const op = v as Record<string, unknown>;
        if ("in" in op) return (op.in as unknown[]).includes(val);
        if ("equals" in op) return String(val ?? "").toLowerCase() === String(op.equals).toLowerCase() && val != null;
        if ("contains" in op) return val != null && String(val).toLowerCase().includes(String(op.contains).toLowerCase());
        if ("is" in op) return val != null && match(val as Record<string, unknown>, op.is as Where);
        return false;
      }
      return val === v;
    });
  }
  return {
    match,
    people: [] as Person[],
    assets: [] as AssetRow[],
    policies: [] as unknown[],
    exceptions: [] as unknown[],
    holdings: [] as Array<{ section: string; tag: string; model: string; since: Date | null }>,
    exactTag: null as null | { id: string },
    pendingCalls: [] as Array<{ kind: string; input: unknown; meta: unknown }>,
    pendingResult: null as unknown,
    sparesCalls: [] as Array<{ employeeId: string; opts: unknown }>,
    stockCalls: [] as unknown[],
    stockOptions: null as null | unknown[],
    employeeWhere: null as unknown,
  };
});

vi.mock("@/server/db/client", () => {
  const rows = <T,>(list: T[], where: unknown) => list.filter((r) => h.match(r as Record<string, unknown>, where as Record<string, unknown>));
  return {
    prisma: {
      employee: {
        findMany: async ({ where, take }: { where: unknown; take?: number }) => {
          h.employeeWhere = where;
          return rows(h.people, where).slice(0, take);
        },
        findUnique: async ({ where }: { where: { id: string } }) => h.people.find((p) => p.id === where.id) ?? null,
      },
      asset: {
        findMany: async ({ where, take }: { where: unknown; take?: number }) => rows(h.assets, where).slice(0, take),
        findFirst: async ({ where }: { where: unknown }) => rows(h.assets, where)[0] ?? null,
        findUnique: async ({ where }: { where: { id: string } }) => h.assets.find((a) => a.id === where.id) ?? null,
        count: async ({ where }: { where: unknown }) => rows(h.assets, where).length,
      },
      equipmentPolicy: { findMany: async () => h.policies },
      employeeSlotException: { findMany: async () => h.exceptions },
      $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    },
  };
});
vi.mock("./pending-core", () => ({
  createPending: async (_tx: unknown, _user: unknown, _conv: string, kind: string, input: unknown, meta: unknown) => {
    h.pendingCalls.push({ kind, input, meta });
    return h.pendingResult;
  },
}));
vi.mock("./cards", () => ({
  sparesCard: async (_db: unknown, employeeId: string, opts: { offset: number }) => {
    h.sparesCalls.push({ employeeId, opts });
    return {
      type: "spares", employeeId, offset: opts.offset, more: true,
      options: [{ assetId: "s1", tag: "BR-LT-0300", model: "T14", typeName: "Laptop", warrantyEnd: "2027-01-31T00:00:00.000Z", backOn: null }],
    };
  },
  stockCard: async (_db: unknown, opts: { offset: number }) => {
    h.stockCalls.push(opts);
    return {
      type: "stock", offset: opts.offset, more: true,
      options: h.stockOptions ?? [{ assetId: "s2", tag: "BR-LT-0301", model: "T14", typeName: "Laptop", warrantyEnd: null, backOn: null }],
    };
  },
}));
vi.mock("@/server/modules/employees/queries", () => ({ holdingsRows: async () => h.holdings }));
vi.mock("@/server/modules/inventory/queries", () => ({ exactTagMatch: async () => h.exactTag }));

const { CRIS_TOOLS, REFUSE_PICK, runTool } = await import("./tools");

const userOf = (role: Role) => ({ id: "u1", role, name: "Neil" }) as User;
type Over = Partial<{ role: Role; picks: Picks; pageEmployeeId: string | null; userText: string; scannedAssetIds: string[]; openSpareTags: string[] }>;
const ctx = ({ role = "it_staff", ...over }: Over = {}) => ({
  user: userOf(role), conversationId: "c1", picks: EMPTY_PICKS, pageEmployeeId: null, userText: "", ...over,
});
const person = (id: string, name: string, no: string, employment = "ACTIVE"): Person => ({
  id, name, employeeNo: no, title: "Agent", employment, departmentId: "d1", department: { name: "Acme", kind: "CLIENT" },
});
const asset = (id: string, tag: string, over: Partial<AssetRow> = {}): AssetRow => ({
  id, tag, model: "ThinkPad T14", serial: `SN-${id}`, status: "SPARE", cls: "IT", typeId: "lt", assigneeId: null,
  type: { name: "Laptop" }, assignee: null, cost: 55000, notes: "free text never sent", ...over,
});
const card = { type: "confirm", pendingId: "p1" } as ConfirmCard;
const keys = (o: unknown) => Object.keys(o as object).sort();
const LEAKS = ["notes", "cost", "price", "reason", "invoice", "55000", "free text", "confidential"];

beforeEach(() => {
  h.people = [];
  h.assets = [];
  h.policies = [];
  h.exceptions = [];
  h.holdings = [];
  h.exactTag = null;
  h.pendingCalls = [];
  h.sparesCalls = [];
  h.stockCalls = [];
  h.stockOptions = null;
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
    h.assets = [asset("a7", "BR-LT-0230")];
    const out = await runTool(ctx({ pageEmployeeId: "e1", userText: "give them br-lt-0230" }), "propose_assign", { employeeId: "e1", assetId: "a7" });
    expect(out.cards).toEqual([card]);
    expect(out.mood).toBe("look");
    expect(out.picks.assets).toEqual(["a7"]);
    expect(h.pendingCalls).toEqual([{ kind: "assign", input: { employeeId: "e1", assetId: "a7" }, meta: { scanned: false } }]);
  });
  it("a typed tag of a class the person cannot see is no pick (it_staff and a Purchasing car), but is for admin", async () => {
    h.assets = [asset("car", "BR-VH-0001", { cls: "PURCHASING", typeId: "vh" })];
    const input = { employeeId: "e1", assetId: "car" };
    const it = await runTool(ctx({ picks: { people: ["e1"], assets: [] }, userText: "use BR-VH-0001" }), "propose_assign", input);
    expect(it.picks.assets).toEqual([]);
    expect(it.result).toEqual({ error: REFUSE_PICK });
    expect(h.pendingCalls).toHaveLength(0);
    const admin = await runTool(ctx({ role: "admin", picks: { people: ["e1"], assets: [] }, userText: "use BR-VH-0001" }), "propose_assign", input);
    expect(admin.picks.assets).toEqual(["car"]);
  });
  it("a bare 4-digit number names a spare only while a spares card is open", async () => {
    h.assets = [asset("a30", "BR-LT-0230"), asset("a31", "BR-LT-0231")];
    const base = { picks: { people: ["e1"], assets: [] }, userText: "take 0230" };
    const open = await runTool(ctx({ ...base, openSpareTags: ["BR-LT-0230", "BR-LT-0231"] }), "propose_assign", { employeeId: "e1", assetId: "a30" });
    expect(open.picks.assets).toEqual(["a30"]);
    expect(open.cards).toEqual([card]);
    const closed = await runTool(ctx(base), "propose_assign", { employeeId: "e1", assetId: "a30" });
    expect(closed.picks.assets).toEqual([]);
    expect(closed.result).toEqual({ error: REFUSE_PICK });
  });
  it("an asset id seen only in a find_asset result is refused when proposed", async () => {
    h.assets = [asset("a5", "BR-LT-0005")];
    const found = await runTool(ctx({ userText: "any thinkpads?" }), "find_asset", { q: "ThinkPad" });
    expect(found.result).toMatchObject({ assets: [{ assetId: "a5" }] });
    expect(found.picks).toEqual(EMPTY_PICKS);
    const out = await runTool(ctx({ picks: { people: ["e1"], assets: [] }, userText: "give that one to them" }), "propose_assign", { employeeId: "e1", assetId: "a5" });
    expect(out.result).toEqual({ error: REFUSE_PICK });
    expect(h.pendingCalls).toHaveLength(0);
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
      asset("old1", "BR-LT-0001", { assigneeId: "e1", status: "DEPLOYED" }),
      asset("old2", "BR-LT-0002", { assigneeId: "e1", status: "DEPLOYED" }),
      asset("mon", "BR-MN-0001", { assigneeId: "e1", status: "DEPLOYED", typeId: "mn" }),
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
    h.people = [person("e1", "Ana Reyes", "EMP-1"), person("e2", "Ana Cruz", "EMP-2", "OFFBOARDING"), person("e3", "Ana Gone", "EMP-3", "OFFBOARDED")];
    const out = await runTool(ctx({ userText: "ana" }), "find_people", { q: "ana" });
    expect(h.employeeWhere).toMatchObject({ employment: { in: ["ACTIVE", "OFFBOARDING"] } });
    expect((out.result as { people: Array<{ employeeId: string; leaving: boolean }> }).people.map((p) => [p.employeeId, p.leaving]))
      .toEqual([["e1", false], ["e2", true]]);
  });
  it("needs the people screens: a role without them gets the refusal, not a search", async () => {
    h.people = [person("e1", "Ana Reyes", "EMP-1")];
    const out = await runTool(ctx({ role: "finance_staff", userText: "Ana Reyes" }), "find_people", { q: "Ana Reyes" });
    expect(out.result).toHaveProperty("error");
    expect(out.picks).toEqual(EMPTY_PICKS);
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
  it("a single whole-name match of the person's own words is their pick, with only the allowed fields", async () => {
    h.people = [{ ...person("e1", "Ana Reyes", "EMP-1"), ...({ notes: "confidential", cost: 9 } as object) } as Person];
    const out = await runTool(ctx({ userText: "Check Ana Reyes's items" }), "find_people", { q: "Ana Reyes" });
    expect(out.picks.people).toEqual(["e1"]);
    expect(out.cards).toEqual([]);
    expect(out.result).toEqual({
      picked: true,
      people: [{ employeeId: "e1", name: "Ana Reyes", employeeNo: "EMP-1", title: "Agent", worksFor: "Acme", client: true, leaving: false }],
    });
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
});

describe("find_asset visibility (spec §3(b))", () => {
  it("drops an exact-tag hit of a hidden class, and proposing it is refused", async () => {
    h.assets = [asset("hidden-vh", "BR-VH-0001", { cls: "PURCHASING", model: "Toyota Vios", serial: "VIN1", typeId: "vh" })];
    h.exactTag = { id: "hidden-vh" }; // exactTagMatch has no class filter of its own
    const out = await runTool(ctx({ userText: "who has BR-VH-0001" }), "find_asset", { q: "BR-VH-0001" });
    expect(out.result).toEqual({ assets: [], note: "Nothing matches." });
    expect(out.mood).toBe("sad");
    expect(JSON.stringify(out)).not.toContain("hidden-vh");
    const propose = await runTool(ctx({ picks: { people: ["e1"], assets: [] }, userText: "use BR-VH-0001" }), "propose_assign", { employeeId: "e1", assetId: "hidden-vh" });
    expect(propose.result).toEqual({ error: REFUSE_PICK });
    expect(h.pendingCalls).toHaveLength(0);
  });
  it("a role that sees the class gets it first, marked exact, with only the allowed fields", async () => {
    h.assets = [
      asset("car2", "BR-VH-0001X", { cls: "PURCHASING", model: "Vios BR-VH-0001", typeId: "vh" }),
      asset("car", "BR-VH-0001", {
        cls: "PURCHASING", model: "Toyota Vios", serial: "VIN1", status: "OPERATIONAL", type: { name: "Vehicle" },
        assigneeId: "e1", assignee: { id: "e1", name: "Ana Reyes", employeeNo: "EMP-1" },
      }),
    ];
    h.exactTag = { id: "car" };
    const out = await runTool(ctx({ role: "admin" }), "find_asset", { q: "BR-VH-0001" });
    const assets = (out.result as { assets: Array<Record<string, unknown>> }).assets;
    expect(assets.map((a) => a.assetId)).toEqual(["car", "car2"]);
    expect(assets[0]).toEqual({
      assetId: "car", tag: "BR-VH-0001", model: "Toyota Vios", serial: "VIN1", type: "Vehicle", status: "Operational",
      holder: { employeeId: "e1", name: "Ana Reyes", employeeNo: "EMP-1" }, exact: true,
    });
    for (const leak of LEAKS) expect(JSON.stringify(out.result)).not.toContain(leak);
  });
  it("an exact serial leads too", async () => {
    h.assets = [asset("a1", "BR-LT-0001", { serial: "PF-1" }), asset("a2", "BR-LT-0002", { serial: "pf-12" })];
    const out = await runTool(ctx(), "find_asset", { q: "PF-12" });
    expect((out.result as { assets: Array<{ assetId: string; exact: boolean }> }).assets).toMatchObject([{ assetId: "a2", exact: true }]);
  });
});

describe("get_holdings (spec §3(b), §8)", () => {
  beforeEach(() => {
    h.people = [person("e1", "Ana Reyes", "EMP-1")];
    h.assets = [
      asset("lap", "BR-LT-0001", { assigneeId: "e1", status: "DEPLOYED", serial: "PF-LAP" }),
      asset("car", "BR-VH-0001", { assigneeId: "e1", status: "OPERATIONAL", cls: "PURCHASING", typeId: "vh", model: "Toyota Vios", serial: "VIN1", type: { name: "Vehicle" } }),
    ];
    h.policies = [{
      id: "p1", name: "Agent kit", appliesToTitle: "Agent", appliesToDepartmentId: null,
      slots: [
        { id: "s1", name: "Laptop", assetTypeId: "lt", required: true, loaner: false },
        { id: "s2", name: "Headset", assetTypeId: "hs", required: true, loaner: false },
        { id: "s3", name: "Mouse", assetTypeId: "ms", required: false, loaner: false },
      ],
    }];
    h.exceptions = [{ id: "x1", kind: "ADD", slotId: null, name: "Dock", assetTypeId: "dk", required: true, loaner: false, reason: "confidential" }];
    h.holdings = [
      { section: "asset", tag: "BR-LT-0001", model: "ThinkPad T14", since: new Date("2026-03-04T05:00:00Z") },
      { section: "asset", tag: "BR-VH-0001", model: "Toyota Vios", since: null },
      { section: "blank", tag: "", model: "", since: null },
      { section: "header", tag: "", model: "", since: null },
      { section: "reservation", tag: "BR-HS-0009", model: "Jabra", since: new Date("2026-10-01T00:00:00Z") },
    ];
  });

  it("sends exactly the allowed keys: no serial for another class's item, no money or free text", async () => {
    const out = await runTool(ctx(), "get_holdings", { employeeId: "e1" });
    const r = out.result as { items: Array<Record<string, unknown>>; gaps: unknown[]; holds: unknown[]; person: unknown };
    expect(keys(r)).toEqual(["gaps", "holds", "items", "person", "policy"]);
    expect(keys(r.person)).toEqual(["client", "employeeId", "employeeNo", "leaving", "name", "title", "worksFor"]);
    const lap = r.items.find((i) => i.assetId === "lap")!;
    const car = r.items.find((i) => i.assetId === "car")!;
    expect(lap).toEqual({
      assetId: "lap", tag: "BR-LT-0001", model: "ThinkPad T14", type: "Laptop", status: "Deployed",
      since: "2026-03-04", slot: "Laptop", serial: "PF-LAP",
    });
    expect(keys(car)).toEqual(["assetId", "model", "since", "slot", "status", "tag", "type"]);
    expect(JSON.stringify(r)).not.toContain("VIN1");
    expect(r.gaps).toEqual([
      { slot: "Headset", typeId: "hs", required: true },
      { slot: "Mouse", typeId: "ms", required: false },
      { slot: "Dock", typeId: "dk", required: true },
    ]);
    expect(r.holds).toEqual([{ tag: "BR-HS-0009", model: "Jabra" }]);
    for (const leak of LEAKS) expect(JSON.stringify(out.result)).not.toContain(leak);
  });
  it("a role that sees the class gets the serial", async () => {
    const out = await runTool(ctx({ role: "admin" }), "get_holdings", { employeeId: "e1" });
    const car = (out.result as { items: Array<Record<string, unknown>> }).items.find((i) => i.assetId === "car")!;
    expect(car.serial).toBe("VIN1");
  });
  it("shows the person card", async () => {
    const out = await runTool(ctx(), "get_holdings", { employeeId: "e1" });
    expect(out.cards).toEqual([{
      type: "person",
      person: { id: "e1", name: "Ana Reyes", employeeNo: "EMP-1", worksFor: "Acme", initials: "AR" },
      items: [
        { assetId: "lap", tag: "BR-LT-0001", model: "ThinkPad T14", since: "2026-03-04T05:00:00.000Z" },
        { assetId: "car", tag: "BR-VH-0001", model: "Toyota Vios", since: null },
      ],
      gaps: ["Headset", "Mouse (optional)", "Dock"],
      holds: ["BR-HS-0009"],
    }]);
    for (const leak of LEAKS) expect(JSON.stringify(out.cards)).not.toContain(leak);
  });
  it("needs the people screens", async () => {
    const out = await runTool(ctx({ role: "finance_staff" }), "get_holdings", { employeeId: "e1" });
    expect(out.result).toHaveProperty("error");
    expect(out.cards).toEqual([]);
  });
});

describe("list_spares", () => {
  it("is gated like the profile's pickers: a role without the people screens gets the refusal", async () => {
    h.people = [person("e1", "Ana Reyes", "EMP-1")];
    const out = await runTool(ctx({ role: "finance_staff" }), "list_spares", { employeeId: "e1" });
    expect(out.result).toHaveProperty("error");
    expect(out.cards).toEqual([]);
    expect(h.sparesCalls).toHaveLength(0);
  });
  it("pages the pickable spares and shows the pick list, sending only the allowed keys", async () => {
    h.people = [person("e1", "Ana Reyes", "EMP-1")];
    const out = await runTool(ctx(), "list_spares", { employeeId: "e1", typeId: "lt", offset: 3 });
    expect(h.sparesCalls).toEqual([{ employeeId: "e1", opts: { typeId: "lt", offset: 3 } }]);
    expect(out.cards[0]).toMatchObject({ type: "spares", offset: 3 });
    expect(out.mood).toBe("look");
    const r = out.result as { spares: Array<Record<string, unknown>>; more: boolean };
    expect(r.spares).toEqual([{ assetId: "s1", tag: "BR-LT-0300", model: "T14", type: "Laptop", warrantyEnd: "2027-01-31" }]);
    expect(r.more).toBe(true);
    expect(out.picks).toEqual(EMPTY_PICKS); // listing never picks
  });
  it("refuses an unknown person", async () => {
    const out = await runTool(ctx(), "list_spares", { employeeId: "nobody" });
    expect(out.result).toHaveProperty("error");
    expect(h.sparesCalls).toHaveLength(0);
  });

  it("I2: takes employeeId as optional in its strict schema", () => {
    const def = CRIS_TOOLS.find((t) => t.name === "list_spares")!;
    expect(def.input_schema.required).toEqual([]);
    expect(Object.keys(def.input_schema.properties)).toContain("employeeId");
  });

  it("I2: without a person, lists the spares in stock as a read-only stock card — no pick list, no picks", async () => {
    const out = await runTool(ctx(), "list_spares", { offset: 3 });
    expect(h.stockCalls).toEqual([{ typeId: null, offset: 3 }]);
    expect(h.sparesCalls).toHaveLength(0);
    expect(out.cards).toEqual([{
      type: "stock", offset: 3, more: true,
      options: [{ assetId: "s2", tag: "BR-LT-0301", model: "T14", typeName: "Laptop", warrantyEnd: null, backOn: null }],
    }]);
    expect(out.cards.some((c) => c.type === "spares")).toBe(false);
    expect(out.mood).toBe("search"); // nothing to wait for
    expect(out.picks).toEqual(EMPTY_PICKS);
    const r = out.result as { spares: Array<Record<string, unknown>>; more: boolean; note: string };
    expect(r.spares).toEqual([{ assetId: "s2", tag: "BR-LT-0301", model: "T14", type: "Laptop", warrantyEnd: null }]);
    expect(r.more).toBe(true);
    expect(r.note).toMatch(/nothing to pick/);
    // a null employeeId (as a model may send) is the same as none
    expect((await runTool(ctx(), "list_spares", { employeeId: null })).cards[0]).toMatchObject({ type: "stock", offset: 0 });
  });

  it("I2: says so when nothing is in stock, with no card", async () => {
    h.stockOptions = [];
    const out = await runTool(ctx(), "list_spares", {});
    expect(out.cards).toEqual([]);
    expect(out.mood).toBe("sad");
    expect(out.result).toMatchObject({ spares: [], more: false, note: "No spares in stock right now." });
  });

  it("I2: a stock spare is not a pick — propose_assign with it is refused without the person's own pick", async () => {
    h.people = [person("e1", "Ana Reyes", "EMP-1")];
    await runTool(ctx(), "list_spares", {});
    const out = await runTool(ctx(), "propose_assign", { employeeId: "e1", assetId: "s2" });
    expect(out.result).toEqual({ error: REFUSE_PICK });
    expect(h.pendingCalls).toHaveLength(0);
  });
});

describe("runTool", () => {
  it("an unknown tool or a malformed input is an error to the model, never a throw", async () => {
    expect((await runTool(ctx(), "drop_tables", {})).result).toHaveProperty("error");
    expect((await runTool(ctx(), "find_people", { q: 3 })).result).toHaveProperty("error");
  });
});
