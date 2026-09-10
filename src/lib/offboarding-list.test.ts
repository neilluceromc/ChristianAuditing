import { describe, expect, it } from "vitest";
import {
  OFFBOARDING_LIST_CONFIG, buildOffboardingOrderBy, buildOffboardingWhere, progressOf, sortByUndecided,
} from "./offboarding-list";
import { parseListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), OFFBOARDING_LIST_CONFIG);

describe("OFFBOARDING_LIST_CONFIG", () => {
  it("facets department and progress, sorts by name/started/undecided, defaults to name asc", () => {
    expect(OFFBOARDING_LIST_CONFIG.facets).toEqual(["department", "progress"]);
    expect(OFFBOARDING_LIST_CONFIG.sortable).toEqual(["name", "started", "undecided"]);
    expect(OFFBOARDING_LIST_CONFIG.defaultSort).toEqual([{ key: "name", dir: "asc" }]);
  });
});

describe("buildOffboardingWhere", () => {
  it("is always scoped to OFFBOARDING employment", () => {
    expect(buildOffboardingWhere(parse(""))).toEqual({ employment: "OFFBOARDING" });
  });

  it("adds department IN when the facet is set", () => {
    expect(buildOffboardingWhere(parse("department=d1,d2"))).toEqual({
      employment: "OFFBOARDING", departmentId: { in: ["d1", "d2"] },
    });
  });
});

describe("buildOffboardingOrderBy", () => {
  it("sorts by name, then employeeNo, then id", () => {
    expect(buildOffboardingOrderBy([{ key: "name", dir: "asc" }])).toEqual([
      { name: "asc" }, { employeeNo: "asc" }, { id: "asc" },
    ]);
  });

  it("maps 'started' to offboardingAt", () => {
    expect(buildOffboardingOrderBy([{ key: "started", dir: "desc" }])).toEqual([
      { offboardingAt: "desc" }, { employeeNo: "asc" }, { id: "asc" },
    ]);
  });

  it("is null for 'undecided' — that sort is applied in memory", () => {
    expect(buildOffboardingOrderBy([{ key: "undecided", dir: "asc" }])).toBeNull();
  });

  it("falls back to the default sort", () => {
    expect(buildOffboardingOrderBy([])).toEqual([{ name: "asc" }, { employeeNo: "asc" }, { id: "asc" }]);
  });
});

describe("progressOf", () => {
  it("complete at zero undecided, open otherwise", () => {
    expect(progressOf(0)).toBe("complete");
    expect(progressOf(2)).toBe("open");
  });
});

describe("sortByUndecided", () => {
  const row = (name: string, employeeNo: string, undecided: number) => ({ name, employeeNo, undecided });

  it("sorts by undecided count ascending, then name, then employeeNo — stable across ties", () => {
    const rows = [row("Bea", "EMP-0002", 1), row("Ana", "EMP-0001", 3), row("Cid", "EMP-0003", 1)];
    expect(sortByUndecided(rows, "asc").map((r) => r.employeeNo)).toEqual(["EMP-0002", "EMP-0003", "EMP-0001"]);
  });

  it("reverses the undecided order for desc, keeping the name/employeeNo tiebreak ascending", () => {
    const rows = [row("Bea", "EMP-0002", 1), row("Ana", "EMP-0001", 1), row("Cid", "EMP-0003", 3)];
    expect(sortByUndecided(rows, "desc").map((r) => r.employeeNo)).toEqual(["EMP-0003", "EMP-0001", "EMP-0002"]);
  });
});
