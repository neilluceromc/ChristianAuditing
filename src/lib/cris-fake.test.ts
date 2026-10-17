import { describe, expect, it } from "vitest";
import { FAKE_FALLBACK, fakeDecide, nameIn, type FakeMemory, type FakeToolResult } from "./cris-fake";

const ana = { employeeId: "e-ana", name: "Ana Reyes", employeeNo: "EMP-0101", title: "Agent", worksFor: "Acme", client: true, leaving: false };
const anaB = { ...ana, employeeId: "e-ana2", name: "Ana Bautista", employeeNo: "EMP-0102" };

const found = (people: unknown[], picked: boolean, q = "Ana Reyes"): FakeToolResult => ({ name: "find_people", input: { q }, result: { people, picked } });
const holdings = (items: unknown[] = [
  { assetId: "a-mon", tag: "BR-MN-0021", model: "Dell P2422H", type: "Monitor", status: "Assigned", since: "2026-01-02", slot: "Monitor" },
  { assetId: "a-old", tag: "BR-LT-0148", model: "Dell Latitude 5440", type: "Laptop", status: "Assigned", since: "2026-01-02", slot: "Laptop" },
], gaps: unknown[] = []): FakeToolResult => ({
  name: "get_holdings", input: { employeeId: "e-ana" },
  result: { person: ana, policy: "Agents", items, gaps, holds: [] },
});
const spares: FakeToolResult = {
  name: "list_spares", input: { employeeId: "e-ana" },
  result: { spares: [
    { assetId: "a-230", tag: "BR-LT-0230", model: "Dell Latitude 5450", type: "Laptop", warrantyEnd: null },
    { assetId: "a-231", tag: "BR-LT-0231", model: "Dell Latitude 5450", type: "Laptop", warrantyEnd: null },
  ], offset: 0, more: false },
};
const memory = (texts: string[], results: FakeToolResult[]): FakeMemory => ({ texts, results });

describe("nameIn", () => {
  it("reads the person from the ways IT asks", () => {
    expect(nameIn("Check Ana Reyes's items")).toBe("Ana Reyes");
    expect(nameIn("Check Ana’s items")).toBe("Ana");
    expect(nameIn("Replace Ana Reyes's laptop, the screen is cracked")).toBe("Ana Reyes");
    expect(nameIn("Assign a laptop to Ana Reyes.")).toBe("Ana Reyes");
    expect(nameIn("what does EMP-0101 hold")).toBeNull();
    expect(nameIn("hello there")).toBeNull();
  });
});

describe("fakeDecide — holdings (spec §2 job 1)", () => {
  it("searches for the person in their own words first", () => {
    expect(fakeDecide("Check Ana Reyes's items", [])).toEqual({ kind: "tool", name: "find_people", input: { q: "Ana Reyes" } });
  });
  it("reads the holdings of the single match", () => {
    expect(fakeDecide("Check Ana Reyes's items", [found([ana], true)])).toEqual({ kind: "tool", name: "get_holdings", input: { employeeId: "e-ana" } });
  });
  it("answers from the holdings", () => {
    const d = fakeDecide("Check Ana Reyes's items", [found([ana], true), holdings()]);
    expect(d.kind).toBe("text");
    expect(d.kind === "text" && d.text.startsWith("Ana Reyes has")).toBe(true);
    expect(d.kind === "text" && d.text).toContain("BR-LT-0148");
  });
  it("names the gaps, and says so when nothing is held", () => {
    const d = fakeDecide("Check Ana Reyes's items", [found([ana], true), holdings([], [{ slot: "Laptop", typeId: "t1", required: true }])]);
    expect(d).toEqual({ kind: "text", text: "Ana Reyes has nothing at the moment. Missing: Laptop." });
  });
  it("waits for a pick when the name matches more than one person (the box shows Which one?)", () => {
    const d = fakeDecide("Check Ana's items", [found([ana, anaB], false, "Ana")]);
    expect(d).toEqual({ kind: "text", text: "Which one do you mean? Pick from the list." });
  });
  it("carries on after the person picks from the list", () => {
    const earlier = memory(["Check Ana's items"], [found([ana, anaB], false, "Ana")]);
    expect(fakeDecide("I picked Ana Reyes (EMP-0101).", [], earlier)).toEqual({ kind: "tool", name: "get_holdings", input: { employeeId: "e-ana" } });
  });
  it("says so when no one matches", () => {
    expect(fakeDecide("Check Zed's items", [found([], false, "Zed")])).toEqual({ kind: "text", text: "I couldn't find anyone called Zed." });
  });
});

describe("fakeDecide — replace (spec §2 job 3)", () => {
  const ask = "Replace Ana Reyes's laptop, the screen is cracked";
  it("finds the person, reads what they hold, then lists the spares and waits", () => {
    expect(fakeDecide(ask, [])).toMatchObject({ name: "find_people", input: { q: "Ana Reyes" } });
    expect(fakeDecide(ask, [found([ana], true)])).toMatchObject({ name: "get_holdings", input: { employeeId: "e-ana" } });
    expect(fakeDecide(ask, [found([ana], true), holdings()])).toEqual({ kind: "tool", name: "list_spares", input: { employeeId: "e-ana" } });
    const wait = fakeDecide(ask, [found([ana], true), holdings(), spares]);
    expect(wait).toEqual({ kind: "text", text: "Pick a spare for Ana Reyes, or scan its label." });
  });
  it("proposes the replace on the person's pick: the held laptop back as DEFECTIVE when they said cracked", () => {
    const earlier = memory([ask], [found([ana], true), holdings(), spares]);
    expect(fakeDecide("I picked BR-LT-0230.", [], earlier)).toEqual({
      kind: "tool", name: "propose_replace",
      input: { employeeId: "e-ana", oldAssetId: "a-old", newAssetId: "a-230", outcome: "DEFECTIVE" },
    });
  });
  it("uses TRIAGE when the words don't say broken or cracked", () => {
    const earlier = memory(["Replace Ana Reyes's laptop, it's slow"], [found([ana], true), holdings(), spares]);
    expect(fakeDecide("I picked BR-LT-0231 (scanned).", [], earlier)).toMatchObject({ input: { newAssetId: "a-231", outcome: "TRIAGE" } });
  });
  it("treats an exact tag the person types as their pick", () => {
    const earlier = memory(["Replace Ana Reyes's laptop, it is broken"], [found([ana], true), holdings(), spares]);
    expect(fakeDecide("use br-lt-0230 please", [], earlier)).toMatchObject({ name: "propose_replace", input: { newAssetId: "a-230", outcome: "DEFECTIVE" } });
  });
  it("looks a scanned tag up first when it was not on the list", () => {
    const earlier = memory([ask], [found([ana], true), holdings(), spares]);
    expect(fakeDecide("I picked BR-LT-0300 (scanned).", [], earlier)).toEqual({ kind: "tool", name: "find_asset", input: { q: "BR-LT-0300" } });
    const lookup: FakeToolResult = { name: "find_asset", input: { q: "BR-LT-0300" }, result: { assets: [{ assetId: "a-300", tag: "BR-LT-0300", exact: true, holder: null }] } };
    expect(fakeDecide("I picked BR-LT-0300 (scanned).", [lookup], earlier)).toMatchObject({ name: "propose_replace", input: { newAssetId: "a-300" } });
  });
  it("points at the card once it is shown, and passes a refusal on in its own words", () => {
    const earlier = memory([ask], [found([ana], true), holdings(), spares]);
    const shown: FakeToolResult = { name: "propose_replace", input: {}, result: { shown: "card" } };
    expect(fakeDecide("I picked BR-LT-0230.", [shown], earlier)).toEqual({ kind: "text", text: "Check the card, then press Confirm." });
    const refused: FakeToolResult = { name: "propose_replace", input: {}, result: { error: "ask the person to pick or scan" } };
    expect(fakeDecide("I picked BR-LT-0230.", [refused], earlier)).toEqual({ kind: "text", text: "I couldn't do that: ask the person to pick or scan." });
  });
});

describe("fakeDecide — assign (spec §2 job 2)", () => {
  const ask = "Assign a laptop to Ana Reyes";
  it("finds the person, lists the spares and waits", () => {
    expect(fakeDecide(ask, [])).toMatchObject({ name: "find_people", input: { q: "Ana Reyes" } });
    expect(fakeDecide(ask, [found([ana], true)])).toEqual({ kind: "tool", name: "list_spares", input: { employeeId: "e-ana" } });
    expect(fakeDecide(ask, [found([ana], true), spares])).toEqual({ kind: "text", text: "Pick a spare for Ana Reyes, or scan its label." });
  });
  it("proposes the assign on the pick", () => {
    const earlier = memory([ask], [found([ana], true), spares]);
    expect(fakeDecide("I picked BR-LT-0230 (scanned).", [], earlier)).toEqual({
      kind: "tool", name: "propose_assign", input: { employeeId: "e-ana", assetId: "a-230" },
    });
  });
});

describe("fakeDecide — Change on the Confirm card", () => {
  const ask = "Replace Ana Reyes's laptop, it's slow";
  const shown: FakeToolResult = { name: "propose_replace", input: {}, result: { shown: "card" } };
  it("lists the spares again for the open replace, then waits", () => {
    const earlier = memory([ask, "I picked BR-LT-0230."], [found([ana], true), holdings(), spares, shown]);
    expect(fakeDecide("Change", [], earlier)).toEqual({ kind: "tool", name: "list_spares", input: { employeeId: "e-ana" } });
    expect(fakeDecide("Change", [spares], earlier)).toEqual({ kind: "text", text: "Pick a different spare, or scan its label." });
  });
  it("does the same for an open assign, whatever the case of the word", () => {
    const earlier = memory(["Assign a laptop to Ana Reyes", "I picked BR-LT-0231."], [found([ana], true), spares]);
    expect(fakeDecide(" change ", [], earlier)).toEqual({ kind: "tool", name: "list_spares", input: { employeeId: "e-ana" } });
  });
  it("a pick after Change proposes with the new spare", () => {
    const earlier = memory([ask, "I picked BR-LT-0230.", "Change"], [found([ana], true), holdings(), spares, shown, spares]);
    expect(fakeDecide("I picked BR-LT-0231.", [], earlier)).toMatchObject({ name: "propose_replace", input: { newAssetId: "a-231" } });
  });
  it("falls back when nothing is open to change", () => {
    expect(fakeDecide("Change", [])).toEqual({ kind: "text", text: FAKE_FALLBACK });
    expect(fakeDecide("Change", [], memory(["Check Ana Reyes's items"], [found([ana], true), holdings()]))).toEqual({ kind: "text", text: FAKE_FALLBACK });
  });
});

describe("fakeDecide — who has a tag", () => {
  it("looks the tag up", () => {
    expect(fakeDecide("Who has BR-LT-0148?", [])).toEqual({ kind: "tool", name: "find_asset", input: { q: "BR-LT-0148" } });
  });
  it("names the holder", () => {
    const r: FakeToolResult = { name: "find_asset", input: { q: "BR-LT-0148" }, result: { assets: [
      { assetId: "a-old", tag: "BR-LT-0148", status: "Assigned", exact: true, holder: { employeeId: "e-ana", name: "Ana Reyes", employeeNo: "EMP-0101" } },
    ] } };
    expect(fakeDecide("Who has BR-LT-0148?", [r])).toEqual({ kind: "text", text: "BR-LT-0148 is with Ana Reyes (EMP-0101)." });
  });
  it("says when no one has it, or nothing matches", () => {
    const spare: FakeToolResult = { name: "find_asset", input: { q: "BR-LT-0230" }, result: { assets: [
      { assetId: "a-230", tag: "BR-LT-0230", status: "Spare", exact: true, holder: null },
    ] } };
    expect(fakeDecide("Who has BR-LT-0230?", [spare])).toEqual({ kind: "text", text: "BR-LT-0230 isn't with anyone — it's Spare." });
    const none: FakeToolResult = { name: "find_asset", input: { q: "BR-LT-9999" }, result: { assets: [], note: "Nothing matches." } };
    expect(fakeDecide("Who has BR-LT-9999?", [none])).toEqual({ kind: "text", text: "Nothing matches BR-LT-9999." });
  });
});

describe("fakeDecide — anything else", () => {
  it("falls back to a fixed text", () => {
    const d = fakeDecide("What's the weather?", []);
    expect(d.kind === "text" && d.text.startsWith("Sorry, I didn't catch that")).toBe(true);
  });
  it("is deterministic", () => {
    expect(fakeDecide("Check Ana Reyes's items", [found([ana], true)])).toEqual(fakeDecide("Check Ana Reyes's items", [found([ana], true)]));
  });
});
