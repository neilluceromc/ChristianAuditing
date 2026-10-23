import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ui/toast";
import type { WorkItem } from "@/lib/worklist";
import { COLUMNS, FILTERED_EMPTY, NO_FILTERS, sortRows } from "@/lib/worklist-view";
import { TRIAGE_REASON_MESSAGE } from "@/lib/lifecycle";
import {
  allRows, approval, check, groupsOf, hire, leaver, loan, missing, purchase, repair, triage,
} from "@/lib/worklist-view.fixtures";
import { ROW_HEIGHT, SCREEN_HEIGHT, WorklistView, type WorklistInitial } from "./worklist-view";
import { DetailsPanel } from "./details-panel";
import { QueueFilters } from "./queue-filters";
import { QueuePager, QueueTable } from "./queue-table";
import { TriageButtons, reasonError } from "./triage-actions";
import { loanDueTitle } from "@/components/inventory/loan-due-control";

// Markup tests never navigate or call the server.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/modules/lifecycle/actions", () => ({
  triageAsset: vi.fn(), triageMany: vi.fn(), undoTriage: vi.fn(), undoTriageMany: vi.fn(), setLoanDue: vi.fn(),
}));
vi.mock("@/server/modules/inventory/actions", () => ({ verifyAssetDetails: vi.fn(), verifyMany: vi.fn() }));
vi.mock("@/server/modules/home/actions", () => ({ dismissShiftRow: vi.fn(), undismissShiftRow: vi.fn() }));

const page = (rows: WorkItem[], initial: Partial<WorklistInitial> = {}, canAct = true, capped: string[] = [], cleared = 4) =>
  renderToStaticMarkup(
    <ToastProvider>
      <WorklistView groups={groupsOf(rows, capped)} initial={{ q: "triage", page: 1, sel: null, ...initial }} canAct={canAct} cleared={cleared} />
    </ToastProvider>,
  );

const decisions = { busy: false, triage: vi.fn(), check: vi.fn(), hide: vi.fn() };
const panel = (item: WorkItem | null, canAct = true) =>
  renderToStaticMarkup(<ToastProvider><DetailsPanel item={item} section={item?.section ?? "triage"} canAct={canAct} decisions={decisions} /></ToastProvider>);

/** Visible text, tags stripped and whitespace squeezed. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]));
const links = (html: string) => [...html.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1]));
const tabsOf = (html: string) =>
  [...html.match(/<nav aria-label="Queues"[\s\S]*?<\/nav>/)![0].matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    text: text(m[2]), current: m[1].includes('aria-current="page"'), href: m[1].match(/href="([^"]+)"/)![1].replace(/&amp;/g, "&"),
  }));
const rowKeys = (html: string) => [...html.matchAll(/data-row-key="([^"]+)"/g)].map((m) => m[1]);

describe("header and tabs", () => {
  it("reads Worklist, {n} waiting on IT, {n} overdue and Cleared today {n}", () => {
    const t = text(page(allRows()));
    expect(t).toContain("Worklist 12 waiting on IT · 3 overdue Cleared today 4");
  });
  it("no overdue rows: the overdue part is gone", () => {
    expect(text(page([triage("t1", 3)]))).toContain("1 waiting on IT Cleared today");
    expect(text(page([triage("t1", 3)]))).not.toContain("overdue");
  });
  it("eight queue tabs are links with counts; the open one is aria-current", () => {
    const tabs = tabsOf(page(allRows(), { q: "loans" }));
    expect(tabs.map((t) => t.text)).toEqual([
      "Triage 2", "Repairs 1", "IT check 1", "Purchase reviews 1", "New hires 1", "Loans 2", "Missing & records 1", "Approvals & leavers 3",
    ]);
    expect(tabs.filter((t) => t.current).map((t) => t.text)).toEqual(["Loans 2"]);
    expect(tabs[0].href).toBe("/inventory/work?q=triage");
  });
  it("a capped queue's tab reads 50+, and its last page says the list stops there", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => triage(`t${i}`, i));
    expect(tabsOf(page(fifty, {}, true, ["triage"]))[0].text).toBe("Triage 50+");
    const last = text(page(fifty, { page: 5 }, true, ["triage"]));
    expect(last).toContain("41–50 of 50");
    expect(last).toContain("Showing the first 50 — clear some to see more");
    expect(text(page(fifty, { page: 4 }, true, ["triage"]))).not.toContain("Showing the first");
  });
  it("only queues holding an overdue loan or a breached SLA have a red count", () => {
    const html = page(allRows());
    const nav = html.match(/<nav aria-label="Queues"[\s\S]*?<\/nav>/)![0];
    const red = [...nav.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].filter((m) => m[1].includes("st-fault")).map((m) => text(m[1]));
    expect(red).toEqual(["Loans 2", "Approvals & leavers 3"]);
  });
});

describe("summary per queue", () => {
  const stats = (q: WorklistInitial["q"]) => {
    const dl = page(allRows(), { q }).match(/<dl class="flex gap-5[\s\S]*?<\/dl>/)![0];
    return [...dl.matchAll(/<dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)].map((m) => `${m[1]} ${m[2]}`);
  };
  it("Triage: Items, Oldest, Over 90 days, Value at cost", () => {
    expect(stats("triage")).toEqual(["Items 2", "Oldest 142 d", "Over 90 days 1", "Value at cost ₱78,500 · 1 without cost"]);
  });
  it("Repairs, Loans, Approvals and the rest show their own", () => {
    expect(stats("repairs")).toEqual(["Items 1", "Longest down 22 d", "With a vendor 1"]);
    expect(stats("loans")).toEqual(["Items 2", "Overdue 1", "Due this week 1"]);
    expect(stats("queue")).toEqual(["Items 3", "Past SLA 2"]);
    expect(stats("check")).toEqual(["Items 1", "Oldest 7 d"]);
  });
  it("the queue's heading and what it is for", () => {
    const t = text(page(allRows(), { q: "loans" }));
    expect(t).toContain("Loans Loans overdue, due this week, or with no due date.");
  });
  it("Over 90 days is bold, never red; Overdue and Past SLA are red", () => {
    const html = page(allRows());
    expect(html).toMatch(/<dt[^>]*>Over 90 days<\/dt><dd class="[^"]*font-bold[^"]*">1</);
    expect(html).not.toMatch(/<dt[^>]*>Over 90 days<\/dt><dd class="[^"]*st-fault/);
    expect(page(allRows(), { q: "loans" })).toMatch(/<dt[^>]*>Overdue<\/dt><dd class="[^"]*st-fault[^"]*">1</);
  });
});

describe("filters and the bulk bar", () => {
  const props = {
    queue: "Triage", chips: [{ label: "All", value: null, count: 3 }, { label: "Laptop", value: "Laptop", count: 2 }],
    offers: { category: true, over90: true }, filters: NO_FILTERS, onFilters: vi.fn(),
    checked: 0, bulk: [{ id: "SPARE" as const, label: "Keep as spares" }, { id: "DEFECTIVE" as const, label: "Send to repair" }],
    onBulk: vi.fn(), onClearChecks: vi.fn(), busy: false,
  };
  it("category chips (pressed), Over 90 days and the search box", () => {
    const html = renderToStaticMarkup(<QueueFilters {...props} filters={{ ...NO_FILTERS, category: "Laptop" }} />);
    expect(html).toMatch(/aria-pressed="false"[^>]*>All <span[^>]*>3<\/span>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Laptop <span[^>]*>2<\/span>/);
    expect(text(html)).toContain("Over 90 days");
    expect(html).toContain('aria-label="Search Triage"');
    expect(html).toContain('placeholder="Search tag, model, person"');
  });
  it("a queue without categories or ages offers only the search", () => {
    const html = renderToStaticMarkup(<QueueFilters {...props} offers={{ category: false, over90: false }} />);
    expect(html).not.toContain('aria-label="Category"');
    expect(text(html)).not.toContain("Over 90 days");
    expect(html).toContain('type="search"');
  });
  it("ticked rows replace the filters with {n} selected, the bulk buttons and Clear", () => {
    const html = renderToStaticMarkup(<QueueFilters {...props} checked={2} />);
    expect(html).not.toContain('type="search"');
    expect(html).toContain('aria-label="Bulk actions"');
    expect(buttons(html)).toEqual(["Keep as spares", "Send to repair", "Clear"]);
    expect(text(html)).toContain("2 selected");
  });
  it("a filter that matches nothing shows the filtered empty state with Clear filters", () => {
    const html = renderToStaticMarkup(
      <QueueTable label="Triage" columns={COLUMNS.triage} rows={[]} sort={null} onSort={vi.fn()} selected={null} onSelect={vi.fn()}
        onMove={vi.fn()} onOpen={vi.fn()} ticks={false} checked={new Set()} onCheck={vi.fn()} onCheckAll={vi.fn()}
        empty={<>{FILTERED_EMPTY} <button type="button">Clear filters</button></>} />,
    );
    expect(text(html)).toContain("Nothing matches these filters. Clear filters");
  });
});

describe("table", () => {
  const rows = [triage("ta", 10, { model: "Zebra" }), triage("tb", 200, { model: "apple" }), triage("tc", 50, { model: "Mango" })];
  const table = (sorted: WorkItem[], sort: { key: string; dir: "asc" | "desc" } | null, ticks = true, selected: string | null = null) =>
    renderToStaticMarkup(
      <QueueTable label="Triage" columns={COLUMNS.triage} rows={sorted} sort={sort} onSort={vi.fn()} selected={selected}
        onSelect={vi.fn()} onMove={vi.fn()} onOpen={vi.fn()} ticks={ticks} checked={new Set(["triage:tb"])} onCheck={vi.fn()}
        onCheckAll={vi.fn()} empty={null} />,
    );
  it("the triage columns, with aria-sort on the sorted one only", () => {
    const html = table(rows, { key: "waiting", dir: "desc" });
    const ths = [...html.matchAll(/<th ([^>]*)>([\s\S]*?)<\/th>/g)].map((m) => ({ t: text(m[2]).replace(/[↑↓]/g, "").trim(), sort: m[1].match(/aria-sort="(\w+)"/)?.[1] }));
    expect(ths).toEqual([
      { t: "", sort: undefined }, { t: "Item", sort: undefined }, { t: "Last holder", sort: undefined },
      { t: "Returned", sort: undefined }, { t: "Waiting", sort: "descending" },
    ]);
  });
  it("rows come in the sort's order", () => {
    expect(rowKeys(table(sortRows(rows, { key: "item", dir: "asc" }), { key: "item", dir: "asc" }))).toEqual(["triage:tb", "triage:tc", "triage:ta"]);
    expect(rowKeys(table(sortRows(rows, { key: "waiting", dir: "asc" }), null))).toEqual(["triage:ta", "triage:tc", "triage:tb"]);
  });
  it("checkboxes are labelled Select {tag}, with Select all on this page", () => {
    const html = table(rows, null);
    expect(html).toContain('aria-label="Select all on this page"');
    expect(html).toContain('aria-label="Select BR-LT-TA"');
    expect(html).toMatch(/aria-label="Select BR-LT-TB" checked=""/);
  });
  it("the selected row is aria-selected and the one tab stop", () => {
    const html = table(rows, null, true, "triage:tc");
    expect(html).toMatch(/<tr aria-selected="true"[^>]*data-row-key="triage:tc"[^>]*tabindex="0"/);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });
  it("Over 90 days reads bold and never red", () => {
    const html = table(rows, null);
    expect(html).toMatch(/font-semibold text-fg"><span[^>]*>Waiting<span class="sr-only">: <\/span><\/span>200 days</);
    expect(html).not.toContain("st-fault");
  });
  it("a queue without ticks has no checkboxes", () => {
    expect(table(rows, null, false)).not.toContain('type="checkbox"');
  });
  it("late loans and breached SLAs are the only red cells", () => {
    const loans = renderToStaticMarkup(
      <QueueTable label="Loans" columns={COLUMNS.loans} rows={[loan(true), loan(false)]} sort={null} onSort={vi.fn()} selected={null}
        onSelect={vi.fn()} onMove={vi.fn()} onOpen={vi.fn()} ticks={false} checked={new Set()} onCheck={vi.fn()} onCheckAll={vi.fn()} empty={null} />,
    );
    expect([...loans.matchAll(/st-fault-text\)"><span[^>]*>[^<]*<span class="sr-only">: <\/span><\/span>([^<]*)</g)].map((m) => m[1])).toEqual(["8 days late"]);
    const queue = renderToStaticMarkup(
      <QueueTable label="Approvals" columns={COLUMNS.queue} rows={[approval("breached"), approval("failed")]} sort={null} onSort={vi.fn()}
        selected={null} onSelect={vi.fn()} onMove={vi.fn()} onOpen={vi.fn()} ticks={false} checked={new Set()} onCheck={vi.fn()}
        onCheckAll={vi.fn()} empty={null} />,
    );
    expect([...queue.matchAll(/st-fault-text\)"><span[^>]*>[^<]*<span class="sr-only">: <\/span><\/span>([^<]*)</g)].map((m) => m[1])).toEqual(["3 d overdue"]);
    expect(text(queue)).toContain("Execution failed");
  });
});

describe("pager", () => {
  it("reads 1–10 of 23 with Previous off on page 1", () => {
    const html = renderToStaticMarkup(<QueuePager label="1–10 of 23" note={null} page={1} pageCount={3} onPage={vi.fn()} />);
    expect(html).toContain('aria-label="Pages"');
    expect(text(html)).toContain("1–10 of 23");
    expect(html).toMatch(/disabled=""[^>]*>← Previous</);
    expect(html).not.toMatch(/disabled=""[^>]*>Next →</);
  });
  it("the page reads its label from the rows read", () => {
    const rows = Array.from({ length: 23 }, (_, i) => triage(`t${i}`, i));
    expect(text(page(rows, { page: 3 }))).toContain("21–23 of 23");
    expect(rowKeys(page(rows, { page: 3 }))).toHaveLength(3);
    expect(rowKeys(page(rows))).toHaveLength(10);
  });
});

describe("details panel", () => {
  it("Triage: the note when returned, recorded by its recorder — never '{holder} said'", () => {
    const html = panel(triage("t1", 142));
    const t = text(html);
    expect(t).toContain("Note when returned: “Battery drains fast.” recorded by Neil Lucero");
    expect(t).not.toMatch(/said/);
  });
  it("Triage: real facts and history, then the four decisions with Keep as spare the one primary", () => {
    const html = panel(triage("t1", 142));
    const t = text(html);
    expect(t).toContain("Serial PF4K9Z2A");
    expect(t).toContain("Last holder Maria Reyes · Finance");
    expect(t).toContain("Warranty ended 10 Aug 2026");
    expect(t).toContain("History");
    expect(buttons(html)).toEqual(["Keep as spare", "Send to repair", "Dispose", "Donate", "Hide until tomorrow"]);
    expect(html.match(/bg-accent text-accent-fg/g)).toHaveLength(1);
    expect(links(html)).toEqual(["Open the full record →"]);
    expect(html).toContain('href="/inventory/t1"');
  });
  it("no note when nothing was typed", () => {
    expect(text(panel(triage("t1", 5, {}, null)))).not.toContain("Note when returned");
  });
  it("IT check: Mark checked", () => {
    expect(buttons(panel(check()))).toEqual(["Mark checked", "Hide until tomorrow"]);
    expect(text(panel(check()))).toContain("From PO PO-0188");
  });
  it("Loans: Set due date, and a late loan's Status reads red", () => {
    const html = panel(loan(true));
    expect(buttons(html)).toEqual(["Set due date", "Hide until tomorrow"]);
    expect(html).toMatch(/st-fault-text[^>]*>8 days late</);
  });
  it("the link queues keep their action as the primary: Chase, Review, Fill loadout, Investigate, Open, the leaver's next step", () => {
    const primary = (i: WorkItem) => links(panel(i))[0];
    expect(primary(repair())).toBe("Chase");
    expect(primary(purchase())).toBe("Review");
    expect(primary(hire())).toBe("Fill loadout");
    expect(primary(missing())).toBe("Investigate");
    expect(primary(approval("breached"))).toBe("Open");
    expect(primary(leaver())).toBe(leaver().action);
    for (const i of [repair(), purchase(), hire(), missing(), approval("failed"), leaver()]) {
      expect(links(panel(i))).toContain("Open the full record →");
      expect(panel(i).match(/bg-accent text-accent-fg/g)).toHaveLength(1);
    }
  });
  it("Purchase reviews and approvals show their own facts", () => {
    expect(text(panel(purchase()))).toContain("SI number SI-4471");
    expect(text(panel(approval("breached")))).toContain("Request note: “New starter kit” recorded by Pia Santos");
    expect(text(panel(approval("failed")))).toContain("SLA Execution failed");
    expect(panel(approval("failed"))).not.toContain("st-fault");
  });
  it("nothing selected: All clear / Nothing left in {queue}.", () => {
    expect(text(panel(null))).toBe("All clear Nothing left in Triage.");
  });
});

describe("viewer", () => {
  it("no checkboxes, no action buttons, no Hide — the facts and links stay", () => {
    const html = page(allRows(), {}, false);
    // the Over 90 days filter is a checkbox too: a viewer may filter, never tick rows
    expect(html).not.toContain('aria-label="Select');
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    const b = buttons(html);
    for (const label of ["Keep as spare", "Send to repair", "Dispose", "Donate", "Hide until tomorrow", "Keep as spares"]) expect(b).not.toContain(label);
    expect(text(html)).toContain("Note when returned");
    expect(links(html)).toContain("Open the full record →");
  });
  it("a viewer's panel on a link queue has no primary button either", () => {
    expect(links(panel(repair(), false))).toEqual(["Open the full record →"]);
    expect(buttons(panel(check(), false))).toEqual([]);
  });
  it("a viewer's leaver opens the leaver's wizard page, not the edit form", () => {
    expect(panel(leaver(), false)).toContain('href="/offboarding/e9"');
  });
});

describe("triage inline reason", () => {
  const props = { tag: "BR-LT-1025", reason: "", error: null, busy: false, onDecide: vi.fn(), onChoose: vi.fn(), onReason: vi.fn(), onConfirm: vi.fn() };
  it("Dispose opens a required reason with Confirm and Cancel in place of the four buttons", () => {
    const html = renderToStaticMarkup(<TriageButtons {...props} choice="DISPOSE" />);
    expect(html).toContain("<textarea");
    expect(text(html)).toContain("Reason");
    expect(buttons(html)).toContain("Confirm");
    expect(buttons(html)).toContain("Cancel");
    expect(buttons(html)).not.toContain("Keep as spare");
    expect(html.match(/bg-accent text-accent-fg/g)).toHaveLength(1);
  });
  it("Confirm is refused under 2 characters, with the rule's words", () => {
    expect(reasonError("DISPOSE", "")).toBe(TRIAGE_REASON_MESSAGE);
    expect(reasonError("DONATED", " x ")).toBe(TRIAGE_REASON_MESSAGE);
    expect(reasonError("DISPOSE", "Beyond repair")).toBeNull();
    const html = renderToStaticMarkup(<TriageButtons {...props} choice="DONATED" error={TRIAGE_REASON_MESSAGE} />);
    expect(text(html)).toContain(TRIAGE_REASON_MESSAGE);
    expect(html).toContain('aria-invalid="true"');
  });
  it("Keep as spare and Send to repair decide at once — no reason asked", () => {
    const html = renderToStaticMarkup(<TriageButtons {...props} choice={null} />);
    expect(html).not.toContain("<textarea");
    expect(buttons(html)).toEqual(["Keep as spare", "Send to repair", "Dispose", "Donate"]);
  });
});

describe("empty", () => {
  it("an empty queue reads All clear / Nothing left in {queue}. in the table and the panel", () => {
    const t = text(page([], { q: "repairs" }));
    expect(t).toContain("All clear Nothing left in Repairs.");
    expect(t).toContain("0 items");
  });
  it("the first queue with work opens when none is named", () => {
    // queueFrom picks it in the page; here the view simply shows what it is given
    expect(tabsOf(page([check()], { q: "check" })).find((t) => t.current)?.text).toBe("IT check 1");
  });
});

describe("fix round 1", () => {
  it("I1: the triage buttons stay focusable while busy — aria-disabled, never disabled", () => {
    const html = renderToStaticMarkup(
      <TriageButtons tag="BR-LT-1025" choice={null} reason="" error={null} busy onDecide={vi.fn()} onChoose={vi.fn()} onReason={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(html).not.toContain('disabled=""');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
    const reason = renderToStaticMarkup(
      <TriageButtons tag="BR-LT-1025" choice="DISPOSE" reason="x" error={null} busy onDecide={vi.fn()} onChoose={vi.fn()} onReason={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(reason).toMatch(/aria-disabled="true"[^>]*>(<span[^>]*>)?Confirm/);
  });
  it("I1: Mark checked and Hide stay focusable while busy", () => {
    const html = renderToStaticMarkup(
      <ToastProvider><DetailsPanel item={check()} section="check" canAct decisions={{ ...decisions, busy: true }} /></ToastProvider>,
    );
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });
  it("I1: the empty state and the aside are focus targets", () => {
    expect(page([], { q: "repairs" })).toMatch(/<[a-z]+ tabindex="-1" data-worklist-empty=""/);
    expect(page([triage("t1", 3)])).toContain("data-worklist-panel");
  });
  it("M2: filters hiding every row leave the panel at No row selected, not All clear", () => {
    const html = renderToStaticMarkup(
      <ToastProvider><DetailsPanel item={null} section="triage" canAct filtered decisions={decisions} /></ToastProvider>,
    );
    expect(text(html)).toBe("No row selected");
  });
  it("M10: below 640 px each stacked cell carries its column's name", () => {
    const html = renderToStaticMarkup(
      <QueueTable label="Triage" columns={COLUMNS.triage} rows={[triage("t1", 142)]} sort={null} onSort={vi.fn()} selected={null}
        onSelect={vi.fn()} onMove={vi.fn()} onOpen={vi.fn()} ticks={false} checked={new Set()} onCheck={vi.fn()} onCheckAll={vi.fn()} empty={null} />,
    );
    const labels = [...html.matchAll(/<span class="([^"]*sm:hidden[^"]*)">([^<]*)<span class="sr-only">: <\/span><\/span>/g)]
      .map((m) => [m[2], m[1].includes("sr-only")]);
    expect(labels).toEqual([["Item", true], ["Last holder", false], ["Returned", false], ["Waiting", false]]);
  });
  it("Task 4 (3): a stacked label and its value read with a separator — \"Waiting: 142 days\"", () => {
    const html = renderToStaticMarkup(
      <QueueTable label="Triage" columns={COLUMNS.triage} rows={[triage("t1", 142)]} sort={null} onSort={vi.fn()} selected={null}
        onSelect={vi.fn()} onMove={vi.fn()} onOpen={vi.fn()} ticks={false} checked={new Set()} onCheck={vi.fn()} onCheckAll={vi.fn()} empty={null} />,
    );
    const read = html.replace(/<[^>]+>/g, "");
    expect(read).toContain("Waiting: 142 days");
    expect(read).not.toMatch(/Waiting\d/);
  });
  it("Task 4 (5): busy bulk buttons stay focusable — aria-disabled, never disabled", () => {
    const html = renderToStaticMarkup(
      <QueueFilters queue="Triage" chips={[]} offers={{ category: false, over90: false }} filters={NO_FILTERS} onFilters={vi.fn()}
        checked={2} bulk={[{ id: "SPARE", label: "Keep as spares" }, { id: "DEFECTIVE", label: "Send to repair" }]}
        onBulk={vi.fn()} onClearChecks={vi.fn()} busy />,
    );
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });
  it("M5: the loan dialog is titled to match the Set due date button", () => {
    expect(loanDueTitle("BR-LT-0210")).toBe("Set the due date for BR-LT-0210");
  });
});

describe("Task 4: the one screen leaves Cris's corner clear without scrolling the document", () => {
  it("the screen and its rows give up Cris's clearance (--cris-clear), so #main's extra room never adds a scroll", () => {
    expect(SCREEN_HEIGHT).toBe("sm:h-[calc(100dvh-100px-var(--cris-clear,0px))]");
    expect(ROW_HEIGHT).toContain("calc((100dvh-404px-var(--cris-clear,0px))/10)");
    const html = page([triage("t1", 3)]);
    expect(html).toContain(SCREEN_HEIGHT);
    expect(html).toContain("sm:[--wl-row:clamp(32px,calc((100dvh-404px-var(--cris-clear,0px))/10),52px)]");
  });
});
