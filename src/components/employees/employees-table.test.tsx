import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EmployeeFacets, EmployeeListRow } from "@/server/modules/employees/queries";
import type { ListState } from "@/lib/url-state";
import { EmployeesTable } from "./employees-table";
import { EmployeesToolbar } from "./employees-toolbar";

// The table and toolbar reach for the router; markup tests never navigate.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/employees",
}));
// The bulk Transfer dialog's server action (it pulls in auth); markup tests never submit.
vi.mock("@/server/modules/employees/transfer-actions", () => ({ bulkTransferEmployees: vi.fn() }));

const row = (over: Partial<EmployeeListRow>): EmployeeListRow => ({
  id: "e1", name: "Ana Cruz", title: "Support Lead", employeeNo: "EMP-0042", department: "Finance",
  departmentKind: "INTERNAL", employment: "ACTIVE", m365: "active", items: 3, missingRequired: 0, joined: "Mar 3, 2025",
  ...over,
});

const state: ListState = { q: "", filters: {}, sort: [{ key: "name", dir: "asc" }], page: 1, per: 25 };

const table = (rows: EmployeeListRow[], canMutate = true) =>
  renderToStaticMarkup(<EmployeesTable rows={rows} state={state} sortHrefs={{}} canMutate={canMutate} />);

/** The text of each header cell, in order. */
const headers = (html: string) =>
  [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/[↑↓]/g, "").trim());

/** The card's (the table wrapper's) class list. */
const cardClass = (html: string) => html.match(/<div class="([^"]*list-sticky-head[^"]*)"/)?.[1].split(/\s+/) ?? [];

const facets: EmployeeFacets = { department: [], kind: [], employment: [] };
const toolbar = (s: ListState, over: { gapsOnly?: boolean; hiddenLeavers?: number; total?: number } = {}) =>
  renderToStaticMarkup(
    <EmployeesToolbar
      state={s}
      total={over.total ?? 570}
      facets={facets}
      gapsOnly={over.gapsOnly ?? false}
      hiddenLeavers={over.hiddenLeavers ?? 0}
    />,
  );

describe("EmployeesTable", () => {
  it("shows the spec §3.3 columns in order, with no M365 and no avatar", () => {
    const html = table([row({})]);
    expect(headers(html)).toEqual(["", "Employee", "Works for", "Loadout", "Items", "Employment", "Joined", "Open"]);
    expect(html).not.toContain("M365");
    expect(html).not.toContain("no sync yet");
  });

  it("drops the checkbox column for a viewer", () => {
    expect(headers(table([row({})], false))).toEqual(["Employee", "Works for", "Loadout", "Items", "Employment", "Joined", "Open"]);
    expect(table([row({})], false)).not.toContain('type="checkbox"');
  });

  it("is a striped table with a sticky head, sized by the list variables, that fits the card at 1280 px", () => {
    const html = table([row({})]);
    expect(html).toContain("list-striped");
    expect(html).toContain("list-sticky-head");
    expect(html).toContain("height:var(--list-row-h)");
    expect(html).toContain("height:var(--list-head-h)");
    expect(html).toContain("--employees-table-min:952px");
    expect(cardClass(html)).toContain("xl:overflow-visible");
    expect(cardClass(html)).not.toContain("xl:overflow-auto");
  });

  it("stacks the name over the title (one line in Dense), the EMP number for screen readers only", () => {
    const html = table([row({})]);
    expect(html).toMatch(/<a class="[^"]*flex-col dense:flex-row[^"]*"[^>]*href="\/employees\/e1"/);
    expect(html).toContain('title="Ana Cruz · Support Lead"');
    expect(html).toContain('<span class="sr-only"> · EMP-0042</span>');
    expect(html).toContain("Support Lead</span>");
  });

  it("shows Works for over its kind, the kind line hidden in Dense and kept in the title", () => {
    const client = table([row({ department: "Bluepeak Telecom", departmentKind: "CLIENT" })]);
    expect(client).toContain('title="Bluepeak Telecom · Client account"');
    expect(client).toMatch(/dense:hidden"><span class="sr-only"> · <\/span>Client account<\/span>/);
    expect(table([row({})])).toContain("Internal department");
  });

  it("reads Loadout as complete, N missing or no policy", () => {
    expect(table([row({ missingRequired: 0 })])).toContain(">complete</span>");
    expect(table([row({ missingRequired: 2 })])).toContain(">2 missing</span>");
    expect(table([row({ missingRequired: null })])).toContain(">no policy</span>");
  });

  it("labels Employment with EMPLOYMENT_LABEL", () => {
    expect(table([row({ employment: "OFFBOARDING" })])).toContain("Leaving");
    expect(table([row({ employment: "ACTIVE" })])).toMatch(/<\/span>Active<\/span>/);
  });

  it("gives an Offboarded row a disabled checkbox, and select-all skips it", () => {
    const html = table([row({}), row({ id: "e2", name: "Faith Mercado", employment: "OFFBOARDED" })]);
    expect(html).toMatch(/<input type="checkbox"[^>]*aria-label="Select Faith Mercado"[^>]*disabled=""/);
    expect(html).not.toMatch(/<input type="checkbox"[^>]*aria-label="Select Ana Cruz"[^>]*disabled=""/);
    expect(html).not.toMatch(/<input type="checkbox"[^>]*aria-label="Select all on this page"[^>]*disabled=""/);
    // a page of leavers only has nothing to select
    const leavers = table([row({ employment: "OFFBOARDED" })]);
    expect(leavers).toMatch(/<input type="checkbox"[^>]*aria-label="Select all on this page"[^>]*disabled=""/);
  });

  it("shows no bulk bar while nothing is ticked", () => {
    expect(table([row({})])).not.toContain("Bulk actions");
  });
});

describe("EmployeesToolbar", () => {
  it("is the lean row: search and Works for, no Staff, Employment or pills", () => {
    const html = toolbar(state);
    expect(html).toContain('placeholder="Search name, EMP number, title or client"');
    expect(html).toContain("Works for");
    expect(html).not.toContain("Staff");
    expect(html).not.toContain("Employment");
    expect(html).not.toContain("Show leavers");
    expect(html).not.toContain("Policy gaps only");
  });

  it("prints the count with the number in bold, and the hidden leavers as a link that shows them", () => {
    const html = toolbar(state, { hiddenLeavers: 30 });
    expect(html).toMatch(/<p aria-live="polite"><span class="font-semibold text-fg">570<\/span> people · <a[^>]*>30 leavers hidden<\/a><\/p>/);
    expect(html).toMatch(/href="\/employees\?leavers=1"[^>]*>30 leavers hidden/);
  });

  it("offers Hide once leavers are shown", () => {
    const html = toolbar({ ...state, filters: { leavers: ["1"] } });
    expect(html).toMatch(/570<\/span> people · leavers shown · <a[^>]*href="\/employees"[^>]*>Hide<\/a>/);
  });

  it("shows Clear filters only for a search, Works for or tab, keeping the leavers scope", () => {
    expect(toolbar(state)).not.toContain("Clear filters");
    expect(toolbar({ ...state, filters: { leavers: ["1"] } })).not.toContain("Clear filters");
    expect(toolbar({ ...state, q: "ana" })).toContain("Clear filters");
    expect(toolbar({ ...state, filters: { department: ["d1"] } })).toContain("Clear filters");
    expect(toolbar(state, { gapsOnly: true })).toContain("Clear filters");
    const html = toolbar({ ...state, filters: { kind: ["CLIENT"], leavers: ["1"] } });
    expect(html).toMatch(/<a[^>]*href="\/employees\?leavers=1"[^>]*>Clear filters<\/a>/);
  });
});
