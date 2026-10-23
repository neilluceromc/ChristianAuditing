import { describe, expect, it } from "vitest";
import {
  RETURN_NOTE_LABEL, approvalItem, checkItem, groupWork, hireItem, historyByAsset, lastReturnByAsset, leaverItem, loanItem,
  loanStatus, missingItem, noteText, purchaseReviewItem, repairItem, sectionStats, triageItem, warrantyFact,
  type ColumnsOf, type WorkAssetLike, type WorkGroup, type WorkItem, type WorkSectionId,
} from "./worklist";

/* Worklist split view (H4) Task 1: every row carries its table columns and a details panel's facts. */

// Fri 23 Oct 2026, 10:00 in Manila
const NOW = new Date("2026-10-23T10:00:00+08:00");
const day = (iso: string) => new Date(`${iso}T10:00:00+08:00`);

const asset = (over: Partial<WorkAssetLike> = {}): WorkAssetLike => ({
  id: "a1", tag: "BR-LT-1025", model: "ThinkPad T14 Gen 4", serial: "PF4K9Z2A", category: "Laptop",
  purchasedAt: day("2023-08-10"), cost: 78500, warrantyUntil: day("2026-08-10"),
  history: [{ at: day("2026-06-03"), text: "Neil Lucero returned for triage" }],
  ...over,
});
const factsOf = (i: WorkItem) => Object.fromEntries(i.detail.facts.map((f) => [f.label, f.value]));
const cols = <S extends WorkSectionId>(i: WorkItem, s: S) => {
  expect(i.columns.section).toBe(s);
  return i.columns as ColumnsOf<S>;
};

describe("warrantyFact", () => {
  it("reads 'until …' while it runs, in the good tone", () => {
    expect(warrantyFact(day("2026-10-23"), NOW)).toEqual({ label: "Warranty", value: "until 23 Oct 2026", tone: "good" });
    expect(warrantyFact(day("2027-01-05"), NOW)).toEqual({ label: "Warranty", value: "until 05 Jan 2027", tone: "good" });
  });
  it("reads 'ended …' once it has passed, muted", () => {
    expect(warrantyFact(day("2026-10-22"), NOW)).toEqual({ label: "Warranty", value: "ended 22 Oct 2026", tone: "muted" });
  });
  it("says Not recorded when there is no date", () => {
    expect(warrantyFact(null, NOW)).toEqual({ label: "Warranty", value: "Not recorded", tone: "muted" });
  });
});

describe("lastReturnByAsset", () => {
  const ret = (assetId: string, at: string, name: string, reason: unknown, kind: "INTERNAL" | "CLIENT" = "INTERNAL") => ({
    assetId, createdAt: day(at), payload: { reason }, requestedBy: { name: "Neil Lucero" },
    employee: { name, department: { name: kind === "CLIENT" ? "Acme" : "Finance", kind } },
  });
  it("keeps the latest return per asset, whatever order the rows come in", () => {
    const m = lastReturnByAsset([
      ret("a1", "2026-01-05", "Old Holder", "first"),
      ret("a1", "2026-06-03", "Maria Reyes", "Battery drains fast."),
      ret("a2", "2026-07-10", "Ana Lim", "", "CLIENT"),
      ret("a1", "2026-03-01", "Middle Holder", "second"),
    ]);
    expect(m.get("a1")).toEqual({
      holder: { name: "Maria Reyes", group: { name: "Finance", kind: "INTERNAL" } },
      reason: "Battery drains fast.", recordedBy: "Neil Lucero", at: day("2026-06-03"),
    });
    expect(m.get("a2")?.holder).toEqual({ name: "Ana Lim", group: { name: "Acme", kind: "CLIENT" } });
    expect(m.get("a2")?.reason).toBeNull();
  });
  it("a return with no employee or no reason reads as unknown, not as a crash", () => {
    const m = lastReturnByAsset([{ assetId: "a1", createdAt: day("2026-06-03"), payload: null, requestedBy: null, employee: null }]);
    expect(m.get("a1")).toEqual({ holder: null, reason: null, recordedBy: null, at: day("2026-06-03") });
  });
});

describe("historyByAsset", () => {
  const e = (entityId: string, at: string, action: string, diff: unknown = null) =>
    ({ entityId, createdAt: day(at), action, diff, actorLabel: "Neil Lucero" });
  it("keeps the newest three per asset, newest first, as audit sentences without the tag", () => {
    const m = historyByAsset([
      e("a1", "2026-01-01", "register"),
      e("a1", "2026-02-01", "lifecycle.assign", { assignee: { from: null, to: "EMP-0042" } }),
      e("a1", "2026-06-03", "lifecycle.return", { returnedAt: { from: null, to: "2026-06-03" } }),
      e("a1", "2026-03-01", "lifecycle.change-status", { status: { from: "DEPLOYED", to: "TEMPORARY" } }),
      e("a2", "2026-05-01", "create"),
    ], new Map([["a1", "BR-LT-1025"], ["a2", "BR-MN-1021"]]));
    expect(m.get("a1")).toEqual([
      { at: day("2026-06-03"), text: "Neil Lucero returned for triage" },
      { at: day("2026-03-01"), text: "Neil Lucero changed to Loan" },
      { at: day("2026-02-01"), text: "Neil Lucero assigned to EMP-0042" },
    ]);
    expect(m.get("a2")).toEqual([{ at: day("2026-05-01"), text: "Neil Lucero created" }]);
  });
});

describe("historyByAsset ties (fix round 1, M3)", () => {
  it("entries with the same timestamp keep the read's order (the SQL's id DESC tie-break)", () => {
    const at = day("2026-01-01");
    const m = historyByAsset([
      { entityId: "a1", createdAt: at, action: "lifecycle.assign", diff: { assignee: { from: null, to: "EMP-0042" } }, actorLabel: "Neil Lucero" },
      { entityId: "a1", createdAt: at, action: "register", diff: null, actorLabel: "Neil Lucero" },
    ], new Map([["a1", "BR-LT-1025"]]));
    expect(m.get("a1")?.map((h) => h.text)).toEqual(["Neil Lucero assigned to EMP-0042", "Neil Lucero registered"]);
  });
});

describe("noteText (fix round 1, M2): the app's own default reasons are not notes", () => {
  it.each([
    "offboarding · returned", "assigned", "bulk assigned", "triage", "reserved — day-one setup",
    "replaced by BR-LT-0148", "replaces BR-LT-0148", "  triage  ", "", "   ",
  ])("%j is no note", (reason) => expect(noteText(reason)).toBeNull());
  it("a typed reason is kept, trimmed — even one that starts like a default", () => {
    expect(noteText("  Battery drains fast. ")).toBe("Battery drains fast.");
    expect(noteText("assigned to the wrong person")).toBe("assigned to the wrong person");
    expect(noteText("replaced by BR-LT-0148 because the screen cracked")).toBe("replaced by BR-LT-0148 because the screen cracked");
    expect(noteText(42)).toBeNull();
  });
});

describe("triageItem", () => {
  const lastReturn = {
    holder: { name: "Maria Reyes", group: { name: "Finance", kind: "INTERNAL" as const } },
    reason: "Battery drains fast.", recordedBy: "Neil Lucero", at: day("2026-06-03"),
  };
  const item = (over: Partial<Parameters<typeof triageItem>[0]> = {}) =>
    triageItem({ ...asset(), returnedAt: day("2026-06-03"), lastReturn, ...over }, NOW);

  it("keeps the row Home reads, unchanged", () => {
    expect(item()).toMatchObject({
      key: "triage:a1", section: "triage", title: "BR-LT-1025 · ThinkPad T14 Gen 4", meta: "back 142 d · triage it",
      href: "/inventory/a1", action: "Triage", severity: 142, ageDays: 142,
      control: { kind: "triage", asset: { id: "a1", tag: "BR-LT-1025", model: "ThinkPad T14 Gen 4" } },
      entity: { kind: "asset", id: "a1", label: "BR-LT-1025" },
    });
  });
  it("columns: item, last holder from the latest return approval, returned, waiting", () => {
    expect(cols(item(), "triage")).toEqual({
      section: "triage",
      item: { model: "ThinkPad T14 Gen 4", category: "Laptop", tag: "BR-LT-1025" },
      lastHolder: { name: "Maria Reyes", group: { name: "Finance", kind: "INTERNAL" } },
      returnedAt: day("2026-06-03"), waitingDays: 142, cost: 78500,
    });
  });
  it("facts: serial, last holder and department, returned, bought, warranty", () => {
    const i = item();
    expect(i.detail.facts).toEqual([
      { label: "Serial", value: "PF4K9Z2A", mono: true },
      { label: "Last holder", value: "Maria Reyes · Finance" },
      { label: "Returned", value: "03 Jun 2026 · 142 days ago" },
      { label: "Bought", value: "10 Aug 2023 · ₱78,500" },
      { label: "Warranty", value: "ended 10 Aug 2026", tone: "muted" },
    ]);
    expect(i.detail.note).toEqual({ label: "Note when returned", text: "Battery drains fast.", by: "Neil Lucero" });
    expect(i.detail.history).toEqual([{ at: day("2026-06-03"), text: "Neil Lucero returned for triage" }]);
  });
  it("a client holder reads Client: name", () => {
    const i = item({ lastReturn: { ...lastReturn, holder: { name: "Ana Lim", group: { name: "Northwind", kind: "CLIENT" } } } });
    expect(factsOf(i)["Last holder"]).toBe("Ana Lim · Client: Northwind");
  });
  it("the note is labelled by the ruling, and its by is the recorder", () => {
    expect(RETURN_NOTE_LABEL).toBe("Note when returned");
    expect(item().detail.note?.by).toBe("Neil Lucero");
  });
  it("the hand-back note is omitted when blank", () => {
    expect("note" in item({ lastReturn: { ...lastReturn, reason: "   " } }).detail).toBe(false);
    expect("note" in item({ lastReturn: { ...lastReturn, reason: null } }).detail).toBe(false);
    expect("note" in item({ lastReturn: null }).detail).toBe(false);
  });
  it("with no return approval the last holder is unknown, and missing fields say Not recorded", () => {
    const i = item({ lastReturn: null, serial: null, purchasedAt: null, cost: null, warrantyUntil: null });
    expect(cols(i, "triage").lastHolder).toBeNull();
    expect(i.detail.facts.filter((f) => f.value === "Not recorded").map((f) => f.label))
      .toEqual(["Serial", "Last holder", "Bought", "Warranty"]);
  });
});

describe("repairItem", () => {
  const base = {
    ...asset({ cost: 10000 }), status: "DEFECTIVE", vendorId: "v1", vendor: "iServe", rmaRef: "RMA-77",
    repairQuote: 6500, defectiveSince: day("2026-10-01"), repairEndedAt: null,
  };
  it("keeps the row and adds item, vendor, stage, down", () => {
    const i = repairItem(base, NOW);
    expect(i).toMatchObject({
      key: "repairs:a1", title: "BR-LT-1025 · ThinkPad T14 Gen 4",
      meta: "BEYOND REPAIR · iServe · RMA-77 · down 22 d · beyond repair", action: "Chase", severity: 22, ageDays: 22,
    });
    expect(cols(i, "repairs")).toEqual({
      section: "repairs", item: { model: "ThinkPad T14 Gen 4", category: "Laptop", tag: "BR-LT-1025" },
      vendor: "iServe", stage: "beyond-repair", downDays: 22,
    });
    expect(factsOf(i)).toMatchObject({
      Vendor: "iServe", RMA: "RMA-77", Quote: "₱6,500 · beyond repair", "Down since": "01 Oct 2026 · 22 days",
    });
  });
  it("no vendor reads Not sent; no RMA or quote leaves them out", () => {
    const i = repairItem({ ...base, vendorId: null, vendor: null, rmaRef: null, repairQuote: null }, NOW);
    expect(cols(i, "repairs")).toMatchObject({ vendor: null, stage: "to-assess" });
    expect(i.meta).toBe("TO ASSESS · no vendor · down 22 d");
    expect(factsOf(i).Vendor).toBe("Not sent");
    expect(i.detail.facts.map((f) => f.label)).not.toContain("RMA");
    expect(i.detail.facts.map((f) => f.label)).not.toContain("Quote");
  });
});

describe("checkItem", () => {
  it("keeps the row and adds who registered it and the PO it came from", () => {
    const i = checkItem({
      ...asset(), createdAt: day("2026-10-16"), registeredBy: "Pia Santos", fromPo: { id: "po1", refNo: "PO-0188" },
    }, NOW);
    expect(i).toMatchObject({
      key: "check:a1", title: "BR-LT-1025 · ThinkPad T14 Gen 4", meta: "registered by Purchasing · 7 d waiting",
      action: "Check", control: { kind: "it-check", asset: { id: "a1", tag: "BR-LT-1025" } },
    });
    expect(cols(i, "check")).toEqual({
      section: "check", item: { model: "ThinkPad T14 Gen 4", category: "Laptop", tag: "BR-LT-1025" },
      registeredBy: "Pia Santos", fromPo: { id: "po1", refNo: "PO-0188" }, waitingDays: 7,
    });
    expect(factsOf(i)).toMatchObject({ "Registered by": "Pia Santos", "From PO": "PO-0188", Registered: "16 Oct 2026 · 7 days ago" });
  });
  it("a registration with no PO says so", () => {
    const i = checkItem({ ...asset(), createdAt: day("2026-10-23"), registeredBy: null, fromPo: null }, NOW);
    expect(factsOf(i)).toMatchObject({ "Registered by": "Not recorded", "From PO": "No PO", Registered: "23 Oct 2026 · today" });
  });
});

describe("purchaseReviewItem", () => {
  const base = {
    id: "pr1", refNo: "PO-0198", submittedAt: day("2026-10-19"), updatedAt: day("2026-10-01"),
    requestedBy: "Pia Santos", department: "HR", firstLine: "27-inch monitors", lines: 2,
    vendor: "PC Express", siNumber: "SI-4471", total: 23800, amountDue: null,
  };
  it("keeps the row and adds PO, vendor, SI number, total, waiting", () => {
    const i = purchaseReviewItem(base, NOW);
    expect(i).toMatchObject({ key: "purchases:pr1", title: "PO-0198 · 27-inch monitors +1 more", action: "Review", ageDays: 4 });
    expect(cols(i, "purchases")).toEqual({
      section: "purchases", po: { refNo: "PO-0198", summary: "27-inch monitors +1 more" },
      vendor: "PC Express", siNumber: "SI-4471", total: 23800, waitingDays: 4,
    });
    expect(i.detail.facts).toEqual([
      { label: "Requested by", value: "Pia Santos" },
      { label: "Department", value: "HR" },
      { label: "Vendor", value: "PC Express" },
      { label: "SI number", value: "SI-4471", mono: true },
      { label: "Total", value: "₱23,800" },
      { label: "Lines", value: "2 lines" },
      { label: "With IT since", value: "19 Oct 2026 · 4 days ago" },
    ]);
    expect(i.detail.history).toEqual([]);
  });
  it("the typed amount due is its own fact, after Total, only when present", () => {
    const i = purchaseReviewItem({ ...base, amountDue: 23520.5 }, NOW);
    const labels = i.detail.facts.map((f) => f.label);
    expect(labels.slice(labels.indexOf("Total"), labels.indexOf("Total") + 2)).toEqual(["Total", "Amount due"]);
    expect(i.detail.facts).toContainEqual({ label: "Amount due", value: "₱23,521" });
    expect(cols(i, "purchases").total).toBe(23800);
    expect(purchaseReviewItem(base, NOW).detail.facts.map((f) => f.label)).not.toContain("Amount due");
    expect(purchaseReviewItem({ ...base, amountDue: 0 }, NOW).detail.facts).toContainEqual({ label: "Amount due", value: "₱0" });
  });
  it("no vendor or SI yet reads Not recorded", () => {
    const i = purchaseReviewItem({ ...base, vendor: null, siNumber: null, department: null, firstLine: null, lines: 0 }, NOW);
    expect(cols(i, "purchases")).toMatchObject({ po: { refNo: "PO-0198", summary: null }, vendor: null, siNumber: null });
    expect(factsOf(i)).toMatchObject({ Vendor: "Not recorded", "SI number": "Not recorded", Department: "Not recorded", Lines: "0 lines" });
  });
});

describe("hireItem", () => {
  it("keeps the row and adds person, department or client, started, missing slots", () => {
    const i = hireItem({
      id: "e1", name: "Ana Lim", employeeNo: "EMP-0042", title: "Support agent", joinedAt: day("2026-10-13"),
      group: { name: "Acme", kind: "CLIENT" }, policyName: "Acme agents", missingSlots: ["Laptop", "Headset"],
    }, NOW);
    expect(i).toMatchObject({
      key: "hires:e1", title: "Ana Lim started 10 d ago", meta: "EMP-0042 · 2 required slots empty · Acme agents",
      href: "/employees/e1#loadout", action: "Fill loadout", severity: 10, ageDays: 10,
    });
    expect(cols(i, "hires")).toEqual({
      section: "hires", person: { name: "Ana Lim", employeeNo: "EMP-0042" },
      group: { name: "Acme", kind: "CLIENT" }, startedAt: day("2026-10-13"), missingSlots: 2,
    });
    expect(i.detail.facts).toEqual([
      { label: "Employee no.", value: "EMP-0042", mono: true },
      { label: "Client", value: "Acme" },
      { label: "Title", value: "Support agent" },
      { label: "Started", value: "13 Oct 2026 · 10 days ago" },
      { label: "Equipment list", value: "Acme agents" },
      { label: "Missing", value: "Laptop, Headset" },
    ]);
  });
  it("one slot, a department and a personal loadout", () => {
    const i = hireItem({
      id: "e2", name: "Bo Sy", employeeNo: "EMP-0050", title: "Analyst", joinedAt: day("2026-10-22"),
      group: { name: "Finance", kind: "INTERNAL" }, policyName: null, missingSlots: ["Laptop"],
    }, NOW);
    expect(i.meta).toBe("EMP-0050 · 1 required slot empty · personal loadout");
    expect(factsOf(i)).toMatchObject({ Department: "Finance", "Equipment list": "Personal loadout" });
  });
});

describe("loanStatus", () => {
  it("late, today, tomorrow, a weekday this week, a date a week out, no due date", () => {
    expect(loanStatus(day("2026-10-15"), NOW)).toEqual({ text: "8 days late", late: true, days: -8 });
    expect(loanStatus(day("2026-10-22"), NOW)).toEqual({ text: "1 day late", late: true, days: -1 });
    expect(loanStatus(day("2026-10-23"), NOW)).toEqual({ text: "due today", late: false, days: 0 });
    expect(loanStatus(day("2026-10-24"), NOW)).toEqual({ text: "due tomorrow", late: false, days: 1 });
    expect(loanStatus(day("2026-10-27"), NOW)).toEqual({ text: "due Tue", late: false, days: 4 });
    expect(loanStatus(day("2026-10-30"), NOW)).toEqual({ text: "due 30 Oct", late: false, days: 7 });
    expect(loanStatus(null, NOW)).toEqual({ text: "no due date", late: false, days: null });
  });
});

describe("loanItem", () => {
  const borrower = { name: "Ana Lim", group: { name: "Northwind", kind: "CLIENT" as const } };
  it("keeps loanRow's row and adds item, borrower, due, status", () => {
    const i = loanItem({ ...asset(), loanDueAt: day("2026-10-15"), borrower }, NOW)!;
    expect(i).toMatchObject({ key: "loans:a1", title: "BR-LT-1025 overdue by 8 d", meta: "Ana Lim · due 15 Oct 2026", overdue: true });
    expect(cols(i, "loans")).toEqual({
      section: "loans", item: { model: "ThinkPad T14 Gen 4", category: "Laptop", tag: "BR-LT-1025" },
      borrower, dueAt: day("2026-10-15"), dueDays: -8, status: "8 days late", late: true,
    });
    expect(i.detail.facts).toContainEqual({ label: "Status", value: "8 days late", tone: "fault" });
    expect(factsOf(i)).toMatchObject({ Borrower: "Ana Lim · Client: Northwind", Due: "15 Oct 2026" });
  });
  it("no due date; and a loan not due soon is not a row", () => {
    const i = loanItem({ ...asset(), loanDueAt: null, borrower: null }, NOW)!;
    expect(cols(i, "loans")).toMatchObject({ status: "no due date", late: false, dueDays: null, borrower: null });
    expect(factsOf(i)).toMatchObject({ Due: "No due date", Borrower: "Not recorded" });
    expect(loanItem({ ...asset(), loanDueAt: day("2026-12-01"), borrower }, NOW)).toBeNull();
  });
});

describe("missingItem", () => {
  const lastReturn = {
    holder: { name: "Maria Reyes", group: { name: "Finance", kind: "INTERNAL" as const } },
    reason: "Left it in a taxi.", recordedBy: "Neil Lucero", at: day("2026-10-13"),
  };
  it("missing: keeps the row, the last holder from the return, and the return's note", () => {
    const i = missingItem({ ...asset(), problem: "missing", updatedAt: day("2026-10-13"), holder: null, lastReturn }, NOW);
    expect(i).toMatchObject({ key: "missing:a1", title: "BR-LT-1025 is missing", meta: "ThinkPad T14 Gen 4 · custody lost 10 d ago", action: "Investigate" });
    expect(cols(i, "missing")).toEqual({
      section: "missing", item: { model: "ThinkPad T14 Gen 4", category: "Laptop", tag: "BR-LT-1025" },
      problem: "Missing", lastHolder: lastReturn.holder, since: day("2026-10-13"), sinceDays: 10,
    });
    expect(factsOf(i)).toMatchObject({ Problem: "Missing", "Last holder": "Maria Reyes · Finance", Since: "13 Oct 2026 · 10 days" });
    expect(i.detail.note).toEqual({ label: "Note when returned", text: "Left it in a taxi.", by: "Neil Lucero" });
  });
  it("orphaned: Deployed with no holder, no hand-back note", () => {
    const i = missingItem({ ...asset(), problem: "orphaned", updatedAt: day("2026-10-20"), holder: null, lastReturn }, NOW);
    expect(i).toMatchObject({ title: "BR-LT-1025 reads Deployed with no holder", meta: "ThinkPad T14 Gen 4 · assign it or return it to the pool", action: "Fix record" });
    expect(cols(i, "missing").problem).toBe("Deployed, no holder");
    expect("note" in i.detail).toBe(false);
  });
  it("a current assignee is the last holder before any return", () => {
    const holder = { name: "Bo Sy", group: { name: "HR", kind: "INTERNAL" as const } };
    const i = missingItem({ ...asset(), problem: "missing", updatedAt: day("2026-10-13"), holder, lastReturn }, NOW);
    expect(cols(i, "missing").lastHolder).toEqual(holder);
  });
});

describe("approvalItem", () => {
  const base = {
    id: "ap1", refNo: "APR-2040", type: "lifecycle_assign" as const,
    payload: { to: { assigneeId: "e1", status: "DEPLOYED" }, reason: "New starter kit" },
    priority: "HIGH" as const, slaAt: day("2026-10-20"), createdAt: day("2026-10-18"), updatedAt: day("2026-10-21"),
    workerError: null, requestedBy: "Pia Santos", asset: { tag: "BR-LT-1025", cls: "IT" as const }, employee: { name: "Ana Lim" },
    history: [],
  };
  it("a breach keeps its row and adds what, who, waiting, SLA", () => {
    const i = approvalItem(base, "breached", NOW);
    expect(i).toMatchObject({ key: "queue:ap1", section: "queue", rank: 0, meta: "3 d overdue · high", href: "/approvals/ap1", action: "Open", severity: 3, ageDays: 3 });
    expect(i.title.startsWith("APR-2040 · ")).toBe(true);
    expect(cols(i, "queue")).toEqual({
      section: "queue", what: i.title, who: "Pia Santos", waitingDays: 5, sla: { text: "3 d overdue", overdue: true },
    });
    expect(i.detail.facts).toContainEqual({ label: "SLA", value: "3 d overdue", tone: "fault" });
    expect(factsOf(i)).toMatchObject({
      "Requested by": "Pia Santos", Raised: "18 Oct 2026 · 5 days ago", Priority: "High", Asset: "BR-LT-1025", Employee: "Ana Lim",
    });
    expect(i.detail.note).toEqual({ label: "Request note", text: "New starter kit", by: "Pia Santos" });
  });
  it("an execution failure keeps rank 1, its meta, and shows the error", () => {
    const i = approvalItem({ ...base, workerError: "Asset is not SPARE", payload: { reason: "" } }, "failed", NOW);
    expect(i).toMatchObject({ rank: 1, meta: "execution failed 2 d ago", severity: 2 });
    expect(factsOf(i).Error).toBe("Asset is not SPARE");
    expect("note" in i.detail).toBe(false);
  });
  it("a failed approval whose slaAt has passed is never overdue and never red (fix round 1, I1)", () => {
    const i = approvalItem({ ...base, workerError: "Asset is not SPARE" }, "failed", NOW);
    expect(base.slaAt.getTime()).toBeLessThan(NOW.getTime());
    expect(cols(i, "queue").sla).toEqual({ text: "Execution failed", overdue: false });
    expect(i.detail.facts).toContainEqual({ label: "SLA", value: "Execution failed" });
    expect(i.detail.facts.map((f) => f.value)).not.toContain("3 d overdue");
    expect(i.detail.facts.some((f) => f.tone === "fault")).toBe(false);
    expect(i.overdue).toBeUndefined();
  });
  it("a default request reason is no note", () => {
    expect("note" in approvalItem({ ...base, payload: { reason: "bulk assigned" } }, "breached", NOW).detail).toBe(false);
  });
});

describe("leaverItem", () => {
  const base = {
    id: "e9", name: "Carlo Dizon", employeeNo: "EMP-0007", itemsOut: 2, employment: "OFFBOARDING",
    dueAt: day("2026-10-21"), undecided: 2, failed: null, m365Status: "active", itAccess: 1,
    department: { name: "Sales", kind: "INTERNAL" as const }, started: day("2026-10-14"),
  };
  it("keeps leaverRow's row and adds what, who, waiting, SLA", () => {
    const i = leaverItem(base, NOW);
    expect(i).toMatchObject({ key: "queue:e9", rank: 2, title: "Carlo Dizon is leaving", overdue: true });
    expect(cols(i, "queue")).toEqual({
      section: "queue", what: "Leaving · 2 items still out", who: "Carlo Dizon", waitingDays: 9,
      sla: { text: "2 d overdue", overdue: true },
    });
    expect(i.detail.facts).toContainEqual({ label: "Completion due", value: "21 Oct 2026 · 2 d overdue", tone: "fault" });
    expect(factsOf(i)).toMatchObject({ "Employee no.": "EMP-0007", Department: "Sales", "Items still out": "2", "Next step": i.action });
  });
  it("a client's staffer reads Client, like hires (fix round 1, M1)", () => {
    const i = leaverItem({ ...base, department: { name: "Acme", kind: "CLIENT" } }, NOW);
    expect(i.detail.facts).toContainEqual({ label: "Client", value: "Acme" });
    expect(i.detail.facts.map((f) => f.label)).not.toContain("Department");
  });
  it("no completion date and nothing out", () => {
    const i = leaverItem({ ...base, dueAt: null, itemsOut: 0, started: null }, NOW);
    expect(cols(i, "queue")).toMatchObject({ what: "Leaving · accounts still to close", waitingDays: 0, sla: { text: "no completion date", overdue: false } });
    expect(factsOf(i)).toMatchObject({ "Completion due": "No completion date", "Leaving since": "Not recorded" });
  });
});

describe("sectionStats", () => {
  const group = (items: WorkItem[], capped = false): WorkGroup<WorkItem> => {
    const [g] = groupWork(items, new Set(), {}, capped ? new Set([items[0].section]) : new Set());
    return g;
  };
  const tri = (id: string, returned: string, cost: number | null) =>
    triageItem({ ...asset({ id, cost }), returnedAt: day(returned), lastReturn: null }, NOW);

  it("Triage: Items, Oldest, Over 90 days, Value at cost", () => {
    const g = group([tri("a1", "2026-06-03", 78500), tri("a2", "2026-07-15", 1890), tri("a3", "2026-10-19", null)]);
    expect(sectionStats(g)).toEqual([
      { label: "Items", value: "3" },
      { label: "Oldest", value: "142 d" },
      { label: "Over 90 days", value: "2", tone: "strong" },
      { label: "Value at cost", value: "₱80,390 · 1 without cost" },
    ]);
  });
  it("Oldest comes from the rows passed, so a decided oldest row stops counting at once (final review M5)", () => {
    const g = group([tri("a1", "2026-06-03", 78500), tri("a2", "2026-07-15", 1890), tri("a3", "2026-10-19", null)]);
    const live = g.rows.filter((r) => r.key !== "triage:a1");
    expect(sectionStats({ ...g, rows: live, total: 2 }).slice(0, 2)).toEqual([
      { label: "Items", value: "2" },
      { label: "Oldest", value: "100 d" },
    ]);
  });
  it("Value at cost is plain when every item has a cost (fix round 1, M6)", () => {
    const g = group([tri("a1", "2026-06-03", 78500), tri("a2", "2026-07-15", 1890)]);
    expect(sectionStats(g)[3]).toEqual({ label: "Value at cost", value: "₱80,390" });
  });
  it("a capped section's Items reads {total}+ (1+ here); none over 90 days is plain", () => {
    const g = group([tri("a3", "2026-10-19", null)], true);
    expect(sectionStats(g)).toEqual([
      { label: "Items", value: "1+" },
      { label: "Oldest", value: "4 d" },
      { label: "Over 90 days", value: "0" },
      { label: "Value at cost", value: "₱0 · 1 without cost" },
    ]);
  });
  it("Repairs: Items, Longest down, With a vendor", () => {
    const r = (id: string, since: string, vendor: string | null) => repairItem({
      ...asset({ id }), status: "DEFECTIVE", vendorId: vendor ? "v" : null, vendor, rmaRef: null, repairQuote: null,
      defectiveSince: day(since), repairEndedAt: null,
    }, NOW);
    expect(sectionStats(group([r("a1", "2026-10-01", "iServe"), r("a2", "2026-10-20", null)]))).toEqual([
      { label: "Items", value: "2" },
      { label: "Longest down", value: "22 d" },
      { label: "With a vendor", value: "1" },
    ]);
  });
  it("Loans: Items, Overdue (fault when any), Due this week", () => {
    const l = (id: string, due: string | null) => loanItem({ ...asset({ id }), loanDueAt: due ? day(due) : null, borrower: null }, NOW)!;
    expect(sectionStats(group([l("a1", "2026-10-15"), l("a2", "2026-10-27"), l("a3", "2026-10-23"), l("a4", null)]))).toEqual([
      { label: "Items", value: "4" },
      { label: "Overdue", value: "1", tone: "fault" },
      { label: "Due this week", value: "2" },
    ]);
  });
  it("Approvals: Items, Past SLA = every row that reads red — breaches and overdue leavers, never failures (fix round 1, I1)", () => {
    const appr = (id: string, slaAt: string, kind: "breached" | "failed") => approvalItem({
      id, refNo: `APR-${id}`, type: "lifecycle_assign", payload: {}, priority: "NORMAL", slaAt: day(slaAt),
      createdAt: day("2026-10-18"), updatedAt: day("2026-10-21"), workerError: kind === "failed" ? "x" : null,
      requestedBy: "Pia", asset: null, employee: null, history: [],
    }, kind, NOW);
    const leaver = (id: string, due: string | null) => leaverItem({
      id, name: `L ${id}`, employeeNo: `EMP-${id}`, itemsOut: 1, employment: "OFFBOARDING", dueAt: due ? day(due) : null,
      undecided: 1, failed: null, m365Status: null, itAccess: 0, department: { name: "Sales", kind: "INTERNAL" }, started: day("2026-10-14"),
    }, NOW);
    const rows = [
      appr("1", "2026-10-20", "breached"),
      appr("2", "2026-10-20", "failed"), // past its slaAt, but a failure is not a breach
      leaver("e1", "2026-10-21"), // past the completion date: red
      leaver("e2", "2026-10-28"),
      leaver("e3", null),
    ];
    const g = group(rows);
    const red = g.rows.filter((r) => (r.columns as ColumnsOf<"queue">).sla?.overdue).map((r) => r.key);
    expect(red).toEqual(["queue:1", "queue:e1"]);
    expect(sectionStats(g)).toEqual([
      { label: "Items", value: "5" },
      { label: "Past SLA", value: "2", tone: "fault" },
    ]);
    expect(g.pastSla).toBe(1); // Home's own rank-0 count is unchanged
  });
  it("Approvals: no red rows, Past SLA 0 is plain", () => {
    const f = approvalItem({
      id: "ap2", refNo: "APR-2", type: "lifecycle_assign", payload: {}, priority: "NORMAL", slaAt: day("2026-10-20"),
      createdAt: day("2026-10-18"), updatedAt: day("2026-10-21"), workerError: "x", requestedBy: "Pia", asset: null, employee: null, history: [],
    }, "failed", NOW);
    expect(sectionStats(group([f]))).toEqual([{ label: "Items", value: "1" }, { label: "Past SLA", value: "0" }]);
  });
  it("Others: Items, Oldest", () => {
    const c = checkItem({ ...asset(), createdAt: day("2026-10-16"), registeredBy: null, fromPo: null }, NOW);
    expect(sectionStats(group([c]))).toEqual([{ label: "Items", value: "1" }, { label: "Oldest", value: "7 d" }]);
  });
  it("a section whose rows are all hidden today reads 0 and no oldest", () => {
    const c = checkItem({ ...asset(), createdAt: day("2026-10-16"), registeredBy: null, fromPo: null }, NOW);
    const [g] = groupWork([c], new Set([c.key]), {});
    expect(sectionStats(g)).toEqual([{ label: "Items", value: "0" }, { label: "Oldest", value: "—" }]);
  });
});
