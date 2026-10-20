import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CountTiles, type TileDef } from "./count-tiles";
import { ListTabs, type TabDef } from "./list-tabs";
import { FloatingBulkBar } from "./floating-bulk-bar";
import { StickyList, StickyToolbar } from "./sticky-list";
import { ListFooter } from "./list-footer";

// NavLink and the footer's select reach for the router; markup tests never navigate.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const tile = (over: Partial<TileDef>): TileDef => ({
  key: "spare", label: "In stock", caption: "Spare, ready to assign", family: "neutral",
  count: 1234, href: "/inventory?status=SPARE", on: false, ...over,
});

describe("CountTiles", () => {
  const html = renderToStaticMarkup(
    <CountTiles
      label="Filter by status"
      tiles={[tile({}), tile({ key: "deployed", label: "Deployed", family: "settled", on: true, href: "/inventory" })]}
    />,
  );
  it("is a named nav of links, the pressed one aria-current=true", () => {
    expect(html).toContain('<nav aria-label="Filter by status"');
    expect(html).toMatch(/<a [^>]*href="\/inventory\?status=SPARE"(?![^>]*aria-current)[^>]*>/);
    expect(html).toMatch(/<a [^>]*aria-current="true"[^>]*href="\/inventory"[^>]*>/);
  });
  it("shows the label, the formatted count, the caption and the family dot", () => {
    expect(html).toContain("In stock");
    expect(html).toContain("1,234");
    expect(html).toContain("Spare, ready to assign");
    expect(html).toContain("var(--st-settled-dot)");
  });
  it("has one column per tile from 1280 px: six for IT, five for Purchasing (no empty slot)", () => {
    const row = (n: number) =>
      renderToStaticMarkup(<CountTiles label="t" tiles={Array.from({ length: n }, (_, i) => tile({ key: `k${i}`, href: `/i?${i}` }))} />);
    expect(row(6)).toContain("xl:grid-cols-6");
    expect(row(5)).toContain("xl:grid-cols-5");
    expect(row(5)).not.toContain("xl:grid-cols-6");
  });
});

describe("ListTabs", () => {
  const tabs: TabDef[] = [
    { key: "all", label: "All", count: 570, href: "/employees", on: true },
    { key: "gaps", label: "Missing kit", count: 12, href: "/employees?gaps=1", on: false, tone: "attention" },
    { key: "leaving", label: "Leaving", count: 3, href: "/employees?employment=OFFBOARDING", on: false, tone: "inflight" },
  ];
  const html = renderToStaticMarkup(<ListTabs label="Filter employees" tabs={tabs} />);
  it("marks only the selected tab aria-current=page", () => {
    expect(html).toContain('<nav aria-label="Filter employees"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/employees"/);
  });
  it("colours badges by tone, the selected one in accent", () => {
    expect(html).toContain("bg-(--st-attention-bg)");
    expect(html).toContain("bg-(--st-inflight-bg)");
    expect(html).toContain("bg-accent-soft");
  });
});

describe("FloatingBulkBar", () => {
  it("with nothing selected renders only an empty live region", () => {
    const html = renderToStaticMarkup(<FloatingBulkBar count={0} onClear={() => {}}>x</FloatingBulkBar>);
    expect(html).toBe('<span class="sr-only" aria-live="polite"></span>');
  });
  it("is a Bulk actions region: N selected, the actions, then Clear", () => {
    const html = renderToStaticMarkup(
      <FloatingBulkBar count={3} onClear={() => {}}>
        <button type="button">Export</button>
      </FloatingBulkBar>,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Bulk actions"');
    expect(html).toContain('<span class="sr-only" aria-live="polite">3 selected</span>');
    expect(html.indexOf("3 selected")).toBeLessThan(html.indexOf("Export"));
    expect(html.indexOf("Export")).toBeLessThan(html.indexOf("Clear"));
  });
  it("floats at z-20: under the sticky toolbar (z-30) and its popovers, over the footer (z-10)", () => {
    const html = renderToStaticMarkup(
      <FloatingBulkBar count={1} onClear={() => {}}>
        <button type="button">Export</button>
      </FloatingBulkBar>,
    );
    expect(html).toMatch(/class="pointer-events-none fixed inset-x-0 z-20 /);
  });
});

describe("StickyList and StickyToolbar", () => {
  it("wraps the list in data-sticky-list with a sticky toolbar after its sentinel", () => {
    const html = renderToStaticMarkup(
      <StickyList>
        <StickyToolbar>filters</StickyToolbar>
      </StickyList>,
    );
    expect(html).toContain("data-sticky-list");
    expect(html).toMatch(/aria-hidden="true" class="h-0"><\/div><div class="sticky top-0 z-30[^"]*bg-canvas[^"]*py-2/);
  });
});

describe("ListFooter", () => {
  const footer = (pageCount: number, total: number, page = 1, per = 25) =>
    renderToStaticMarkup(
      <ListFooter
        page={page}
        per={per}
        total={total}
        pageCount={pageCount}
        hrefFor={(p) => `/inventory?page=${p}`}
        perHrefFor={(n) => `/inventory?per=${n}`}
      />,
    );
  it("shows the rows line, Row size, Rows per page and the pages", () => {
    const html = footer(36, 900, 2);
    expect(html).toContain("Rows <span");
    expect(html).toContain("26–50</span> of 900");
    expect(html).toContain('aria-label="Row size"');
    expect(html).toContain("Comfortable");
    expect(html).toContain("Compact");
    expect(html).toContain("Dense");
    expect(html).toContain("Rows per page");
    expect(html).toMatch(/<option value="25" selected="">25<\/option><option value="50">50<\/option><option value="100">100<\/option>/);
    expect(html).toContain('aria-label="Pagination"');
    expect(html).toContain('href="/inventory?page=3"');
  });
  it("with one page of 25 or fewer rows keeps only the rows line and Row size", () => {
    const html = footer(1, 12);
    expect(html).toContain("1–12</span> of 12");
    expect(html).toContain('aria-label="Row size"');
    expect(html).not.toContain("Rows per page");
    expect(html).not.toContain('aria-label="Pagination"');
  });
  it("with one page of more than 25 rows still offers Rows per page, but no pages", () => {
    const html = footer(1, 60, 1, 100);
    expect(html).toContain("1–60</span> of 60");
    expect(html).toContain("Rows per page");
    expect(html).toContain('<option value="100" selected="">100</option>');
    expect(html).not.toContain('aria-label="Pagination"');
  });
  it("is a z-10 sticky bar that keeps clear of Cris's corner (data-cris-avoid)", () => {
    expect(footer(36, 900, 2)).toMatch(/^<div data-cris-avoid="" class="sticky bottom-0 z-10 /);
  });
  it("says No rows for an empty list", () => {
    expect(footer(1, 0)).toContain("No rows");
  });
  it("is not a Client Component, so a Server Component page can hand it its href builders", () => {
    const source = readFileSync(new URL("./list-footer.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/);
  });
});
