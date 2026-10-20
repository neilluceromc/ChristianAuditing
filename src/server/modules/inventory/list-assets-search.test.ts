import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Spec §7.2 (2026-10-21): while the Inventory list is searched, the rows whose tag, model, serial or holder START
 * with the search come first, then the ones that only contain it, each group in the chosen sort — and the paging
 * stays correct across the boundary. A tiny in-memory Prisma: where (AND / OR / NOT, equality, contains, id in /
 * notIn, to-one relations), orderBy, skip and take.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({ assets: [] as Record<string, unknown>[], findMany: vi.fn(), count: vi.fn() }));

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
      return v !== null && typeof v === "object" && matches(v as Row, c);
    }
    return v === cond;
  });
}

function ordered(rows: Row[], orderBy: Array<Record<string, unknown>>): Row[] {
  const val = (r: Row, o: Record<string, unknown>): [unknown, string] => {
    const [k, d] = Object.entries(o)[0];
    if (typeof d === "object" && d !== null) {
      const [k2, d2] = Object.entries(d as Row)[0];
      return [(r[k] as Row | null)?.[k2], d2 as string];
    }
    return [r[k], d as string];
  };
  return [...rows].sort((a, b) => {
    for (const o of orderBy) {
      const [x, dir] = val(a, o);
      const [y] = val(b, o);
      if (x === y) continue;
      const c = String(x) < String(y) ? -1 : 1;
      return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

vi.mock("@/server/db/client", () => {
  const client = {
    asset: { findMany: h.findMany, count: h.count },
    $transaction: (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});

import { listAssets } from "./queries";
import { parseListState } from "@/lib/url-state";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";

const NOW = new Date("2026-10-21T04:00:00.000Z");

function asset(tag: string, model: string, extra: Row = {}): Row {
  return {
    id: `id-${tag}`, tag, model, serial: null, cls: "IT", status: "SPARE",
    returnedAt: null, loanDueAt: null, itVerifiedAt: NOW, financeConfirmedAt: null, financeReturnedAt: null,
    financeNotCapitalised: false, financeReturnFields: [], financeReturnReason: null, financeReturnedBy: null,
    purchasedAt: null, warrantyUntil: null, defectiveSince: null, repairEndedAt: null, vendorId: null, rmaRef: null,
    cost: null, repairQuote: null, category: { name: "Laptops" }, assignee: null, reservations: [], approvals: [],
    ...extra,
  };
}
const holder = (name: string) => ({ assignee: { id: `e-${name}`, name, employeeNo: "EMP-0001" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.assets = [
    asset("BR-LT-0005", "HP ProBook", holder("Noel Reyes")), // contains "el" (holder)
    asset("BR-LT-0001", "Dell Latitude"), // contains (model)
    asset("ELX-0007", "Monitor"), // starts (tag)
    asset("BR-LT-0003", "ThinkPad", holder("Ella Cruz")), // starts (holder)
    asset("BR-LT-0006", "MacBook"), // no match
    asset("BR-LT-0004", "Dell XPS", { serial: "EL-9" }), // starts (serial)
    asset("BR-LT-0002", "Elitebook 840"), // starts (model)
  ];
  h.findMany.mockImplementation(async ({ where, orderBy, skip, take }: { where: Row; orderBy?: Row[]; skip?: number; take?: number }) => {
    const rows = ordered(h.assets.filter((a) => matches(a, where)), (orderBy ?? []) as Array<Record<string, unknown>>);
    return rows.slice(skip ?? 0, take === undefined ? undefined : (skip ?? 0) + take);
  });
  h.count.mockResolvedValue(0); // the attention count line: not under test here
});

const state = (qs: string, per = 25) => ({ ...parseListState(new URLSearchParams(qs), INVENTORY_LIST_CONFIG), per });

describe("listAssets — starts-with first while searching", () => {
  it("\"el\" lists the tag, model, serial and holder starts-with matches first, then the rest, each in tag order", async () => {
    const r = await listAssets(state("q=el"), null, "IT", NOW);
    expect(r.total).toBe(6);
    expect(r.rows.map((x) => x.tag)).toEqual(["BR-LT-0002", "BR-LT-0003", "BR-LT-0004", "ELX-0007", "BR-LT-0001", "BR-LT-0005"]);
  });

  it("keeps the chosen sort inside each group (tag Z–A)", async () => {
    const r = await listAssets(state("q=el&sort=-tag"), null, "IT", NOW);
    expect(r.rows.map((x) => x.tag)).toEqual(["ELX-0007", "BR-LT-0004", "BR-LT-0003", "BR-LT-0002", "BR-LT-0005", "BR-LT-0001"]);
  });

  it("pages across the boundary without losing or repeating a row", async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await listAssets({ ...state("q=el", 2), page }, null, "IT", NOW);
      expect(r.pageCount).toBe(3);
      seen.push(...r.rows.map((x) => x.tag));
    }
    expect(seen).toEqual(["BR-LT-0002", "BR-LT-0003", "BR-LT-0004", "ELX-0007", "BR-LT-0001", "BR-LT-0005"]);
  });

  it("the Attention sort ranks the same way, in memory", async () => {
    const r = await listAssets(state("q=el&sort=attention"), null, "IT", NOW);
    expect(r.rows.slice(0, 4).map((x) => x.tag).sort()).toEqual(["BR-LT-0002", "BR-LT-0003", "BR-LT-0004", "ELX-0007"]);
    expect(r.rows.slice(4).map((x) => x.tag).sort()).toEqual(["BR-LT-0001", "BR-LT-0005"]);
  });

  it("without a search the list is the plain SQL order and page", async () => {
    h.count.mockResolvedValue(7);
    const r = await listAssets(state(""), null, "IT", NOW);
    expect(r.rows.map((x) => x.tag)).toEqual(["BR-LT-0001", "BR-LT-0002", "BR-LT-0003", "BR-LT-0004", "BR-LT-0005", "BR-LT-0006", "ELX-0007"]);
  });
});
