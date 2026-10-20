import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssetRow } from "@/server/modules/inventory/queries";
import type { ListState } from "@/lib/url-state";
import { InventoryTable } from "./inventory-table";
import { MoreFilters } from "./more-filters";

// The table and its dialogs reach for the router; markup tests never navigate.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inventory",
}));
// The dialogs and the drawer call server actions (auth, database); none of them render until opened.
vi.mock("./bulk-drawer", () => ({ BulkDrawer: () => null }));
// The density control saves to the person's prefs by a server action (Phase 47), whose module pulls in auth and the db.
vi.mock("@/server/ui-prefs", () => ({ saveUiPref: vi.fn(async () => null) }));
vi.mock("./holder-control", () => ({ AssignDialog: () => null, ReturnDialog: () => null }));
vi.mock("./status-control", () => ({ ChangeStatusDialog: () => null }));
vi.mock("./registration-cell", () => ({ RegistrationCell: () => null }));

const row = (over: Partial<AssetRow>): AssetRow => ({
  id: "a1", tag: "BR-LT-0001", serial: "SN-123", model: "ThinkPad T14", category: "Laptop", status: "DEPLOYED",
  assignee: null, hold: null, purchased: "—", warranty: "—", stage: null, stageLabel: null, down: null,
  assigneeId: null, assigneeNo: null, cls: "IT", statusValue: "DEPLOYED", returned: false, pendingRef: null,
  loanDueAt: null, awaitingItCheck: false, financeConfirmed: true, financeReturned: false, reg: "registered",
  regNotCapitalised: false, regItems: [], regNote: null, regBy: null, regAt: null, attention: null, ...over,
});

const state: ListState = { q: "", filters: {}, sort: [], page: 1, per: 25 };

const table = (rows: AssetRow[], visible = ["serial", "category", "assigned"], canMutate = true, repairMode = false) =>
  renderToStaticMarkup(
    <InventoryTable
      rows={rows}
      state={state}
      visible={visible}
      canMutate={canMutate}
      filtersQS=""
      total={rows.length}
      cls="IT"
      role="it_staff"
      direct
      recentPeople={[]}
      sortHrefs={{}}
      today="2026-10-20"
      repairMode={repairMode}
    />,
  );

/** The card's (the table wrapper's) class list. */
const cardClass = (html: string) => html.match(/<div class="([^"]*list-sticky-head[^"]*)"/)?.[1].split(/\s+/) ?? [];

/** The text of each header cell, in order. */
const headers = (html: string) =>
  [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/[↑↓]/g, "").trim());

describe("InventoryTable", () => {
  it("shows the six default columns in order, between the checkbox and the row actions", () => {
    expect(headers(table([row({})]))).toEqual([
      "", "Tag", "Serial number", "Model", "Category", "Assigned", "Status", "Row actions",
    ]);
  });

  it("puts the optional columns after Status when chosen, and drops Serial number when unchosen", () => {
    const h = headers(table([row({})], ["category", "assigned", "registration", "purchased", "warranty"]));
    expect(h).toEqual([
      "", "Tag", "Model", "Category", "Assigned", "Status", "Registration", "Purchased", "Warranty", "Row actions",
    ]);
  });

  it("is a striped table with a sticky head, rows and head sized by the list variables", () => {
    const html = table([row({})]);
    expect(html).toContain("list-striped");
    expect(html).toContain("list-sticky-head");
    expect(html).toContain("height:var(--list-row-h)");
    expect(html).toContain("height:var(--list-head-h)");
  });

  it("lets the default set's card stop clipping from 1280 px (so the head sticks), its minimum fitting 1280 px", () => {
    const html = table([row({})]);
    expect(html).toContain("--inventory-table-min:954px");
    expect(cardClass(html)).toContain("xl:overflow-visible");
    expect(cardClass(html)).not.toContain("xl:overflow-auto");
    // the head pins under the window's toolbar (globals.css keys the window offset on this attribute's absence)
    expect(html).not.toContain("data-scrolls-in-card");
  });

  it("keeps a wider view (Repairs, Registration shown) scrolling inside its card, so it never runs past it", () => {
    for (const html of [
      table([row({})], undefined, true, true),
      table([row({})], ["serial", "category", "assigned", "registration"]),
    ]) {
      expect(cardClass(html)).toContain("xl:overflow-auto");
      expect(cardClass(html)).not.toContain("xl:overflow-visible");
      // marked, so its head sticks at the card's top (top: 0), not the toolbar's height down inside it
      expect(html).toMatch(/<div class="[^"]*list-sticky-head[^"]*" data-scrolls-in-card="">/);
    }
  });

  it("keeps the Status reason in the cell's one span.block, collapsed (display none) in Dense", () => {
    const html = table([row({ attention: { kind: "queued", label: "queued APR-2041", severity: 2000 } })]);
    const blocks = html.match(/<span[^>]*class="[^"]*\bblock\b[^"]*"[^>]*>queued APR-2041<\/span>/g) ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("dense:hidden");
    expect(blocks[0]).toMatch(/id="[^"]+-reason-a1"/);
    // the 6 px attention dot shows only in Dense
    expect(html).toMatch(/<span aria-hidden="true" class="(?:[^"]*\s)?dense:inline-block(?:\s[^"]*)?"/);
    // outside Dense (the server's snapshot) the row carries no title or description
    expect(html).not.toMatch(/<tr[^>]*aria-describedby/);
  });

  it("shows a serial in mono with its title, and — without one", () => {
    expect(table([row({})])).toContain('title="SN-123">SN-123</span>');
    expect(table([row({ serial: null })])).toMatch(/text-fg-faint">—<\/span>/);
  });

  it("stacks the holder's name over the EMP number (one line in Dense), keeping the link text Name · EMP", () => {
    const html = table([row({ assignee: "Ana Cruz", assigneeId: "e1", assigneeNo: "EMP-0042" })]);
    expect(html).toMatch(/<a class="[^"]*flex-col dense:flex-row[^"]*"[^>]*href="\/employees\/e1"/);
    expect(html).toContain('title="Ana Cruz · EMP-0042"');
    expect(html).toMatch(/Ana Cruz<\/span><span[^>]*><span class="sr-only"> · <\/span>EMP-0042<\/span>/);
  });

  it("shows HOLD and for {name} for a held spare, and — for nobody", () => {
    const held = table([row({ statusValue: "SPARE", status: "SPARE", hold: { id: "e2", name: "Ben Uy", active: true, expiresAt: null } })]);
    expect(held).toContain("HOLD");
    expect(held).toMatch(/for <a[^>]*href="\/employees\/e2"[^>]*>Ben Uy<\/a>/);
    expect(table([row({})])).toMatch(/<td[^>]*><span class="text-fg-faint">—<\/span><\/td>/);
  });

  it("keeps the selection checkboxes' names, and renders no bulk bar until a row is ticked", () => {
    const html = table([row({})]);
    expect(html).toContain('aria-label="Select all on this page"');
    expect(html).toContain('aria-label="Select BR-LT-0001"');
    expect(html).not.toContain('aria-label="Bulk actions"');
  });

  it("offers a viewer no checkboxes and no bulk bar live region", () => {
    const html = table([row({})], undefined, false);
    expect(html).not.toContain("Select all on this page");
    expect(html).not.toContain('aria-live="polite"');
  });
});

describe("MoreFilters", () => {
  it("is a dialog button with no badge while nothing is set", () => {
    const html = renderToStaticMarkup(<MoreFilters count={0}><span>facets</span></MoreFilters>);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("More filters");
    expect(html).not.toContain(" set</span>");
    // closed: the facets are not rendered
    expect(html).not.toContain("facets");
  });

  it("shows how many of its filters are set, and names the count for a screen reader", () => {
    const html = renderToStaticMarkup(<MoreFilters count={2}><span>facets</span></MoreFilters>);
    expect(html).toMatch(/aria-hidden="true"[^>]*>2<\/span>/);
    expect(html).toContain('<span class="sr-only">, 2 set</span>');
  });
});
