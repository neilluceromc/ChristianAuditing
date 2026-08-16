import { describe, expect, it } from "vitest";
import { buildEmployeeWhere, EMPLOYEES_LIST_CONFIG } from "./employees-list";
import { parseListState } from "./url-state";

const parse = (qs: string) => parseListState(new URLSearchParams(qs), EMPLOYEES_LIST_CONFIG);

describe("buildEmployeeWhere", () => {
  it("q searches name, employeeNo and title", () => {
    expect(buildEmployeeWhere(parse("q=mar"))).toEqual({
      OR: [
        { name: { contains: "mar", mode: "insensitive" } },
        { employeeNo: { contains: "mar", mode: "insensitive" } },
        { title: { contains: "mar", mode: "insensitive" } },
      ],
    });
  });
  it("maps facets and drops invalid employment values", () => {
    const where = buildEmployeeWhere(parse("department=d1&employment=ACTIVE,BOGUS"));
    expect(where.departmentId).toEqual({ in: ["d1"] });
    expect(where.employment).toEqual({ in: ["ACTIVE"] });
  });
  it("empty state → empty where", () => {
    expect(buildEmployeeWhere(parse(""))).toEqual({});
  });
});
