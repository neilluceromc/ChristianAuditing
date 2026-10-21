import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Spec §7.2 (2026-10-21): while the Employees list is searched, the people whose name or employee no. START with the
 * search come first, then the ones that only contain it (in a name, employee no., title or group), each group in the
 * chosen sort, and the paging stays correct across the boundary. A tiny in-memory Prisma does the reads.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({ people: [] as Record<string, unknown>[], findMany: vi.fn(), count: vi.fn() }));

function matches(row: Row | null | undefined, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Row[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as Row[]).some((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Row);
    const v = row?.[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("contains" in c) return typeof v === "string" && v.toLowerCase().includes(String(c.contains).toLowerCase());
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(v);
      if ("not" in c) return v !== c.not;
      return v !== null && typeof v === "object" && matches(v as Row, c);
    }
    return v === cond;
  });
}

function ordered(rows: Row[], orderBy: Array<Record<string, string>>): Row[] {
  return [...rows].sort((a, b) => {
    for (const o of orderBy) {
      const [k, dir] = Object.entries(o)[0];
      if (a[k] === b[k]) continue;
      const c = String(a[k]) < String(b[k]) ? -1 : 1;
      return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

vi.mock("@/server/db/client", () => {
  const client = {
    employee: { findMany: h.findMany, count: h.count },
    equipmentPolicy: { findMany: async () => [] },
    employeeSlotException: { findMany: async () => [] },
    $transaction: (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});

import { listEmployees } from "./queries";
import { parseListState } from "@/lib/url-state";
import { EMPLOYEES_LIST_CONFIG } from "@/lib/employees-list";

const NOW = new Date("2026-10-21T04:00:00.000Z");
let seq = 0;
function person(name: string, extra: Row = {}): Row {
  seq++;
  return {
    id: `p${seq}`, name, employeeNo: `N-${String(seq).padStart(4, "0")}` /* not EMP-: "E" would start every one */, title: "Agent", departmentId: "d1",
    department: { id: "d1", name: "Acme Support", kind: "CLIENT" }, employment: "ACTIVE", m365Status: null,
    joinedAt: new Date(Date.UTC(2025, 0, seq)), assets: [], ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  h.people = [
    person("Joel Santos"), // contains "e"
    person("Ella Cruz"), // starts
    person("Rene Uy"), // contains
    person("Eve Ramos"), // starts
    person("Abe Lim"), // contains
    person("Mark Tan", { title: "Engineer" }), // contains (title only)
    person("Carl Go", { employeeNo: "E-0042" }), // starts (employee no.)
    person("Zed Ong", { employment: "OFFBOARDED" }), // a leaver: hidden by default
  ];
  h.findMany.mockImplementation(async ({ where, orderBy, skip, take }: { where: Row; orderBy?: Array<Record<string, string>>; skip?: number; take?: number }) => {
    const rows = ordered(h.people.filter((p) => matches(p, where)), orderBy ?? []);
    return rows.slice(skip ?? 0, take === undefined ? undefined : (skip ?? 0) + take);
  });
  h.count.mockImplementation(async ({ where }: { where: Row }) => h.people.filter((p) => matches(p, where)).length);
});

const state = (qs: string, per = 25) => ({ ...parseListState(new URLSearchParams(qs), EMPLOYEES_LIST_CONFIG), per });
const names = (r: Awaited<ReturnType<typeof listEmployees>>) => r.rows.map((x) => x.name);

describe("listEmployees — starts-with first while searching", () => {
  it("\"E\" puts the names starting with E first, then the employee nos., then the rest, each in name order", async () => {
    const r = await listEmployees(state("q=E"), false, NOW);
    expect(r.total).toBe(7);
    expect(names(r)).toEqual(["Ella Cruz", "Eve Ramos", "Carl Go", "Abe Lim", "Joel Santos", "Mark Tan", "Rene Uy"]);
  });

  it("with real EMP- numbers (every one starts with E), \"E\" still puts the E names first", async () => {
    for (const p of h.people) p.employeeNo = `EMP-${String(p.id).slice(1).padStart(4, "0")}`;
    const r = await listEmployees(state("q=E"), false, NOW);
    expect(names(r)).toEqual(["Ella Cruz", "Eve Ramos", "Abe Lim", "Carl Go", "Joel Santos", "Mark Tan", "Rene Uy"]);
  });

  it("keeps the chosen sort inside each group (name Z–A)", async () => {
    const r = await listEmployees(state("q=E&sort=-name"), false, NOW);
    expect(names(r)).toEqual(["Eve Ramos", "Ella Cruz", "Carl Go", "Rene Uy", "Mark Tan", "Joel Santos", "Abe Lim"]);
  });

  it("pages across the boundary without losing or repeating anyone", async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await listEmployees({ ...state("q=E", 3), page }, false, NOW);
      expect(r.pageCount).toBe(3);
      seen.push(...names(r));
    }
    expect(seen).toEqual(["Ella Cruz", "Eve Ramos", "Carl Go", "Abe Lim", "Joel Santos", "Mark Tan", "Rene Uy"]);
  });

  it("the Loadout sort's in-memory path ranks the same way", async () => {
    const r = await listEmployees(state("q=E&sort=loadout"), false, NOW);
    expect(names(r).slice(0, 2).sort()).toEqual(["Ella Cruz", "Eve Ramos"]);
    expect(names(r)[2]).toBe("Carl Go");
    expect(names(r).slice(3).sort()).toEqual(["Abe Lim", "Joel Santos", "Mark Tan", "Rene Uy"]);
  });

  it("without a search the list is the plain name order", async () => {
    const r = await listEmployees(state(""), false, NOW);
    expect(names(r)).toEqual(["Abe Lim", "Carl Go", "Ella Cruz", "Eve Ramos", "Joel Santos", "Mark Tan", "Rene Uy"]);
  });
});
