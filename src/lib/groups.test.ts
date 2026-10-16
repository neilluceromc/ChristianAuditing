import { describe, expect, it } from "vitest";
import { filterGroups, groupPickerOptions, showCounts, sortGroups, type GroupRow } from "./groups";

const row = (o: Partial<GroupRow> & { name: string }): GroupRow => ({ id: o.name, kind: "CLIENT", archivedAt: null, locked: false, people: 0, policyItems: null, ...o });
const rows = [
  row({ name: "[Client 10]", people: 5, policyItems: 3 }),
  row({ name: "[Client 2]", people: 9 }),
  row({ name: "[Client 3]", archivedAt: "2026-10-01T00:00:00.000Z" }),
  row({ name: "Finance", kind: "INTERNAL", people: 4, policyItems: 6 }),
];

describe("filterGroups", () => {
  it("Active hides archived and the other kind", () => {
    expect(filterGroups(rows, { kind: "CLIENT", q: "", show: "active" }).map((r) => r.name)).toEqual(["[Client 10]", "[Client 2]"]);
  });
  it("No policy is active rows without a policy", () => {
    expect(filterGroups(rows, { kind: "CLIENT", q: "", show: "nopol" }).map((r) => r.name)).toEqual(["[Client 2]"]);
  });
  it("Ended is archived only; All is everything of the kind", () => {
    expect(filterGroups(rows, { kind: "CLIENT", q: "", show: "ended" }).map((r) => r.name)).toEqual(["[Client 3]"]);
    expect(filterGroups(rows, { kind: "CLIENT", q: "", show: "all" })).toHaveLength(3);
  });
  it("search is a case-insensitive substring, trimmed", () => {
    expect(filterGroups(rows, { kind: "INTERNAL", q: "  FIN ", show: "all" }).map((r) => r.name)).toEqual(["Finance"]);
  });
});

describe("sortGroups", () => {
  it("sorts names naturally", () => {
    expect(sortGroups(rows.slice(0, 3), "name", 1).map((r) => r.name)).toEqual(["[Client 2]", "[Client 3]", "[Client 10]"]);
  });
  it("sorts people descending", () => {
    expect(sortGroups(rows.slice(0, 2), "people", -1).map((r) => r.name)).toEqual(["[Client 2]", "[Client 10]"]);
  });
});

describe("showCounts", () => {
  it("counts each filter for one kind", () => {
    expect(showCounts(rows, "CLIENT")).toEqual({ active: 2, nopol: 1, ended: 1, all: 3 });
  });
});

describe("groupPickerOptions", () => {
  it("splits by kind, active only, natural order, keeping the current value", () => {
    const o = groupPickerOptions(rows, "[Client 3]");
    expect(o.internal.map((r) => r.name)).toEqual(["Finance"]);
    expect(o.client.map((r) => r.name)).toEqual(["[Client 2]", "[Client 3]", "[Client 10]"]);
    expect(groupPickerOptions(rows).client.map((r) => r.name)).toEqual(["[Client 2]", "[Client 10]"]);
  });
});
