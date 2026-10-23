/**
 * Test fixtures for the Worklist page (H4 Task 3): real WorkItems from the section builders, so the view tests
 * read the same shapes the page gets. Not imported by app code.
 */
import {
  approvalItem, checkItem, groupWork, hireItem, leaverItem, loanItem, missingItem, purchaseReviewItem, repairItem,
  triageItem, type WorkAssetLike, type WorkGroup, type WorkItem,
} from "./worklist";

// Fri 23 Oct 2026, 10:00 in Manila
export const NOW = new Date("2026-10-23T10:00:00+08:00");
export const day = (iso: string) => new Date(`${iso}T10:00:00+08:00`);

export const asset = (over: Partial<WorkAssetLike> = {}): WorkAssetLike => ({
  id: "a1", tag: "BR-LT-1025", model: "ThinkPad T14 Gen 4", serial: "PF4K9Z2A", category: "Laptop",
  purchasedAt: day("2023-08-10"), cost: 78500, warrantyUntil: day("2026-08-10"),
  history: [{ at: day("2026-06-03"), text: "Neil Lucero returned for triage" }],
  ...over,
});

const finance = { name: "Finance", kind: "INTERNAL" as const };
const acme = { name: "Acme", kind: "CLIENT" as const };

/** A triage row: `id`, tag suffix, model, category and days back are what the tests vary. */
export function triage(id: string, days: number, over: Partial<WorkAssetLike> = {}, note: string | null = "Battery drains fast."): WorkItem {
  const returnedAt = new Date(NOW.getTime() - days * 86_400_000);
  return triageItem({
    ...asset({ id, tag: `BR-LT-${id.toUpperCase()}`, ...over }), returnedAt,
    lastReturn: { holder: { name: "Maria Reyes", group: finance }, reason: note, recordedBy: "Neil Lucero", at: returnedAt },
  }, NOW);
}

export const repair = (): WorkItem => repairItem({
  ...asset({ id: "r1", tag: "BR-LT-0201", cost: 10000 }), status: "DEFECTIVE", vendorId: "v1", vendor: "iServe", rmaRef: "RMA-77",
  repairQuote: 6500, defectiveSince: day("2026-10-01"), repairEndedAt: null,
}, NOW);

export const check = (): WorkItem => checkItem({
  ...asset({ id: "c1", tag: "BR-LT-0301" }), createdAt: day("2026-10-16"), registeredBy: "Pia Santos", fromPo: { id: "po1", refNo: "PO-0188" },
}, NOW);

export const purchase = (): WorkItem => purchaseReviewItem({
  id: "pr1", refNo: "PO-0198", submittedAt: day("2026-10-19"), updatedAt: day("2026-10-01"),
  requestedBy: "Pia Santos", department: "HR", firstLine: "27-inch monitors", lines: 2,
  vendor: "PC Express", siNumber: "SI-4471", total: 23800, amountDue: null,
}, NOW);

export const hire = (): WorkItem => hireItem({
  id: "e1", name: "Ana Lim", employeeNo: "EMP-0042", title: "Support agent", joinedAt: day("2026-10-13"),
  group: acme, policyName: "Acme agents", missingSlots: ["Laptop", "Headset"],
}, NOW);

export const loan = (late: boolean): WorkItem => loanItem({
  ...asset({ id: late ? "l1" : "l2", tag: late ? "BR-LT-0401" : "BR-LT-0402" }),
  loanDueAt: late ? day("2026-10-15") : day("2026-10-27"), borrower: { name: "Bo Sy", group: acme },
}, NOW)!;

export const missing = (): WorkItem => missingItem({
  ...asset({ id: "m1", tag: "BR-LT-0501" }), problem: "missing", updatedAt: day("2026-10-13"), holder: null,
  lastReturn: { holder: { name: "Maria Reyes", group: finance }, reason: "Left it in the meeting room.", recordedBy: "Neil Lucero", at: day("2026-10-13") },
}, NOW);

export const approval = (kind: "breached" | "failed"): WorkItem => approvalItem({
  id: kind === "breached" ? "ap1" : "ap2", refNo: kind === "breached" ? "APR-2040" : "APR-2041", type: "lifecycle_assign",
  payload: { to: { assigneeId: "e1", status: "DEPLOYED" }, reason: "New starter kit" },
  priority: "HIGH", slaAt: day("2026-10-20"), createdAt: day("2026-10-18"), updatedAt: day("2026-10-21"),
  workerError: kind === "failed" ? "Asset is not SPARE" : null, requestedBy: "Pia Santos",
  asset: { tag: "BR-LT-1025", cls: "IT" }, employee: { name: "Ana Lim" }, history: [],
}, kind, NOW);

export const leaver = (): WorkItem => leaverItem({
  id: "e9", name: "Carlo Dizon", employeeNo: "EMP-0007", itemsOut: 2, employment: "OFFBOARDING",
  dueAt: day("2026-10-21"), undecided: 2, failed: null, m365Status: "active", itAccess: 1,
  department: { name: "Sales", kind: "INTERNAL" }, started: day("2026-10-14"),
}, NOW);

/** Every queue with one or two rows; `capped` marks sections whose read hit its cap. */
export function groupsOf(rows: WorkItem[], capped: string[] = [], hidden: string[] = []): WorkGroup<WorkItem>[] {
  return groupWork(rows, new Set(hidden), {}, new Set(capped as never[]));
}

export const allRows = (): WorkItem[] => [
  triage("t1", 142), triage("t2", 30, { model: "Dell P2422H", category: "Monitor", cost: null }),
  repair(), check(), purchase(), hire(), loan(true), loan(false), missing(), approval("breached"), approval("failed"), leaver(),
];
