import { describe, expect, it } from "vitest";
import { buildEmployeeOrderBy, buildEmployeeWhere, EMPLOYEES_LIST_CONFIG, orderByLoadout } from "./employees-list";
import { monthStartManila } from "./cris-limits";
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
  // Phase 37 (spec §2.3): the Staff facet filters on the group's kind.
  it("maps the kind facet to department.kind and drops values that are not a kind", () => {
    expect(buildEmployeeWhere(parse("kind=CLIENT")).department).toEqual({ kind: { in: ["CLIENT"] } });
    expect(buildEmployeeWhere(parse("kind=CLIENT,INTERNAL")).department).toEqual({ kind: { in: ["CLIENT", "INTERNAL"] } });
    expect(buildEmployeeWhere(parse("kind=BOGUS")).department).toBeUndefined();
  });

  // Phase 45 (spec §3.1): the "New this month" tab.
  describe("joined=month", () => {
    // 2026-10-20 in Manila; the Manila month began at 2026-09-30T16:00Z
    const now = new Date("2026-10-20T03:00:00Z");
    it("keeps people who joined on or after the Manila month start", () => {
      const where = buildEmployeeWhere(parse("joined=month"), now);
      expect(where.joinedAt).toEqual({ gte: monthStartManila(now) });
      expect(monthStartManila(now).toISOString()).toBe("2026-09-30T16:00:00.000Z");
    });
    it("alongside the leavers default", () => {
      expect(buildEmployeeWhere(parse("joined=month"), now)).toEqual({
        joinedAt: { gte: monthStartManila(now) }, employment: { not: "OFFBOARDED" },
      });
    });
    it("defaults now to the current time", () => {
      const gte = (buildEmployeeWhere(parse("joined=month")).joinedAt as { gte: Date }).gte;
      expect(gte.getTime()).toBe(monthStartManila(new Date()).getTime());
    });
    it("any other value is dropped by the parser, so adds no clause", () => {
      expect(buildEmployeeWhere(parse("joined=year"), now).joinedAt).toBeUndefined();
      expect(buildEmployeeWhere(parse(""), now).joinedAt).toBeUndefined();
    });
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
      expect(EMPLOYEES_LIST_CONFIG.facets).toEqual(["department", "kind", "employment", "leavers", "joined"]);
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
