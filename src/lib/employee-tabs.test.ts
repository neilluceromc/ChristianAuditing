import { describe, expect, it } from "vitest";
import { buildEmployeeTabs, EMPLOYEE_TABS, employeeTabState, TAB_FACETS } from "./employee-tabs";
import { EMPLOYEES_LIST_CONFIG } from "./employees-list";
import { parseListState, serializeListState, type ListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), EMPLOYEES_LIST_CONFIG);
/** the href a tab would link to: the serialized list state, with gaps=1 appended when it is on */
const hrefFor = (s: ListState, gaps: boolean) => {
  const qs = serializeListState(s, EMPLOYEES_LIST_CONFIG);
  return gaps ? (qs ? `${qs}&gaps=1` : "?gaps=1") : qs || "?";
};
const counts = { all: 570, client: 400, internal: 170, leaving: 7, gaps: 31, joined: 12 };
const tabsFor = (qs: string, gaps = false) => buildEmployeeTabs(parse(qs), gaps, counts, hrefFor);
const onKeys = (qs: string, gaps = false) => tabsFor(qs, gaps).filter((t) => t.on).map((t) => t.key);

describe("EMPLOYEE_TABS", () => {
  it("lists the six tabs in order with the spec's labels", () => {
    expect(EMPLOYEE_TABS.map((t) => [t.key, t.label])).toEqual([
      ["all", "All"], ["client", "Client staff"], ["internal", "Internal staff"],
      ["leaving", "Leaving"], ["gaps", "Missing kit"], ["joined", "New this month"],
    ]);
  });
  it("tones Leaving inflight and Missing kit attention", () => {
    expect(tabsFor("").map((t) => [t.key, t.tone])).toEqual([
      ["all", undefined], ["client", undefined], ["internal", undefined],
      ["leaving", "inflight"], ["gaps", "attention"], ["joined", undefined],
    ]);
  });
  it("TAB_FACETS are the three filter facets a tab owns", () => {
    expect([...TAB_FACETS]).toEqual(["kind", "employment", "joined"]);
  });
});

describe("employeeTabState", () => {
  it("sets this tab's filter and page 1", () => {
    const r = employeeTabState(parse("page=3"), false, "client");
    expect(r.state.filters).toEqual({ kind: ["CLIENT"] });
    expect(r.state.page).toBe(1);
    expect(r.gapsOnly).toBe(false);
  });
  it("maps each tab to its own filter", () => {
    expect(employeeTabState(parse(""), false, "internal").state.filters).toEqual({ kind: ["INTERNAL"] });
    expect(employeeTabState(parse(""), false, "leaving").state.filters).toEqual({ employment: ["OFFBOARDING"] });
    expect(employeeTabState(parse(""), false, "joined").state.filters).toEqual({ joined: ["month"] });
    const gaps = employeeTabState(parse(""), false, "gaps");
    expect(gaps.state.filters).toEqual({});
    expect(gaps.gapsOnly).toBe(true);
  });
  it("clears the other tabs' filters and gaps", () => {
    const r = employeeTabState(parse("kind=CLIENT&employment=OFFBOARDING&joined=month"), true, "internal");
    expect(r.state.filters).toEqual({ kind: ["INTERNAL"] });
    expect(r.gapsOnly).toBe(false);
  });
  it("keeps the search, Works for, leavers, sort and per", () => {
    const r = employeeTabState(parse("q=mar&department=d1&leavers=1&sort=-joinedAt&per=50&kind=CLIENT"), false, "leaving");
    expect(r.state.q).toBe("mar");
    expect(r.state.per).toBe(50);
    expect(r.state.sort).toEqual([{ key: "joinedAt", dir: "desc" }]);
    expect(r.state.filters).toEqual({ department: ["d1"], leavers: ["1"], employment: ["OFFBOARDING"] });
  });
  it("All, and any unknown key, clears every tab filter and gaps", () => {
    for (const key of ["all", "nope"]) {
      const r = employeeTabState(parse("kind=CLIENT&joined=month&department=d1"), true, key);
      expect(r.state.filters).toEqual({ department: ["d1"] });
      expect(r.gapsOnly).toBe(false);
    }
  });
});

describe("buildEmployeeTabs", () => {
  it("All is on when no tab filter is set and gaps is off", () => {
    expect(onKeys("")).toEqual(["all"]);
    expect(onKeys("q=x&department=d1&leavers=1&sort=-name")).toEqual(["all"]);
  });
  it("exactly one tab is on when exactly its filter is set", () => {
    expect(onKeys("kind=CLIENT")).toEqual(["client"]);
    expect(onKeys("kind=INTERNAL")).toEqual(["internal"]);
    expect(onKeys("employment=OFFBOARDING")).toEqual(["leaving"]);
    expect(onKeys("joined=month")).toEqual(["joined"]);
    expect(onKeys("", true)).toEqual(["gaps"]);
  });
  it("employment=OFFBOARDED leaves every tab off", () => {
    expect(onKeys("employment=OFFBOARDED")).toEqual([]);
    expect(onKeys("employment=ACTIVE")).toEqual([]);
  });
  it("two kinds leave every tab off", () => {
    expect(onKeys("kind=CLIENT,INTERNAL")).toEqual([]);
  });
  it("gaps plus kind leaves every tab off", () => {
    expect(onKeys("kind=CLIENT", true)).toEqual([]);
  });
  it("two tab filters together leave every tab off", () => {
    expect(onKeys("kind=CLIENT&joined=month")).toEqual([]);
  });
  it("carries each count, and 0 for a missing one", () => {
    expect(tabsFor("").map((t) => t.count)).toEqual([570, 400, 170, 7, 31, 12]);
    expect(buildEmployeeTabs(parse(""), false, {}, hrefFor).map((t) => t.count)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("each href is that tab's filter on and every other off, at page 1", () => {
    const tabs = buildEmployeeTabs(parse("q=mar&kind=CLIENT&page=4"), false, counts, hrefFor);
    expect(Object.fromEntries(tabs.map((t) => [t.key, t.href]))).toEqual({
      all: "?q=mar",
      client: "?q=mar&kind=CLIENT",
      internal: "?q=mar&kind=INTERNAL",
      leaving: "?q=mar&employment=OFFBOARDING",
      gaps: "?q=mar&gaps=1",
      joined: "?q=mar&joined=month",
    });
  });
});
