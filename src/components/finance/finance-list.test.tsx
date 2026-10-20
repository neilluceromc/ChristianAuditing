import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CategoryTile, FinanceListState, LifeStage } from "@/lib/finance-list";
import { CategoryTiles, StatusTiles, categoryGridClass } from "./category-tiles";
import { FinanceTabs, financeTabDefs } from "./finance-tabs";
import { FinanceToolbar, controlHref } from "./finance-toolbar";
import { MoneyTotals } from "./money-totals";
import { LifeCell } from "./life-cell";
import { FinanceTable } from "./finance-table";
import type { FinanceRow } from "@/server/modules/finance/queries";

// NavLink and the toolbar reach for the router; markup tests never navigate.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The row menu's override dialog calls server actions (auth, db); markup tests never submit.
vi.mock("@/server/modules/finance/depreciation-actions", () => ({ setAssetOverride: vi.fn(), clearAssetOverride: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

/*
 * Phase 47 (Task 5, spec §3): the Finance → Assets list's parts — the category grid's columns, the finance-state tabs'
 * badge tones, the URL each toolbar control builds, the money cards' sublines and the Life used cell.
 */

const S: FinanceListState = {
  cls: "IT", category: null, status: null, fin: null, q: "", life: null, sort: "book", page: 1, per: 25,
};

const tile = (id: string, over: Partial<CategoryTile> = {}): CategoryTile =>
  ({ id, name: id === "all" ? "All categories" : `Cat ${id}`, count: 3, bookC: 1_234_567_89, costC: 2_000_000_00, on: false, ...over });

/** The class list of the element carrying `attr`. */
const classOf = (html: string, attr: string) => html.match(new RegExp(`<[^>]*${attr}[^>]*class="([^"]*)"|<[^>]*class="([^"]*)"[^>]*${attr}`))?.slice(1).find(Boolean)?.split(/\s+/) ?? [];

describe("category grid columns (spec §3 item 3)", () => {
  it("6 on desktop, 4 up to 1000 px, 2 at phone width", () => {
    for (const n of [6, 7, 12, 18]) {
      const c = categoryGridClass(n).split(" ");
      expect(c).toEqual(expect.arrayContaining(["grid-cols-2", "sm:grid-cols-4", "min-[1001px]:grid-cols-6"]));
    }
  });
  it("five or fewer tiles: one row of exactly that many columns (two at phone width)", () => {
    expect(categoryGridClass(5).split(" ")).toEqual(expect.arrayContaining(["grid-cols-2", "sm:grid-cols-5"]));
    expect(categoryGridClass(5)).not.toContain("grid-cols-6");
    expect(categoryGridClass(4).split(" ")).toEqual(expect.arrayContaining(["grid-cols-2", "sm:grid-cols-4"]));
    expect(categoryGridClass(3).split(" ")).toEqual(expect.arrayContaining(["grid-cols-2", "sm:grid-cols-3"]));
    expect(categoryGridClass(2).split(" ")).toContain("grid-cols-2");
    expect(categoryGridClass(1).split(" ")).toContain("grid-cols-1");
  });
  it("is a grid that never scrolls sideways", () => {
    const html = renderToStaticMarkup(<CategoryTiles tiles={[tile("all", { on: true }), tile("c1")]} state={S} />);
    const nav = classOf(html, 'aria-label="Filter by category"');
    expect(nav).toContain("grid");
    expect(nav.join(" ")).not.toMatch(/overflow-x-(auto|scroll)/);
  });
});

describe("CategoryTiles", () => {
  const tiles = [tile("all"), tile("c1", { on: true }), tile("c2"), tile("other", { name: "Other" })];
  const html = renderToStaticMarkup(<CategoryTiles tiles={tiles} state={{ ...S, category: "c1", q: "dell", page: 3 }} />);
  it("shows name, count and book value, the cost on hover", () => {
    expect(html).toContain("Cat c2");
    expect(html).toContain("₱1,234,568");
    expect(html).toContain('title="Cat c2 · cost ₱2,000,000.00 · book value ₱1,234,567.89"');
  });
  it("one at a time: a tile sets ?category=, the lit one clears it, other filters kept, page 1", () => {
    expect(html).toMatch(/<a [^>]*aria-current="true"[^>]*href="\/finance\/assets\?q=dell"/);
    expect(html).toContain('href="/finance/assets?category=c2&amp;q=dell"');
    expect(html).toContain('href="/finance/assets?category=other&amp;q=dell"');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });
  it("a folded category lights Other, and clicking the lit Other clears the category", () => {
    const folded = [tile("all"), tile("c1"), tile("other", { name: "Other", on: true })];
    const h = renderToStaticMarkup(<CategoryTiles tiles={folded} state={{ ...S, category: "c9" }} />);
    expect(h).toMatch(/<a [^>]*aria-current="true"[^>]*href="\/finance\/assets"[^>]*>[\s\S]*?Other/);
  });
});

describe("StatusTiles (the Phase 45 count tiles plus book value)", () => {
  const html = renderToStaticMarkup(
    <StatusTiles
      tiles={[{ status: "SPARE", count: 4, bookC: 50_000_00 }, { status: "DEPLOYED", count: 1200, bookC: 0 }]}
      state={{ ...S, status: "DEPLOYED", category: "c1" }}
    />,
  );
  it("count, caption and book value; the pressed one clears the status", () => {
    expect(html).toContain("In stock");
    expect(html).toContain("Spare, ready to assign");
    expect(html).toContain("1,200");
    expect(html).toContain("₱50,000");
    expect(html).toMatch(/<a [^>]*aria-current="true"[^>]*href="\/finance\/assets\?category=c1"/);
    expect(html).toContain('href="/finance/assets?category=c1&amp;status=SPARE"');
  });
});

describe("finance-state tabs (spec §3 item 5)", () => {
  const counts = (n: number) => [
    { key: "all" as const, count: 20 }, { key: "with-finance" as const, count: n }, { key: "needs-correction" as const, count: n },
    { key: "awaiting-it" as const, count: n }, { key: "approved" as const, count: 9 },
    { key: "not-capitalised" as const, count: 1 }, { key: "no-cost" as const, count: 0 },
  ];
  it("To review is amber and Sent back red when above 0; neutral at 0", () => {
    const tabs = financeTabDefs(S, counts(2));
    expect(tabs.find((t) => t.key === "with-finance")!.tone).toBe("attention");
    expect(tabs.find((t) => t.key === "needs-correction")!.tone).toBe("fault");
    expect(tabs.filter((t) => t.tone).map((t) => t.key)).toEqual(["with-finance", "needs-correction"]);
    const zero = financeTabDefs(S, counts(0));
    expect(zero.every((t) => t.tone === undefined)).toBe(true);
  });
  it("labels and hrefs: All clears fin; each tab sets it and keeps the other filters", () => {
    const tabs = financeTabDefs({ ...S, fin: "approved", q: "x", page: 2 }, counts(1));
    expect(tabs.map((t) => t.label)).toEqual(["All", "To review", "Sent back", "Waiting for IT", "Approved", "Not capitalised", "No cost"]);
    expect(tabs[0].href).toBe("/finance/assets?q=x");
    expect(tabs.find((t) => t.key === "with-finance")!.href).toBe("/finance/assets?fin=with-finance&q=x");
    expect(tabs.filter((t) => t.on).map((t) => t.key)).toEqual(["approved"]);
  });
  it("renders the red badge through the shared tabs", () => {
    const html = renderToStaticMarkup(<FinanceTabs state={S} counts={counts(3)} />);
    expect(html).toContain('<nav aria-label="Finance state"');
    expect(html).toContain("bg-(--st-fault-bg)");
    expect(html).toContain("bg-(--st-attention-bg)");
  });
});

describe("FinanceToolbar: the URL each control builds", () => {
  const s: FinanceListState = { ...S, cls: "PURCHASING", category: "c1", fin: "approved", q: "desk", sort: "tag", page: 4, per: 50 };
  it("search", () => {
    expect(controlHref(s, "q", "  chair ")).toBe("/finance/assets?cls=PURCHASING&category=c1&fin=approved&q=chair&sort=tag&per=50");
    expect(controlHref(s, "q", "")).toBe("/finance/assets?cls=PURCHASING&category=c1&fin=approved&sort=tag&per=50");
  });
  it("category", () => {
    expect(controlHref(s, "category", "other")).toBe("/finance/assets?cls=PURCHASING&category=other&fin=approved&q=desk&sort=tag&per=50");
    expect(controlHref(s, "category", "")).toBe("/finance/assets?cls=PURCHASING&fin=approved&q=desk&sort=tag&per=50");
  });
  it("life", () => {
    expect(controlHref(s, "life", "soon")).toBe("/finance/assets?cls=PURCHASING&category=c1&fin=approved&q=desk&life=soon&sort=tag&per=50");
    expect(controlHref(s, "life", "")).toBe("/finance/assets?cls=PURCHASING&category=c1&fin=approved&q=desk&sort=tag&per=50");
  });
  it("sort (book value is the default, so it is not written)", () => {
    expect(controlHref(s, "sort", "life")).toBe("/finance/assets?cls=PURCHASING&category=c1&fin=approved&q=desk&sort=life&per=50");
    expect(controlHref(s, "sort", "book")).toBe("/finance/assets?cls=PURCHASING&category=c1&fin=approved&q=desk&per=50");
  });
  it("renders search, the three selects and the shown count with its book value", () => {
    const html = renderToStaticMarkup(
      <FinanceToolbar
        state={{ ...S, category: "c9", life: "full" }}
        tiles={[{ id: "c1", name: "Laptops" }, { id: "other", name: "Other" }]}
        categoryLabel="Webcams"
        shown={{ count: 1234, bookC: 9_876_543_21 }}
      />,
    );
    // the shared SearchBox (search-box.tsx), sized for the toolbar
    expect(html).toContain('aria-label="Search assets"');
    expect(html).toMatch(/<div class="relative w-full max-w-\[340px\] flex-1 basis-\[240px\]">/);
    // each select is named by its visible label alone (no aria-label to drift from it)
    for (const label of ["Category", "Life", "Sort"]) {
      const id = html.match(new RegExp(`<label for="([^"]+)"[^>]*>${label}</label>`))?.[1];
      expect(id).toBeTruthy();
      expect(html).toMatch(new RegExp(`<select[^>]*id="${id}"`));
    }
    expect(html).not.toMatch(/<select[^>]*aria-label=/);
    // a folded category shows by its own name, selected
    expect(html).toMatch(/<option value="c9" selected="">Webcams<\/option>/);
    expect(html).toMatch(/<option value="full" selected="">Fully depreciated<\/option>/);
    expect(html).toContain("1,234");
    expect(html).toContain("assets shown");
    expect(html).toContain("₱9,876,543.21");
  });
});

describe("MoneyTotals (spec §3 item 2)", () => {
  const kpis = { costC: 100_000_00, accC: 25_000_00, bookC: 75_000_00, monthC: 1_000_00, count: 12, costedCount: 12, depreciatingCount: 5 };
  it("four cards: at cost, accumulated (% written off), book value, this month", () => {
    const html = renderToStaticMarkup(<MoneyTotals kpis={kpis} asOfLabel="Oct 2026" />);
    for (const label of ["At cost", "Accumulated depreciation", "Book value", "Depreciation this month"]) expect(html).toContain(label);
    expect(html).toContain("₱100,000.00");
    expect(html).toContain("25% of cost written off");
    expect(html).toContain("₱75,000.00");
    expect(html).toContain("₱1,000.00");
    expect(html).toContain("5 assets depreciating");
  });
  it("At cost: N assets with a cost, or N assets · M with a cost when they differ", () => {
    expect(renderToStaticMarkup(<MoneyTotals kpis={kpis} asOfLabel="Oct 2026" />)).toContain("12 assets with a cost");
    expect(renderToStaticMarkup(<MoneyTotals kpis={{ ...kpis, count: 13, costedCount: 11 }} asOfLabel="Oct 2026" />))
      .toContain("13 assets · 11 with a cost");
    expect(renderToStaticMarkup(<MoneyTotals kpis={{ ...kpis, count: 1, costedCount: 1 }} asOfLabel="Oct 2026" />))
      .toContain("1 asset with a cost");
  });
  it("nothing at cost: no 0 ÷ 0", () => {
    const html = renderToStaticMarkup(<MoneyTotals kpis={{ ...kpis, costC: 0, accC: 0, bookC: 0, monthC: 0, costedCount: 0, depreciatingCount: 0 }} asOfLabel="Oct 2026" />);
    expect(html).not.toContain("NaN");
    expect(html).toContain("12 assets · 0 with a cost");
  });
});

describe("LifeCell (spec §3 item 6)", () => {
  const stage = (over: Partial<LifeStage>): LifeStage => ({ key: "mid", text: "14 / 36 mo · 22 left", usedPct: 39, usedRatio: 14 / 36, ...over });
  it("a bar and the months while depreciating", () => {
    const html = renderToStaticMarkup(<LifeCell stage={stage({})} />);
    expect(html).toContain("14 / 36 mo · 22 left");
    expect(html).toContain("width:39%");
    expect(html).toContain('data-life="mid"');
  });
  it("6 months or less left reads amber", () => {
    expect(renderToStaticMarkup(<LifeCell stage={stage({ key: "soon", text: "34 / 36 mo · 2 left", usedPct: 94 })} />))
      .toContain("bg-(--st-attention-dot)");
  });
  it("a text state, and no bar, when not depreciating", () => {
    const html = renderToStaticMarkup(<LifeCell stage={{ key: "notstarted", text: "Starts when approved", usedPct: null, usedRatio: null }} />);
    expect(html).toContain("Starts when approved");
    expect(html).not.toContain("width:");
  });
});

describe("FinanceTable (spec §3 item 6)", () => {
  const row = (over: Partial<FinanceRow>): FinanceRow => ({
    id: "a1", tag: "IT-0001", model: "Latitude 5440", categoryId: "lap", category: "Laptops", cls: "IT", status: "DEPLOYED",
    holder: "Ana Cruz", reg: "registered", notCapitalised: false, costC: 36_000_00, confirmedAt: null, startMonth: 24300,
    result: { state: "depreciating", cost: 36_000_00, accumulated: 14_000_00, bookValue: 22_000_00, monthly: 1_000_00, startMonth: 24300, policy: { lifeMonths: 36, salvage: 0, basis: "category" } },
    note: null, custom: false, overrideNote: null, lifeMonths: null, salvageC: null, categoryLife: 36, categorySalvagePercent: 0,
    lifeStage: { key: "mid", text: "14 / 36 mo · 22 left", usedPct: 39, usedRatio: 14 / 36 },
    ...over,
  });
  const html = renderToStaticMarkup(
    <FinanceTable
      rows={[row({}), row({ id: "a2", tag: "IT-0002", holder: null, costC: null, result: null, reg: "with-finance", lifeStage: { key: "notstarted", text: "No cost yet", usedPct: null, usedRatio: null } })]}
      shown={{ count: 40, costedCount: 39, costC: 1_000_000_00, accC: 250_000_00, bookC: 750_000_00 }}
    />,
  );
  const headers = [...html.matchAll(/<th[^>]*scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  it("has the spec's columns, zebra rows and a sticky head", () => {
    expect(headers).toEqual(["Asset", "Category", "Status", "Finance", "Cost", "Accum. dep.", "Book value", "Life used", "Row actions"]);
    expect(html).toContain("list-striped");
    expect(html).toContain("list-sticky-head");
  });
  it("Asset: the tag links to the asset page, then model · holder, or not assigned", () => {
    expect(html).toContain('href="/finance/assets/a1"');
    expect(html).toContain("Latitude 5440 · Ana Cruz");
    expect(html).toContain("Latitude 5440 · not assigned");
  });
  it("money and life per row; the row menu only on a costed, capitalised row", () => {
    expect(html).toContain("₱36,000.00");
    expect(html).toContain("₱14,000.00");
    expect(html).toContain("₱22,000.00");
    expect(html).toContain("14 / 36 mo · 22 left");
    expect(html).toContain("No cost yet");
    expect(html.match(/aria-label="Actions for /g)).toHaveLength(1);
  });
  it("the state note shows under the book value, visibly; the life hints keep the category and the override", () => {
    const h = renderToStaticMarkup(
      <FinanceTable
        rows={[
          row({ id: "n1", tag: "IT-0012", note: "No policy for Docks", lifeStage: { key: "notstarted", text: "No policy for Docks", usedPct: null, usedRatio: null } }),
          row({ id: "n2", tag: "IT-0013", custom: true, note: "Salvage is not below cost — check the override", lifeStage: { key: "notstarted", text: "Salvage is not below cost — check the override", usedPct: null, usedRatio: null } }),
        ]}
        shown={{ count: 2, costedCount: 2, costC: 0, accC: 0, bookC: 0 }}
      />,
    );
    const notes = [...h.matchAll(/<span [^>]*data-note=""[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(notes).toEqual(["No policy for Docks", "Salvage is not below cost — check the override"]);
    expect(h.match(/No policy for Docks/g)!.length).toBeGreaterThanOrEqual(2); // the note and the Life cell
    expect(h).toContain("Salvage is not below cost — check the override");
    expect(html).not.toContain('data-note=""'); // a depreciating row has no note
  });
  it("a totals row for every row shown", () => {
    const foot = html.slice(html.indexOf("<tfoot"));
    expect(foot).toContain("Total · 40 assets shown");
    expect(foot).toContain("(39 with a cost)");
    expect(foot).toContain("₱1,000,000.00");
    expect(foot).toContain("₱250,000.00");
    expect(foot).toContain("₱750,000.00");
  });
});
