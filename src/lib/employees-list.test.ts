import { describe, expect, it } from "vitest";
import { buildEmployeeOrderBy, buildEmployeeWhere, EMPLOYEES_LIST_CONFIG, orderByLoadout } from "./employees-list";
import { parseListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), EMPLOYEES_LIST_CONFIG);

describe("buildEmployeeWhere", () => {
  it("q searches name, employeeNo and title, alongside the leavers-hidden default", () => {
    expect(buildEmployeeWhere(parse("q=mar"))).toEqual({
      OR: [
        { name: { contains: "mar", mode: "insensitive" } },
        { employeeNo: { contains: "mar", mode: "insensitive" } },
        { title: { contains: "mar", mode: "insensitive" } },
        { department: { name: { contains: "mar", mode: "insensitive" } } },
      ],
      employment: { not: "OFFBOARDED" },
    });
  });
  it("maps facets and drops invalid employment values", () => {
    const where = buildEmployeeWhere(parse("department=d1&employment=ACTIVE,BOGUS"));
    expect(where.departmentId).toEqual({ in: ["d1"] });
    expect(where.employment).toEqual({ in: ["ACTIVE"] });
  });

  // Phase 20 (spec §5): leavers are hidden by default.
  describe("leavers hidden by default", () => {
    it("empty state excludes OFFBOARDED", () => {
      expect(buildEmployeeWhere(parse(""))).toEqual({ employment: { not: "OFFBOARDED" } });
    });
    it("leavers=1 drops the default — no employment clause at all", () => {
      expect(buildEmployeeWhere(parse("leavers=1"))).toEqual({});
    });
    it("an explicit employment facet wins over the default, even without leavers=1", () => {
      expect(buildEmployeeWhere(parse("employment=OFFBOARDED"))).toEqual({ employment: { in: ["OFFBOARDED"] } });
    });
    it("an explicit employment facet wins even when leavers=1 is also set", () => {
      expect(buildEmployeeWhere(parse("employment=ACTIVE&leavers=1"))).toEqual({ employment: { in: ["ACTIVE"] } });
    });
    it("facets include leavers, so the toggle round-trips through the URL", () => {
      expect(EMPLOYEES_LIST_CONFIG.facets).toEqual(["department", "employment", "leavers"]);
    });
  });
});

describe("buildEmployeeOrderBy", () => {
  it("applies both sort keys then the id tiebreaker", () => {
    expect(buildEmployeeOrderBy([{ key: "joinedAt", dir: "desc" }, { key: "name", dir: "asc" }]))
      .toEqual([{ joinedAt: "desc" }, { name: "asc" }, { id: "asc" }]);
  });
  it("falls back to the default sort", () => {
    expect(buildEmployeeOrderBy([])).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(EMPLOYEES_LIST_CONFIG.defaultSort).toEqual([{ key: "name", dir: "asc" }]);
  });
  it("the derived 'loadout' key is filtered out, falling back to the default order (plan P-4)", () => {
    expect(buildEmployeeOrderBy([{ key: "loadout", dir: "asc" }])).toEqual(buildEmployeeOrderBy([]));
  });
});

describe("the Loadout sort key (spec decision 8)", () => {
  it("is declared sortable and never reaches buildEmployeeOrderBy", () => {
    expect(EMPLOYEES_LIST_CONFIG.sortable).toEqual(["name", "employeeNo", "joinedAt", "loadout"]);
  });
  const rows = [
    { id: "1", name: "Ana", missingRequired: 0 }, { id: "2", name: "Ben", missingRequired: 3 },
    { id: "3", name: "Cy", missingRequired: null }, { id: "4", name: "Dee", missingRequired: 1 }, { id: "5", name: "Eve", missingRequired: 3 },
  ];
  it("ascending completeness: most gaps first, ties by name, no policy last", () => {
    expect(orderByLoadout(rows, "asc").map((r) => r.id)).toEqual(["2", "5", "4", "1", "3"]);
  });
  it("descending: fewest gaps first, no policy still last", () => {
    expect(orderByLoadout(rows, "desc").map((r) => r.id)).toEqual(["1", "4", "2", "5", "3"]);
  });
});
