import { describe, expect, it } from "vitest";
import {
  EMPTY_PICKS, PICKS_KEEP, allowAsset, allowPerson, exactTagIn, exactTagsIn, notePick, pageEntity, parsePicks, wholeNameMatch, wordsIn,
  type Picks,
} from "./cris-picks";

const picks = (people: string[] = [], assets: string[] = []): Picks => ({ people, assets });

describe("allowPerson (spec §6.6)", () => {
  it("refuses a person never picked and not the page person", () => {
    expect(allowPerson(picks(), "e2", "e1")).toBe(false);
  });
  it("allows a picked person", () => {
    expect(allowPerson(picks(["e2"]), "e2", null)).toBe(true);
  });
  it("allows the page person", () => {
    expect(allowPerson(EMPTY_PICKS, "e1", "e1")).toBe(true);
  });
  it("Review Focus #1: the previous page's person is not allowed once the message comes from another page", () => {
    // The turn passes the CURRENT message's page only; a page left behind is never carried in picks.
    expect(allowPerson(EMPTY_PICKS, "e1", null)).toBe(false);
    expect(allowPerson(EMPTY_PICKS, "e1", "e9")).toBe(false);
  });
});

describe("allowAsset", () => {
  it("refuses an asset never picked", () => {
    expect(allowAsset(picks(["e1"], ["a1"]), "a2")).toBe(false);
  });
  it("allows a picked asset", () => {
    expect(allowAsset(picks([], ["a1"]), "a1")).toBe(true);
  });
});

describe("notePick", () => {
  it("deduplicates, moving the repeat to the end", () => {
    const p = notePick(notePick(notePick(EMPTY_PICKS, { person: "e1" }), { person: "e2" }), { person: "e1", asset: "a1" });
    expect(p).toEqual({ people: ["e2", "e1"], assets: ["a1"] });
    expect(notePick(p, { asset: "a1" }).assets).toEqual(["a1"]);
  });
  it("keeps the last 20 of each", () => {
    let p = EMPTY_PICKS;
    for (let i = 0; i < 25; i++) p = notePick(p, { asset: `a${i}` });
    expect(p.assets).toHaveLength(PICKS_KEEP);
    expect(p.assets[0]).toBe("a5");
    expect(p.assets.at(-1)).toBe("a24");
  });
  it("never mutates its input", () => {
    const p = picks(["e1"]);
    notePick(p, { person: "e2" });
    expect(p.people).toEqual(["e1"]);
  });
});

describe("parsePicks", () => {
  it("reads the stored JSON, dropping anything that is not a string list", () => {
    expect(parsePicks({})).toEqual(EMPTY_PICKS);
    expect(parsePicks(null)).toEqual(EMPTY_PICKS);
    expect(parsePicks({ people: ["e1", 3], assets: "a1" })).toEqual({ people: ["e1"], assets: [] });
  });
});

describe("exactTagIn", () => {
  it("finds a BR-XX-0000 tag case-insensitively", () => {
    expect(exactTagIn("use br-lt-0230 please")).toBe("BR-LT-0230");
  });
  it("needs the whole tag", () => {
    expect(exactTagIn("use br-lt-023 please")).toBeNull();
    expect(exactTagIn("use XBR-LT-0230")).toBeNull();
    expect(exactTagIn("use BR-LT-02301")).toBeNull();
  });
  it("counts a bare 4-digit number only when a spares card is open, and only when it names one of its tags", () => {
    expect(exactTagIn("0230")).toBeNull();
    expect(exactTagIn("take 0230", ["BR-LT-0230", "BR-LT-0231"])).toBe("BR-LT-0230");
    expect(exactTagIn("take 0999", ["BR-LT-0230"])).toBeNull();
    // two open tags ending the same way: ambiguous, never guessed
    expect(exactTagIn("take 0230", ["BR-LT-0230", "BR-MN-0230"])).toBeNull();
  });
  it("never reads a date's or a path's digits as a bare number", () => {
    const open = ["BR-LT-2026"];
    expect(exactTagIn("bought 17/10/2026", open)).toBeNull();
    expect(exactTagIn("bought 17.10.2026", open)).toBeNull();
    expect(exactTagIn("from 2026/10/17", open)).toBeNull();
    expect(exactTagIn("from 2026-10-17", open)).toBeNull();
    expect(exactTagIn("take 2026.", open)).toBe("BR-LT-2026");
  });
  it("exactTagsIn lists every typed tag once", () => {
    expect(exactTagsIn("replace BR-LT-0001 with br-lt-0230, not BR-LT-0001")).toEqual(["BR-LT-0001", "BR-LT-0230"]);
  });
});

describe("pageEntity", () => {
  it("reads the employee from a profile path and its sub-paths", () => {
    expect(pageEntity("/employees/abc/timeline")).toEqual({ employeeId: "abc", assetId: null });
    expect(pageEntity("/employees/abc")).toEqual({ employeeId: "abc", assetId: null });
  });
  it("reads the asset from a record path", () => {
    expect(pageEntity("/inventory/xyz?tab=history")).toEqual({ employeeId: null, assetId: "xyz" });
  });
  it("gives nothing for lists and the static pages beside the records", () => {
    expect(pageEntity("/inventory")).toEqual({ employeeId: null, assetId: null });
    expect(pageEntity("/employees/new")).toEqual({ employeeId: null, assetId: null });
    expect(pageEntity("/inventory/scan")).toEqual({ employeeId: null, assetId: null });
    expect(pageEntity("/approvals/abc")).toEqual({ employeeId: null, assetId: null });
  });
  it("decodes an escaped id, and reads a malformed escape as no record instead of throwing", () => {
    expect(pageEntity("/employees/a%20b")).toEqual({ employeeId: "a b", assetId: null });
    expect(pageEntity("/employees/%E0%A4%A")).toEqual({ employeeId: null, assetId: null });
    expect(pageEntity("/inventory/%zz/history")).toEqual({ employeeId: null, assetId: null });
  });
});

describe("the person's own words (spec §3(d))", () => {
  it("wordsIn finds the query in the message, ignoring case and spacing", () => {
    expect(wordsIn("Ana  Reyes", "Check ana reyes's items")).toBe(true);
    expect(wordsIn("Ana Maria Reyes", "Check Ana Reyes's items")).toBe(false);
  });
  it("wholeNameMatch: the full name or the employee no., never part of a name", () => {
    expect(wholeNameMatch("ana reyes", { name: "Ana Reyes", employeeNo: "EMP-0042" })).toBe(true);
    expect(wholeNameMatch("emp-0042", { name: "Ana Reyes", employeeNo: "EMP-0042" })).toBe(true);
    expect(wholeNameMatch("Ana", { name: "Ana Reyes", employeeNo: "EMP-0042" })).toBe(false);
  });
});
