import { describe, expect, it } from "vitest";
import {
  BULK, COLUMNS, DEFAULT_SORT, NO_FILTERS, PER_PAGE, bulkCheckedToast, bulkToast, bulkTriageToast, capNote, categoryChips, categoryOption, categoryTrigger, decisionToast,
  emptyQueue, filterRows, filtersActive, filtersFor, headerCounts, isRed, nextSort, pageFrom, pageLabel, pageOfKey, paginate,
  queueFrom, queueTabs, recordHref, selectAfter, sortRows, workHref,
  focusAfterDecision, isChangedElsewhere, refusalToast, undoReport, focusIsFree, drawerStays, refusedRowLeft,
  MIN_PER_PAGE, ROW_PX, rowsThatFit, shouldRefocusAfterRefresh,
} from "./worklist-view";
import { allRows, approval, groupsOf, leaver, loan, triage, check, hire, purchase } from "./worklist-view.fixtures";
import type { WorkItem } from "./worklist";
import { bulkReport } from "./triage-undo";

const keys = (rows: WorkItem[]) => rows.map((r) => r.key);

describe("queue and page from the URL", () => {
  const groups = groupsOf([check(), loan(true)]);
  it("a known ?q opens that queue, even an empty one", () => {
    expect(queueFrom("loans", groups)).toBe("loans");
    expect(queueFrom("triage", groups)).toBe("triage");
  });
  it("no or an unknown ?q opens the first queue with work in it, else Triage", () => {
    expect(queueFrom(undefined, groups)).toBe("check");
    expect(queueFrom("nope", groups)).toBe("check");
    expect(queueFrom(undefined, [])).toBe("triage");
  });
  it("?page is a whole number from 1", () => {
    expect(pageFrom("3")).toBe(3);
    expect(pageFrom(undefined)).toBe(1);
    expect(pageFrom("0")).toBe(1);
    expect(pageFrom("2.5")).toBe(1);
    expect(pageFrom("x")).toBe(1);
  });
  it("the URL holds queue, page (from 2) and the selected row", () => {
    expect(workHref("triage", 1, null)).toBe("/inventory/work?q=triage");
    expect(workHref("loans", 2, "loans:l1")).toBe("/inventory/work?q=loans&page=2&sel=loans%3Al1");
  });
});

describe("tabs and header counts", () => {
  it("all eight queues, in order, with their totals; an empty queue counts 0", () => {
    const tabs = queueTabs(groupsOf([triage("t1", 5), loan(true)]), "triage");
    expect(tabs.map((t) => [t.label, t.count])).toEqual([
      ["Triage", "1"], ["Repairs", "0"], ["IT check", "0"], ["Purchase reviews", "0"],
      ["New hires", "0"], ["Loans", "1"], ["Missing & records", "0"], ["Approvals & leavers", "0"],
    ]);
    expect(tabs.filter((t) => t.on).map((t) => t.id)).toEqual(["triage"]);
  });
  it("a capped queue's count reads 50+", () => {
    const rows = Array.from({ length: 50 }, (_, i) => triage(`t${i}`, i));
    const tab = queueTabs(groupsOf(rows, ["triage"]), "triage")[0];
    expect(tab.count).toBe("50+");
  });
  it("only a queue with an overdue loan or a breached SLA has a red count", () => {
    const tabs = queueTabs(groupsOf([triage("t1", 200), loan(true), approval("failed")]), "triage");
    expect(tabs.filter((t) => t.fault).map((t) => t.id)).toEqual(["loans"]);
    expect(queueTabs(groupsOf([approval("breached")]), "queue").find((t) => t.id === "queue")?.fault).toBe(true);
  });
  it("{n} waiting on IT sums every queue; {n} overdue counts the red rows (failed approvals never)", () => {
    const groups = groupsOf(allRows());
    // late loan, breached approval, leaver past their completion date
    expect(headerCounts(groups)).toEqual({ waiting: "12", overdue: 3 });
    expect(headerCounts(groupsOf([triage("t1", 1)], ["triage"])).waiting).toBe("1+");
  });
  it("red is only an overdue loan, a breached SLA or an overdue leaver", () => {
    expect(allRows().filter(isRed).map((r) => r.key)).toEqual(["loans:l1", "queue:ap1", "queue:e9"]);
  });
});

describe("filters", () => {
  const rows = [triage("t1", 142), triage("t2", 30, { model: "Dell P2422H", category: "Monitor" }), triage("t3", 95, { category: null })];
  it("category chips: All, then each category with its count, most first", () => {
    expect(categoryChips(rows)).toEqual([
      { label: "All", value: null, count: 3 },
      { label: "Laptop", value: "Laptop", count: 1 },
      { label: "Monitor", value: "Monitor", count: 1 },
      { label: "Uncategorised", value: "Uncategorised", count: 1 },
    ]);
  });
  it("the category menu: Category: All, or the chosen one with its count; each option shows its count", () => {
    const chips = categoryChips(rows);
    expect(categoryTrigger(chips, null)).toBe("Category: All");
    expect(categoryTrigger(chips, "Monitor")).toBe("Category: Monitor (1)");
    // a category the queue no longer holds (its last row decided): still named, with 0
    expect(categoryTrigger(chips, "Printer")).toBe("Category: Printer (0)");
    expect(chips.map(categoryOption)).toEqual(["All (3)", "Laptop (1)", "Monitor (1)", "Uncategorised (1)"]);
  });
  it("a category narrows the rows", () => {
    expect(keys(filterRows(rows, { ...NO_FILTERS, category: "Monitor" }))).toEqual(["triage:t2"]);
  });
  it("Over 90 days keeps rows waiting more than 90 days", () => {
    expect(keys(filterRows(rows, { ...NO_FILTERS, over90: true }))).toEqual(["triage:t1", "triage:t3"]);
  });
  it("search matches tag, model and person, any case", () => {
    expect(keys(filterRows(rows, { ...NO_FILTERS, q: "br-lt-t3" }))).toEqual(["triage:t3"]);
    expect(keys(filterRows(rows, { ...NO_FILTERS, q: "p2422" }))).toEqual(["triage:t2"]);
    expect(keys(filterRows(rows, { ...NO_FILTERS, q: "maria" }))).toHaveLength(3);
    expect(keys(filterRows(rows, { ...NO_FILTERS, q: "nobody" }))).toEqual([]);
  });
  it("filters combine", () => {
    expect(keys(filterRows(rows, { category: "Laptop", over90: true, q: "thinkpad" }))).toEqual(["triage:t1"]);
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, q: "  " })).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, over90: true })).toBe(true);
  });
  it("chips only for asset queues; Over 90 days wherever rows have an age", () => {
    expect(filtersFor("triage")).toEqual({ category: true, over90: true });
    expect(filtersFor("loans")).toEqual({ category: true, over90: false });
    expect(filtersFor("purchases")).toEqual({ category: false, over90: true });
    expect(filtersFor("hires")).toEqual({ category: false, over90: false });
  });
});

describe("sort", () => {
  const a = triage("ta", 10, { model: "Zebra" });
  const b = triage("tb", 200, { model: "apple" });
  const c = triage("tc", 50, { model: "Mango" });
  it("each queue opens in the worklist's own order, named by a column where one states it", () => {
    expect(DEFAULT_SORT.triage).toEqual({ key: "waiting", dir: "desc" });
    expect(DEFAULT_SORT.loans).toBeNull();
    expect(COLUMNS.triage.map((col) => col.label)).toEqual(["Item", "Last holder", "Returned", "Waiting"]);
    expect(COLUMNS.queue.map((col) => col.label)).toEqual(["What", "Who", "Waiting", "SLA"]);
  });
  it("sorts by a number either way", () => {
    expect(keys(sortRows([a, b, c], { key: "waiting", dir: "desc" }))).toEqual(["triage:tb", "triage:tc", "triage:ta"]);
    expect(keys(sortRows([a, b, c], { key: "waiting", dir: "asc" }))).toEqual(["triage:ta", "triage:tc", "triage:tb"]);
  });
  it("sorts words without regard to case", () => {
    expect(keys(sortRows([a, b, c], { key: "item", dir: "asc" }))).toEqual(["triage:tb", "triage:tc", "triage:ta"]);
  });
  it("a missing value sorts last whichever way", () => {
    const none = triage("tn", 5, {});
    const noHolder: WorkItem = { ...none, columns: { ...none.columns, lastHolder: null } as WorkItem["columns"] };
    expect(keys(sortRows([noHolder, a], { key: "lastHolder", dir: "asc" }))).toEqual(["triage:ta", "triage:tn"]);
    expect(keys(sortRows([noHolder, a], { key: "lastHolder", dir: "desc" }))).toEqual(["triage:ta", "triage:tn"]);
  });
  it("null keeps the order it was given", () => {
    expect(keys(sortRows([a, b, c], null))).toEqual(["triage:ta", "triage:tb", "triage:tc"]);
  });
  it("a header click flips its own column, and starts a new one descending for numbers, ascending for words", () => {
    expect(nextSort({ key: "waiting", dir: "desc" }, "waiting", true)).toEqual({ key: "waiting", dir: "asc" });
    expect(nextSort({ key: "waiting", dir: "desc" }, "item", false)).toEqual({ key: "item", dir: "asc" });
    expect(nextSort(null, "waiting", true)).toEqual({ key: "waiting", dir: "desc" });
  });
});

describe("pager", () => {
  const rows = Array.from({ length: 23 }, (_, i) => triage(`t${i}`, i));
  it("ten rows a page, labelled 1–10 of 23", () => {
    const p = paginate(rows, 1);
    expect(PER_PAGE).toBe(10);
    expect(p.rows).toHaveLength(10);
    expect(pageLabel(p)).toBe("1–10 of 23");
    expect(pageLabel(paginate(rows, 3))).toBe("21–23 of 23");
  });
  it("a page past the end shows the last one; nothing reads 0 items", () => {
    expect(paginate(rows, 9).page).toBe(3);
    expect(pageLabel(paginate([], 1))).toBe("0 items");
  });
  it("a capped queue's last page says so; other pages and uncapped queues do not", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => triage(`t${i}`, i));
    const g = groupsOf(fifty, ["triage"])[0];
    expect(capNote(g, paginate(fifty, 5))).toBe("Showing the first 50 — clear some to see more");
    expect(capNote(g, paginate(fifty, 4))).toBeNull();
    expect(capNote(groupsOf(fifty)[0], paginate(fifty, 5))).toBeNull();
  });
  it("finds the page a selected row is on", () => {
    expect(pageOfKey(rows, "triage:t12")).toBe(2);
    expect(pageOfKey(rows, "triage:none")).toBeNull();
    expect(pageOfKey(rows, null)).toBeNull();
  });
});

describe("decide → next", () => {
  const rows = [triage("t1", 9), triage("t2", 8), triage("t3", 7)];
  it("selects the row after the one decided", () => {
    expect(selectAfter(rows, new Set(["triage:t2"]), "triage:t2")).toBe("triage:t3");
  });
  it("the last row decided selects the one before it", () => {
    expect(selectAfter(rows, new Set(["triage:t3"]), "triage:t3")).toBe("triage:t2");
  });
  it("a bulk decision keeps a selection it did not touch, else moves past the decided rows", () => {
    expect(selectAfter(rows, new Set(["triage:t1", "triage:t2"]), "triage:t3")).toBe("triage:t3");
    expect(selectAfter(rows, new Set(["triage:t1", "triage:t2"]), "triage:t1")).toBe("triage:t3");
  });
  it("nothing left selects nothing", () => {
    expect(selectAfter(rows, new Set(keys(rows)), "triage:t1")).toBeNull();
  });
});

describe("copy", () => {
  it("the toasts read verbatim", () => {
    expect(decisionToast("SPARE", "ThinkPad T14")).toBe("ThinkPad T14 · kept as a spare");
    expect(decisionToast("DEFECTIVE", "ThinkPad T14")).toBe("ThinkPad T14 · sent to repair");
    expect(bulkTriageToast("SPARE", 3)).toBe("3 items · kept as spares");
    expect(bulkTriageToast("DEFECTIVE", 2)).toBe("2 items · sent to repair");
    expect(bulkCheckedToast(4)).toBe("4 items · checked");
  });
  it("the empty queue reads All clear / Nothing left in {queue}.", () => {
    expect(emptyQueue("triage")).toEqual({ title: "All clear", text: "Nothing left in Triage." });
    expect(emptyQueue("queue").text).toBe("Nothing left in Approvals & leavers.");
  });
  it("only Triage and IT check take ticks", () => {
    expect(BULK.triage?.map((b) => b.label)).toEqual(["Keep as spares", "Send to repair"]);
    expect(BULK.check?.map((b) => b.label)).toEqual(["Mark checked"]);
    expect(BULK.loans).toBeUndefined();
  });
  it("the record link: an asset's record, a person's profile, else the row's own page", () => {
    expect(recordHref(check())).toBe("/inventory/c1");
    expect(recordHref(hire())).toBe("/employees/e1");
    expect(recordHref(leaver())).toBe("/employees/e9");
    expect(recordHref(purchase())).toBe("/purchases/pr1");
  });
});

describe("bulk toast", () => {
  it("several done read {n} items · …; one done reads like a single decision", () => {
    expect(bulkToast("SPARE", [{ model: "A" }, { model: "B" }], 0)).toEqual({ message: "2 items · kept as spares", tone: "settled" });
    expect(bulkToast("DEFECTIVE", [{ model: "Dell P2422H" }], 0)).toEqual({ message: "Dell P2422H · sent to repair", tone: "settled" });
    expect(bulkToast("CHECK", [{ model: "A" }, { model: "B" }, { model: "C" }], 0).message).toBe("3 items · checked");
  });
  it("mixed results carry the report as the detail", () => {
    expect(bulkToast("SPARE", [{ model: "A" }, { model: "B" }], 1)).toEqual({
      message: "2 items · kept as spares", tone: "settled", detail: "2 done, 1 couldn't (changed by someone else)",
    });
  });
  it("none done is an error with the report", () => {
    expect(bulkToast("DEFECTIVE", [], 3)).toEqual({ message: "Nothing changed", tone: "fault", detail: "0 done, 3 couldn't (changed by someone else)" });
  });
  it("the report matches the server's bulkReport words", () => {
    expect(bulkToast("SPARE", [{ model: "A" }], 1).detail).toBe(bulkReport(1, 1));
  });
});

describe("fix round 1", () => {
  it("M1: the first click on SLA, Status or Due puts the red rows first", () => {
    expect(nextSort(null, "sla", true)).toEqual({ key: "sla", dir: "asc" });
    expect(nextSort(null, "status", true)).toEqual({ key: "status", dir: "asc" });
    expect(nextSort({ key: "waiting", dir: "desc" }, "due", true)).toEqual({ key: "due", dir: "asc" });
    const queue = [approval("failed"), leaver(), approval("breached")];
    const first = sortRows(queue, nextSort(null, "sla", true));
    expect(first.slice(0, 2).every(isRed)).toBe(true);
    const loans = [loan(false), loan(true)];
    expect(sortRows(loans, nextSort(null, "status", true))[0].key).toBe("loans:l1");
    expect(sortRows(loans, nextSort(null, "due", true))[0].key).toBe("loans:l1");
  });

  it("M3: only the real changed-since refusals read as changed by someone else", () => {
    expect(isChangedElsewhere("Changed by someone else since — open the record")).toBe(true);
    expect(isChangedElsewhere("Changed by someone else since — try again")).toBe(true);
    expect(isChangedElsewhere("BR-LT-0002 is not waiting for triage.")).toBe(true);
    expect(isChangedElsewhere("BR-LT-0002 was already checked.")).toBe(false);
    expect(isChangedElsewhere("BR-LT-0002 has an open request (APR-2040).")).toBe(false);
  });

  it("M3/M5: a changed-since refusal's toast title says try again; the server's sentence is the detail", () => {
    expect(refusalToast("BR-LT-0002 is not waiting for triage.")).toEqual({
      message: "Changed by someone else since — try again", detail: "BR-LT-0002 is not waiting for triage.", moveOn: true,
    });
    expect(refusalToast("Changed by someone else since — try again")).toEqual({ message: "Changed by someone else since — try again", moveOn: true });
    expect(refusalToast("BR-LT-0002 was already checked.")).toEqual({ message: "BR-LT-0002 was already checked.", moveOn: false });
  });

  it("M5: a partial bulk undo reads {done} undone, {failed} couldn't ({reason})", () => {
    expect(undoReport(2, 1, "Changed by someone else since — open the record"))
      .toBe("2 undone, 1 couldn't (Changed by someone else since — open the record)");
  });

  it("I1: focus after a decision — the next row's first panel action, the drawer's on a narrow window, else the empty state", () => {
    const actions = "[data-panel-actions] button:not([disabled]):not([aria-disabled=\"true\"]), [data-panel-actions] a[href], [data-panel-actions] textarea";
    expect(focusAfterDecision("triage:t2", true)).toEqual({ kind: "panel", selector: `[data-worklist-panel] :is(${actions})` });
    expect(focusAfterDecision("triage:t2", false)).toEqual({ kind: "drawer", selector: `[data-worklist-drawer] :is(${actions})` });
    expect(focusAfterDecision(null, true)).toEqual({ kind: "empty", selector: "[data-worklist-empty]" });
    expect(focusAfterDecision(null, false)).toEqual({ kind: "empty", selector: "[data-worklist-empty]" });
  });
});

describe("Task 4 carried fixes", () => {
  it("2: focus never leaves a text field the person is typing in", () => {
    expect(focusIsFree(null)).toBe(true);
    expect(focusIsFree({ tagName: "BODY" })).toBe(true);
    expect(focusIsFree({ tagName: "BUTTON" })).toBe(true);
    expect(focusIsFree({ tagName: "TR" })).toBe(true);
    expect(focusIsFree({ tagName: "INPUT", type: "checkbox" })).toBe(true);
    expect(focusIsFree({ tagName: "INPUT", type: "search" })).toBe(false);
    expect(focusIsFree({ tagName: "INPUT", type: "text" })).toBe(false);
    expect(focusIsFree({ tagName: "INPUT" })).toBe(false);
    expect(focusIsFree({ tagName: "TEXTAREA" })).toBe(false);
    expect(focusIsFree({ tagName: "SELECT" })).toBe(false);
    expect(focusIsFree({ tagName: "DIV", isContentEditable: true })).toBe(false);
  });

  it("4: the drawer closes for good once no row is left", () => {
    expect(drawerStays(true, "triage:t1")).toBe(true);
    expect(drawerStays(true, null)).toBe(false);
    expect(drawerStays(false, "triage:t1")).toBe(false);
  });

  it("1: a refused row the refresh dropped sends focus on", () => {
    expect(refusedRowLeft("triage:t1", new Set(["triage:t2"]))).toBe(true);
    expect(refusedRowLeft("triage:t1", new Set(["triage:t1"]))).toBe(false);
    expect(refusedRowLeft(null, new Set())).toBe(false);
  });
});

describe("final review fix wave: rows per page", () => {
  it("rowsThatFit: as many 52 px rows as the box holds, 6 to 10", () => {
    expect(ROW_PX).toBe(52);
    expect(MIN_PER_PAGE).toBe(6);
    expect(rowsThatFit(8 * 52)).toBe(8);
    expect(rowsThatFit(8 * 52 - 1)).toBe(7);
    expect(rowsThatFit(7 * 52 + 51)).toBe(7);
    expect(rowsThatFit(10 * 52)).toBe(10);
    expect(rowsThatFit(2000)).toBe(10);
    expect(rowsThatFit(231)).toBe(6);
    expect(rowsThatFit(0)).toBe(10);
    expect(rowsThatFit(-5)).toBe(10);
  });
  it("paginate and pageLabel with 6 and 10 rows a page", () => {
    const rows = Array.from({ length: 12 }, (_, i) => triage(`t${i + 1}`, 100 - i));
    expect(pageLabel(paginate(rows, 1, 6))).toBe("1–6 of 12");
    expect(pageLabel(paginate(rows, 2, 6))).toBe("7–12 of 12");
    expect(paginate(rows, 3, 6)).toMatchObject({ page: 2, pageCount: 2 });
    expect(pageLabel(paginate(rows, 2, 10))).toBe("11–12 of 12");
    expect(paginate(rows, 1)).toMatchObject({ pageCount: 2, end: PER_PAGE });
  });
  it("pageOfKey follows a perPage change: the same row, its new page", () => {
    const rows = Array.from({ length: 12 }, (_, i) => triage(`t${i + 1}`, 100 - i));
    expect(pageOfKey(rows, "triage:t7", 10)).toBe(1);
    expect(pageOfKey(rows, "triage:t7", 6)).toBe(2);
    expect(pageOfKey(rows, "triage:t7", 7)).toBe(1);
    expect(pageOfKey(rows, "triage:t12", 6)).toBe(2);
    expect(pageOfKey(rows, "triage:t12")).toBe(2);
    for (const per of [6, 7, 8, 9, 10]) {
      for (const r of rows) {
        const p = pageOfKey(rows, r.key, per)!;
        expect(paginate(rows, p, per).rows.map((x) => x.key)).toContain(r.key);
      }
    }
  });
  it("I1: after a refusal's refresh, focus moves again only when the refused row was still selected or focus fell to the body", () => {
    expect(shouldRefocusAfterRefresh("triage:t1", "triage:t1", false)).toBe(true);
    expect(shouldRefocusAfterRefresh("triage:t1", "triage:t2", false)).toBe(false);
    expect(shouldRefocusAfterRefresh("triage:t1", "triage:t2", true)).toBe(true);
    expect(shouldRefocusAfterRefresh(null, "triage:t2", true)).toBe(false);
  });
});
