import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_ASSET_PAGE_STATE, type AssetPageState } from "@/lib/finance-asset-page";
import type { LedgerMonth, LedgerYear } from "@/lib/finance-ledger";
import type { HistoryResult, HistoryRow } from "@/lib/finance-history";
import type { AssetAttachmentView, AssetNoteThread } from "@/lib/asset-notes";
import { AssetTabs, assetTabDefs } from "./asset-tabs";
import { LedgerTab } from "./ledger-tab";
import { HistoryTab } from "./history-tab";
import { HistoryEntry } from "./history-entry";
import { AssetPanel, type AssetPanelProps } from "./asset-panel";
import { NotesTab } from "@/components/assets/notes-tab";
import { AttachmentsTab } from "@/components/assets/attachments-tab";
import { DocPreview } from "@/components/assets/doc-preview";

// NavLink, the person select and the forms reach for the router; markup tests never navigate.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The note and attachment forms call server actions (auth, db); markup tests never submit.
vi.mock("@/server/modules/assets/notes", () => ({ postNoteFormAction: vi.fn(), setNoteResolved: vi.fn() }));
vi.mock("@/server/modules/assets/attachments", () => ({ uploadAttachmentFormAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

/*
 * Phase 47 (Task 7, spec §4): the Finance asset page (Option B · Ledger) — the tab badges, the ledger's year tabs
 * and All-years rows, the history entries (chips, reason, Details), the notes and attachments tabs (shared with the
 * Inventory record), the left panel and the document preview, and every empty state.
 */

const S: AssetPageState = DEFAULT_ASSET_PAGE_STATE;
const at = (iso: string) => new Date(iso);

/** The opening tag of the element carrying `attr`. */
const tagWith = (html: string, attr: string) => html.match(new RegExp(`<[^>]*${attr}[^>]*>`))?.[0] ?? "";

describe("tab badges (spec §4.1)", () => {
  const base = { id: "a1", state: S, lifeMonths: 36, noteCount: 3, openNoteCount: 1, attachmentCount: 2, historyCount: 41 };
  it("ledger \"36 mo\", Notes amber while a thread is open, Attachments and Financial history counts", () => {
    const tabs = assetTabDefs(base);
    expect(tabs.map((t) => t.label)).toEqual(["Depreciation ledger", "Notes", "Attachments", "Financial history"]);
    expect(tabs[0].badge).toBe("36 mo");
    expect(tabs[1]).toMatchObject({ count: 3, tone: "attention" });
    expect(tabs[2]).toMatchObject({ count: 2 });
    expect(tabs[2].tone).toBeUndefined();
    expect(tabs[3]).toMatchObject({ count: 41 });
    expect(tabs.map((t) => t.href)).toEqual([
      "/finance/assets/a1", "/finance/assets/a1?tab=notes", "/finance/assets/a1?tab=files", "/finance/assets/a1?tab=history",
    ]);
    expect(tabs.map((t) => t.on)).toEqual([true, false, false, false]);
  });
  it("no amber once every thread is resolved; no schedule reads a dash", () => {
    const tabs = assetTabDefs({ ...base, openNoteCount: 0, lifeMonths: null });
    expect(tabs[1].tone).toBeUndefined();
    expect(tabs[0].badge).toBe("—");
  });
  it("renders the badges, the selected tab aria-current", () => {
    const html = renderToStaticMarkup(<AssetTabs {...base} state={{ ...S, tab: "history" }} />);
    expect(html).toContain("36 mo");
    expect(html).toContain('<nav aria-label="Asset sections"');
    expect(tagWith(html, 'aria-current="page"')).toContain('href="/finance/assets/a1?tab=history"');
    expect(html).toContain("bg-(--st-attention-bg)");
  });
});

const year = (y: number, over: Partial<LedgerYear> = {}): LedgerYear =>
  ({ year: y, months: 12, totalC: 1_200_000, openC: 3_600_000, closeC: 2_400_000, accC: 1_200_000, state: "upcoming", ...over });
const YEARS = [year(2026, { months: 3, state: "now" }), year(2027), year(2028), year(2029, { months: 9 })];
const month = (m: number, over: Partial<LedgerMonth> = {}): LedgerMonth => ({
  month: m, label: `M${m}`, openC: 100_000, chargeC: 10_000, accC: 10_000, closeC: 90_000, state: "projected", roundingMark: false, ...over,
});

describe("LedgerTab (spec §4.2)", () => {
  it("All years: one summary row per year, the year a button opening that year", () => {
    const html = renderToStaticMarkup(<LedgerTab id="a1" state={S} years={YEARS} selected="all" months={null} emptyReason={null} />);
    expect(html.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr /g)).toHaveLength(4);
    expect(html).toContain('href="/finance/assets/a1?year=2027"');
    expect(html).toMatch(/<a [^>]*href="\/finance\/assets\/a1\?year=2028"[^>]*>2028<\/a>/);
    expect(html).toContain("Charged in year");
    // the All years tab is the selected one
    expect(tagWith(html, 'aria-current="true"')).toContain('href="/finance/assets/a1?year=all"');
  });
  it("year tabs: the year, its months, its total and Done / In progress / Upcoming", () => {
    const html = renderToStaticMarkup(
      <LedgerTab id="a1" state={S} years={[year(2025, { state: "done" }), ...YEARS]} selected="all" months={null} emptyReason={null} />,
    );
    expect(html).toContain("Done");
    expect(html).toContain("In progress");
    expect(html).toContain("Upcoming");
    expect(html).toContain("3 mo");
    expect(html).toContain("₱12,000.00");
  });
  it("one year: the opening / charged / closing strip and a row per month; this month marked, projected muted, * noted", () => {
    const months = [
      month(1, { state: "counted" }), month(2, { state: "now", label: "Now month" }), month(3, { roundingMark: true, label: "Last month" }),
    ];
    const html = renderToStaticMarkup(<LedgerTab id="a1" state={S} years={YEARS} selected={2026} months={months} emptyReason={null} />);
    expect(html).toContain("Opening book value");
    expect(html).toContain("Charged this year");
    expect(html).toContain("Closing book value");
    expect(html).toContain("Counted");
    expect(html).toContain("This month");
    expect(html).toContain("Projected");
    expect(tagWith(html, 'data-state="now"')).toContain("bg-accent-tint");
    expect(tagWith(html, 'data-state="projected"')).toContain("text-fg-muted");
    expect(html).toContain("₱100.00*");
    expect(html).toMatch(/\* .*rounding/);
    expect(tagWith(html, 'aria-current="true"')).toContain('href="/finance/assets/a1?year=2026"');
  });
  it("no schedule: the reason, never a table", () => {
    const html = renderToStaticMarkup(<LedgerTab id="a1" state={S} years={[]} selected="all" months={null} emptyReason="Not capitalised" />);
    expect(html).toContain("No depreciation schedule");
    expect(html).toContain("Not capitalised");
    expect(html).not.toContain("<table");
  });
});

const hrow = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  id: "e1", ref: "AUD-20261021-ABC123", at: at("2026-10-21T01:02:03Z"), day: "2026-10-21", dayLabel: "Wed 21 Oct 2026",
  time: "09:02", exact: "2026-10-21 09:02:03 GMT+8 (Asia/Manila)", actor: "Ana Cruz", actorKey: "u1", role: "Finance",
  kind: "review", verb: "sent the asset back", changes: [{ field: "cost", from: "₱1.00", to: "₱2.00" }],
  reason: "Invoice number is wrong", source: "web", sourceLabel: "Web app", account: "ana@example.com", related: "Asset IT-0001",
  ...over,
});

describe("HistoryEntry (spec §4.5)", () => {
  it("initials, \"Name (Role) verb\", kind pill, time, chips, quoted reason and source", () => {
    const html = renderToStaticMarkup(<HistoryEntry row={hrow()} kindLabel="Review" />);
    expect(html).toContain(">AC<");
    expect(html).toMatch(/Ana Cruz[\s\S]*\(Finance\)[\s\S]*sent the asset back/);
    expect(html).toContain("Review");
    expect(html).toContain("09:02");
    expect(html).toMatch(/cost[\s\S]*<s[^>]*>₱1\.00<\/s>[\s\S]*<strong[^>]*>₱2\.00<\/strong>/);
    expect(html).toContain("“Invoice number is wrong”");
    expect(html).toContain("Web app");
  });
  it("Details is a collapsed toggle; open, it shows the reference, exact time, source, account and what it relates to", () => {
    const closed = renderToStaticMarkup(<HistoryEntry row={hrow()} kindLabel="Review" />);
    expect(tagWith(closed, "aria-expanded")).toContain('aria-expanded="false"');
    expect(closed).not.toContain("AUD-20261021-ABC123");
    const open = renderToStaticMarkup(<HistoryEntry row={hrow()} kindLabel="Review" initialOpen />);
    expect(tagWith(open, "aria-expanded")).toContain('aria-expanded="true"');
    for (const s of ["Reference", "AUD-20261021-ABC123", "Exact time", "GMT+8 (Asia/Manila)", "Done through", "Signed in as", "ana@example.com", "Related", "Asset IT-0001"]) {
      expect(open).toContain(s);
    }
  });
  it("System has no role and no reason; no chips, no chip row", () => {
    const html = renderToStaticMarkup(<HistoryEntry row={hrow({ actor: "System", role: null, reason: null, changes: [], account: null })} kindLabel="Review" />);
    expect(html).not.toContain("(null)");
    expect(html).not.toContain("“");
    expect(html).not.toMatch(/<s[ >]/);
  });
});

const result = (rows: HistoryRow[], over: Partial<HistoryResult> = {}): HistoryResult => ({
  rows, counts: { approval: 1, review: rows.length, cost: 0, settings: 0, docs: 0, notes: 0, dep: 0 },
  actors: [{ key: "u1", label: "Ana Cruz" }, { key: "system", label: "System" }],
  total: rows.length, page: 1, pages: 1, from: rows.length ? 1 : 0, to: rows.length, ...over,
});

describe("HistoryTab (spec §4.5)", () => {
  const S2: AssetPageState = { ...S, tab: "history" };
  it("the lock note, the kind filter with counts, the person select, Export log honouring the filters", () => {
    const html = renderToStaticMarkup(<HistoryTab id="a1" state={{ ...S2, hk: "review", hw: "u1" }} history={result([hrow()])} />);
    expect(html).toContain("Entries are written automatically and can&#x27;t be edited or deleted.");
    expect(tagWith(html, 'aria-current="true"')).toContain('href="/finance/assets/a1?tab=history&amp;hk=review&amp;hw=u1"');
    expect(html).toContain("Approvals");
    expect(html).toContain('href="/finance/assets/a1?tab=history&amp;hw=u1"'); // All keeps the person
    expect(html).toContain("<select");
    expect(html).toContain("Everyone");
    expect(html).toContain('href="/finance/assets/a1/history/export?hk=review&amp;hw=u1"');
  });
  it("groups by day under a date header; pages say x–y of N with Previous / Next", () => {
    const rows = [hrow(), hrow({ id: "e2", day: "2026-10-20", dayLabel: "Tue 20 Oct 2026" })];
    const html = renderToStaticMarkup(
      <HistoryTab id="a1" state={{ ...S2, hp: 2 }} history={result(rows, { total: 22, page: 2, pages: 3, from: 11, to: 20 })} />,
    );
    expect(html).toContain("Wed 21 Oct 2026");
    expect(html).toContain("Tue 20 Oct 2026");
    expect(html).toContain("11–20 of 22");
    expect(html).toContain('href="/finance/assets/a1?tab=history"'); // Previous → page 1
    expect(html).toContain('href="/finance/assets/a1?tab=history&amp;hp=3"');
  });
  it("empty: nothing recorded yet; filtered to nothing: say so, with a way back", () => {
    const none = renderToStaticMarkup(<HistoryTab id="a1" state={S2} history={result([], { actors: [] })} />);
    expect(none).toContain("Nothing recorded yet");
    const filtered = renderToStaticMarkup(<HistoryTab id="a1" state={{ ...S2, hk: "cost" }} history={result([], { counts: { approval: 1, review: 2, cost: 0, settings: 0, docs: 0, notes: 0, dep: 0 } })} />);
    expect(filtered).toContain("No entries match these filters");
    expect(filtered).toContain("Show everything");
  });
});

const note = (id: string, over: Partial<AssetNoteThread> = {}): AssetNoteThread => ({
  id, authorId: "u1", authorLabel: "Ana Cruz", authorRole: "finance_staff", body: `Body ${id}`, createdAt: at("2026-10-20T02:00:00Z"),
  resolvedAt: null, resolvedByLabel: null, replies: [], ...over,
});

describe("NotesTab (spec §4.3, shared with the Inventory record)", () => {
  it("compose box (2,000 max, Post disabled while empty), threads with name and role, replies, Reply and Mark resolved", () => {
    const threads = [
      note("n2", { replies: [{ id: "r1", authorId: "u2", authorLabel: "Ben Reyes", authorRole: "it_staff", body: "On it", createdAt: at("2026-10-20T03:00:00Z") }] }),
      note("n1", { resolvedAt: at("2026-10-20T04:00:00Z"), resolvedByLabel: "Ana Cruz" }),
    ];
    const html = renderToStaticMarkup(<NotesTab assetId="a1" threads={threads} canPost />);
    expect(html).toContain("Add a note");
    expect(html).toContain('maxLength="2000"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(<[^>]+>)*Post</);
    expect(html).toContain("Ana Cruz");
    expect(html).toContain("Finance");
    expect(html).toContain("Ben Reyes");
    expect(html).toContain("IT");
    expect(html).toContain("On it");
    expect(html).toContain("Mark resolved");
    expect(html).toContain("Reopen");
    expect(html).toContain("Resolved");
    expect(html.indexOf("Body n2")).toBeLessThan(html.indexOf("Body n1"));
    // dimmed by a quieter card (opacity broke the text's contrast under axe)
    expect(tagWith(html, 'data-resolved="true"')).toContain("bg-surface-subtle");
    expect(tagWith(html, 'data-resolved="true"')).not.toContain("opacity-");
    // focus finds each thread's toggle again after the refresh (form-focus.ts)
    expect(html).toMatch(/<button[^>]*data-resolve-toggle="n2"/);
    expect(html).toMatch(/<button[^>]*data-resolve-toggle="n1"/);
  });
  it("viewers read only: no compose, reply or resolve", () => {
    const html = renderToStaticMarkup(<NotesTab assetId="a1" threads={[note("n1")]} canPost={false} />);
    expect(html).toContain("Body n1");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Mark resolved");
    expect(html).not.toContain(">Reply<");
  });
  it("empty", () => {
    expect(renderToStaticMarkup(<NotesTab assetId="a1" threads={[]} canPost />)).toContain("No notes yet");
    expect(renderToStaticMarkup(<NotesTab assetId="a1" threads={[]} canPost={false} />)).toContain("No notes yet");
  });
});

const att = (id: string, over: Partial<AssetAttachmentView> = {}): AssetAttachmentView => ({
  id, kind: "quotation", fileName: `${id}.pdf`, size: 1_536_000, createdAt: at("2026-10-19T02:00:00Z"),
  uploadedAt: "2026-10-19T02:00:00.000Z", uploadedBy: "Ana Cruz", ...over,
});
const hrefFor = (p: { ak?: string; att?: string | null }) => `/x?ak=${p.ak ?? "all"}&att=${p.att ?? ""}`;

describe("AttachmentsTab (spec §4.4, shared with the Inventory record)", () => {
  const list = [att("q1"), att("p1", { kind: "photo", fileName: "p1.jpg", size: null })];
  it("the upload area for those who can post; kind filters with counts; the list with kind, uploader, date and size", () => {
    const html = renderToStaticMarkup(
      <AttachmentsTab assetId="a1" attachments={list} canUpload kind="all" selectedId={null} hrefFor={hrefFor} />,
    );
    expect(html).toContain("Proof of payment");
    expect(html).toContain("Drop a file here");
    expect(html).toMatch(/<p role="status" aria-live="polite"/); // announces "Uploaded <name>"
    expect(html).toMatch(/All[\s\S]*2/);
    expect(html).toMatch(/Photo[\s\S]*1/);
    expect(html).toContain("q1.pdf");
    expect(html).toContain("1.5 MB");
    expect(html).toContain("Ana Cruz");
    // the upload time to the minute (Manila), not the date alone
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Quotation · Ana Cruz · 19 Oct 2026 10:00 · 1.5 MB");
    expect(html).toContain('href="/x?ak=all&amp;att=q1"');
    expect(html).toContain("Select a file to preview it");
  });
  it("selected: a PDF in a titled frame, an image with alt text", () => {
    const pdf = renderToStaticMarkup(<AttachmentsTab assetId="a1" attachments={list} canUpload={false} kind="all" selectedId="q1" hrefFor={hrefFor} />);
    expect(pdf).toMatch(/<iframe[^>]*title="Preview of q1.pdf"[^>]*src="\/inventory\/a1\/documents\/q1\/download\?inline=1"/);
    const img = renderToStaticMarkup(<AttachmentsTab assetId="a1" attachments={list} canUpload={false} kind="photo" selectedId="p1" hrefFor={hrefFor} />);
    expect(img).toMatch(/<img[^>]*alt="p1.jpg"/);
    expect(img).not.toContain("q1.pdf"); // filtered to photos
    // the preview says when and by whom the file was uploaded
    expect(pdf).toMatch(/<iframe/);
    expect(pdf.indexOf("Uploaded 19 Oct 2026 10:00 · Ana Cruz")).toBeGreaterThan(-1);
    expect(pdf.indexOf("Uploaded 19 Oct 2026 10:00 · Ana Cruz")).toBeLessThan(pdf.indexOf("<iframe"));
  });
  it("an attachment nobody uploaded: no stand-in name, in the list or the preview", () => {
    const html = renderToStaticMarkup(
      <AttachmentsTab assetId="a1" attachments={[att("q1", { uploadedBy: null })]} canUpload={false} kind="all" selectedId="q1" hrefFor={hrefFor} />,
    );
    const t = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(t).toContain("Quotation · 19 Oct 2026 10:00 · 1.5 MB");
    expect(t).toContain("Uploaded 19 Oct 2026 10:00");
    expect(t).not.toMatch(/Unknown|system|10:00 ·  ?Uploaded/);
  });
  it("viewers: no upload; empty and filtered-empty states", () => {
    const ro = renderToStaticMarkup(<AttachmentsTab assetId="a1" attachments={list} canUpload={false} kind="all" selectedId={null} hrefFor={hrefFor} />);
    expect(ro).not.toContain("Drop a file here");
    expect(renderToStaticMarkup(<AttachmentsTab assetId="a1" attachments={[]} canUpload kind="all" selectedId={null} hrefFor={hrefFor} />))
      .toContain("No attachments yet");
    expect(renderToStaticMarkup(<AttachmentsTab assetId="a1" attachments={list} canUpload kind="proof-of-payment" selectedId={null} hrefFor={hrefFor} />))
      .toContain("No proof of payment attachments");
  });
});

describe("DocPreview", () => {
  it("Open full size, Download and Close; a PDF in a titled iframe", () => {
    const html = renderToStaticMarkup(<DocPreview assetId="a1" doc={{ id: "d1", fileName: "inv.pdf" }} title="Sales invoice" closeHref="/back" />);
    expect(html).toMatch(/<iframe[^>]*title="Preview of inv.pdf"/);
    expect(html).toMatch(/<a [^>]*href="\/inventory\/a1\/documents\/d1\/download\?inline=1"[^>]*>Open full size/);
    expect(html).toMatch(/<a [^>]*href="\/inventory\/a1\/documents\/d1\/download"[^>]*>Download/);
    expect(html).toMatch(/<a [^>]*href="\/back"[^>]*>Close/);
  });
  it("the uploaded line when it is given; none when it is not", () => {
    const html = renderToStaticMarkup(
      <DocPreview assetId="a1" doc={{ id: "d1", fileName: "inv.pdf" }} uploadedAt="2026-10-22T01:41:00.000Z" uploadedBy="A. Reyes" />,
    );
    expect(html).toContain("Uploaded 22 Oct 2026 09:41 · A. Reyes");
    expect(renderToStaticMarkup(<DocPreview assetId="a1" doc={{ id: "d1", fileName: "inv.pdf" }} uploadedAt="2026-10-22T01:41:00.000Z" uploadedBy={null} />))
      .toContain("Uploaded 22 Oct 2026 09:41<");
    expect(renderToStaticMarkup(<DocPreview assetId="a1" doc={{ id: "d1", fileName: "inv.pdf" }} />)).not.toContain("Uploaded");
  });
  it("a file that cannot preview says so and still downloads", () => {
    const html = renderToStaticMarkup(<DocPreview assetId="a1" doc={{ id: "d1", fileName: "x.docx" }} />);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("can&#x27;t be previewed");
  });
});

describe("AssetPanel (spec §4.1)", () => {
  const props: AssetPanelProps = {
    id: "a1", state: S, tag: "IT-0001", model: "ThinkPad T14", category: "Laptops", serial: "SN1",
    status: "DEPLOYED", statusLabel: "Deployed", reg: "registered", regLabel: "Approved", notCapitalised: false,
    life: {
      usedPct: 39, monthsUsed: 14, lifeMonths: 36, monthsLeft: 22, endsLabel: "Aug 2028",
      costC: 3_600_000, accC: 1_400_000, bookC: 2_200_000, monthlyC: 100_000, depreciatedPct: 39,
    },
    costC: 3_600_000, lifeNote: null,
    holder: { name: "Carla Diaz", href: "/employees/e1" }, worksFor: "Acme Client",
    docs: [
      { kind: "invoice", title: "Sales invoice", file: { id: "d1", fileName: "inv.pdf", size: 2048 } },
      { kind: "official-receipt", title: "Official receipt", file: null },
    ],
  };
  it("the tag is the h1; the ring, book value today, months left and the money list", () => {
    const html = renderToStaticMarkup(<AssetPanel {...props} />);
    expect(html).toMatch(/<h1[^>]*>IT-0001<\/h1>/);
    expect(html).toContain("ThinkPad T14 · Laptops");
    expect(html).toContain("39%");
    expect(html).toContain("₱22,000.00");
    expect(html).toContain("22 of 36 months left · ends Aug 2028");
    for (const s of ["Cost", "Depreciated", "Book value", "Per month"]) expect(html).toContain(s);
  });
  it("Held by links for roles that can open Employees, plain text otherwise; Works for", () => {
    expect(renderToStaticMarkup(<AssetPanel {...props} />)).toContain('href="/employees/e1"');
    const plain = renderToStaticMarkup(<AssetPanel {...props} holder={{ name: "Carla Diaz", href: null }} />);
    expect(plain).toContain("Carla Diaz");
    expect(plain).not.toContain('href="/employees/e1"');
    expect(plain).toContain("Acme Client");
  });
  it("documents: an uploaded one opens the preview; a missing one is dashed and not uploaded", () => {
    const html = renderToStaticMarkup(<AssetPanel {...props} />);
    expect(html).toContain('href="/finance/assets/a1?doc=d1"');
    expect(html).toContain("not uploaded");
    expect(tagWith(html, 'data-missing="true"')).toContain("border-dashed");
    const open = renderToStaticMarkup(<AssetPanel {...props} state={{ ...S, doc: "d1" }} />);
    expect(tagWith(open, 'aria-current="true"')).toContain("doc=d1");
  });
  it("no schedule: no ring, the reason instead", () => {
    const html = renderToStaticMarkup(<AssetPanel {...props} life={null} lifeNote="Not capitalised" />);
    expect(html).not.toContain("months left");
    expect(html).toContain("Not capitalised");
  });
});
