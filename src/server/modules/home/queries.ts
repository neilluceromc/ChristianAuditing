import { Prisma, type AssetClass, type Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtMoney, localDateISO } from "@/lib/format";
import { INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { parseListState, serializeListState, withFilter } from "@/lib/url-state";
import { slaLabel } from "@/lib/approvals-list";
import { summarizeApproval } from "@/lib/approval-execution";
import { approvalClassWhere } from "@/lib/approval-access";
import { computeLoadout, effectiveSlots, groupExceptionsByEmployee, resolvePolicy } from "@/lib/loadout";
import { beyondRepair, downDays, repairStage, REPAIR_STAGE_LABEL } from "@/lib/repairs";
import {
  DISMISS_PREF_KEY, activeDismissals, coverageLine, todayStamp,
} from "@/lib/home";
import {
  loanRow, loanSoonEdge, leaverRow, groupWork, purchaseReviewRow, type WorkGroup, type WorkRow, type WorkSectionId,
} from "@/lib/worklist";
import { orderByOffboardingAttention } from "@/lib/offboarding";
import { leaverStates } from "@/server/modules/offboarding/queries";

const DAY_MS = 86_400_000;
const daysSince = (d: Date, now: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / DAY_MS));

/** ACTIVE employees who started recently are the ones whose kit is still landing. */
const HIRE_WINDOW_DAYS = 30;

/** Phase 17: per-source read caps, named once so `take` and the saturation check can't drift apart. */
const CAP = { small: 10, large: 50 };

/** Phase 40 §6 (spec ruling 5): IT reviews SUBMITTED requests only; an IT_REVIEWED one has left IT's hands. */
const PURCHASE_REVIEW_WHERE = { state: "SUBMITTED" } as const satisfies Prisma.PurchaseRequestWhereInput;

/**
 * The worklist (Phase 15, spec §5): grouped sections in a fixed order, each
 * row with the one action that clears it. Every row is a real record —
 * nothing here is a count for its own sake.
 */
export async function worklist(
  userId: string,
  role: Role,
  opts: { limit?: number; excludeOwnClaims?: boolean },
  now: Date = new Date(),
): Promise<WorkGroup[]> {
  const scope = approvalClassWhere(role);
  // Phase 21 spec §4.2: one approval appears once on Home — a claim you hold
  // already shows (with its SLA and overdue mark) in "Claimed by you", so
  // Home's worklist excludes it here rather than listing it twice.
  // A PENDING row has claimedById = null, and SQL's `<>` never matches NULL —
  // so `NOT: { claimedById }` would drop every unclaimed breach along with the
  // viewer's own claims (home-finance case "APR-2040 leads" caught it). Spell
  // the null case out.
  const breachedWhere: Prisma.ApprovalWhereInput = opts.excludeOwnClaims
    ? {
        AND: [
          { state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: now } },
          { OR: [{ claimedById: null }, { claimedById: { not: userId } }] },
          scope,
        ],
      }
    : { AND: [{ state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: now } }, scope] };
  const [breached, failed, leavers, hireWork, missing, orphaned, awaiting, pref, triage, repairs, loans, reviews] = await Promise.all([
    prisma.approval.findMany({
      where: breachedWhere,
      orderBy: [{ slaAt: "asc" }, { id: "asc" }],
      take: CAP.small,
      include: { asset: true, employee: true },
    }),
    prisma.approval.findMany({
      where: { AND: [{ state: "EXECUTION_FAILED" as const }, scope] },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: CAP.small,
      include: { asset: true, employee: true },
    }),
    // Phase 32 (spec §3): every leaver's real snapshot, worst first.
    leaverStates(),
    hireWorkRows(now),
    prisma.asset.findMany({
      where: { status: "MISSING", cls: "IT" },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: CAP.small,
      select: { id: true, tag: true, model: true, updatedAt: true },
    }),
    // custody that doesn't add up: DEPLOYED with nobody holding it
    prisma.asset.findMany({
      where: { status: "DEPLOYED", assigneeId: null, cls: "IT" },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: CAP.small,
      select: { id: true, tag: true, model: true, updatedAt: true },
    }),
    // Phase 14 (spec §5.5): IT assets Purchasing registered, waiting for IT.
    prisma.asset.findMany({
      where: { cls: "IT", itVerifiedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: CAP.small,
      select: { id: true, tag: true, model: true, createdAt: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
      select: { value: true },
    }),
    // Phase 15 (spec §5): back from a person, sitting on SPARE unchecked.
    prisma.asset.findMany({
      where: { cls: "IT", returnedAt: { not: null } },
      orderBy: [{ returnedAt: "asc" }, { id: "asc" }],
      take: CAP.large,
      select: { id: true, tag: true, model: true, returnedAt: true },
    }),
    // Repairs to chase — the same fields the Repairs saved view derives its
    // stage and down-clock from (src/lib/repairs.ts).
    prisma.asset.findMany({
      where: { cls: "IT", status: "DEFECTIVE" },
      orderBy: [{ defectiveSince: "asc" }, { id: "asc" }],
      take: CAP.large,
      select: {
        id: true, tag: true, model: true, status: true, vendorId: true, rmaRef: true,
        repairQuote: true, cost: true, defectiveSince: true, repairEndedAt: true, vendor: { select: { name: true } },
      },
    }),
    // Loans: ordered by due date (nulls first), limited to CAP.large
    prisma.asset.findMany({
      where: { cls: "IT", status: "TEMPORARY" },
      orderBy: [{ loanDueAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: CAP.large,
      select: { id: true, tag: true, model: true, loanDueAt: true, assignee: { select: { name: true } } },
    }),
    // Phase 40 §6: purchase requests waiting for IT's review, newest first.
    prisma.purchaseRequest.findMany({
      where: PURCHASE_REVIEW_WHERE,
      orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "desc" }],
      take: CAP.large,
      select: {
        id: true, refNo: true, submittedAt: true, updatedAt: true,
        requestedBy: { select: { name: true } },
        department: { select: { name: true } },
        units: { select: { description: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1 },
        _count: { select: { units: true } },
      },
    }),
  ]);

  const rows: WorkRow[] = [];

  for (const a of breached) {
    const s = summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name, cls: a.asset?.cls });
    rows.push({
      key: `queue:${a.id}`,
      section: "queue",
      title: `${a.refNo} · ${s.line1}`,
      meta: `${slaLabel(a.slaAt, now).text} · ${a.priority.toLowerCase()}`,
      href: `/approvals/${a.id}`,
      action: "Open",
      severity: daysSince(a.slaAt, now),
      rank: 0,
      ageDays: daysSince(a.slaAt, now),
    });
  }

  for (const a of failed) {
    const s = summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name, cls: a.asset?.cls });
    rows.push({
      key: `queue:${a.id}`,
      section: "queue",
      title: `${a.refNo} · ${s.line1}`,
      meta: `execution failed ${daysSince(a.updatedAt, now)} d ago`,
      href: `/approvals/${a.id}`,
      action: "Open",
      severity: daysSince(a.updatedAt, now),
      rank: 1,
      ageDays: daysSince(a.updatedAt, now),
    });
  }

  const todayISO = localDateISO(now);
  // Spec §3: each leaver's label and href come from offboardingNext over the
  // real snapshot (failed returns, M365 status), worst first.
  for (const e of orderByOffboardingAttention(leavers, "desc").slice(0, CAP.small)) {
    rows.push(leaverRow({
      id: e.id, name: e.name, employeeNo: e.employeeNo, itemsOut: e.itemsOut,
      employment: e.employment, dueAt: e.dueAt, undecided: e.undecided, failed: e.failed, m365Status: e.m365, itAccess: e.itAccess,
    }, todayISO));
  }

  rows.push(...hireWork.rows);

  for (const a of missing) {
    rows.push({
      key: `missing:${a.id}`,
      section: "missing",
      title: `${a.tag} is missing`,
      meta: `${a.model} · custody lost ${daysSince(a.updatedAt, now)} d ago`,
      href: `/inventory/${a.id}`,
      action: "Investigate",
      severity: daysSince(a.updatedAt, now),
      ageDays: daysSince(a.updatedAt, now),
      entity: { kind: "asset", id: a.id, label: a.tag },
    });
  }

  for (const a of orphaned) {
    rows.push({
      key: `missing:${a.id}`,
      section: "missing",
      title: `${a.tag} reads Deployed with no holder`,
      meta: `${a.model} · assign it or return it to the pool`,
      href: `/inventory/${a.id}`,
      action: "Fix record",
      severity: daysSince(a.updatedAt, now),
      ageDays: daysSince(a.updatedAt, now),
      // Ruling R6: no in-place control — assignAsset refuses anything but SPARE,
      // so the fix lives on the record (Change status…).
      entity: { kind: "asset", id: a.id, label: a.tag },
    });
  }

  for (const a of awaiting) {
    rows.push({
      key: `check:${a.id}`,
      section: "check",
      title: `${a.tag} · ${a.model}`,
      meta: `registered by Purchasing · ${daysSince(a.createdAt, now)} d waiting`,
      href: `/inventory/${a.id}`,
      action: "Check",
      severity: daysSince(a.createdAt, now),
      ageDays: daysSince(a.createdAt, now),
      control: { kind: "it-check", asset: { id: a.id, tag: a.tag } },
      entity: { kind: "asset", id: a.id, label: a.tag },
    });
  }

  for (const a of triage) {
    const n = daysSince(a.returnedAt!, now);
    rows.push({
      key: `triage:${a.id}`,
      section: "triage",
      title: `${a.tag} · ${a.model}`,
      meta: `back ${n} d · triage it`,
      href: `/inventory/${a.id}`,
      action: "Triage",
      severity: n,
      ageDays: n,
      control: { kind: "triage", asset: { id: a.id, tag: a.tag, model: a.model } },
      entity: { kind: "asset", id: a.id, label: a.tag },
    });
  }

  for (const a of repairs) {
    const quote = a.repairQuote === null ? null : Number(a.repairQuote);
    const cost = a.cost === null ? null : Number(a.cost);
    const stage = repairStage({
      status: a.status, vendorId: a.vendorId, rmaRef: a.rmaRef,
      repairQuote: quote, cost, defectiveSince: a.defectiveSince, repairEndedAt: a.repairEndedAt,
    }) ?? "to-assess";
    const down = downDays({ status: a.status, defectiveSince: a.defectiveSince, repairEndedAt: a.repairEndedAt }, now) ?? 0;
    const beyond = beyondRepair(quote, cost);
    rows.push({
      key: `repairs:${a.id}`,
      section: "repairs",
      title: `${a.tag} · ${a.model}`,
      meta: `${REPAIR_STAGE_LABEL[stage]} · ${a.vendor?.name ?? "no vendor"}${a.rmaRef ? ` · ${a.rmaRef}` : ""} · down ${down} d${beyond ? " · beyond repair" : ""}`,
      href: `/inventory/${a.id}`,
      action: "Chase",
      severity: down,
      ageDays: down,
      entity: { kind: "asset", id: a.id, label: a.tag },
    });
  }

  for (const a of loans) {
    const r = loanRow({ id: a.id, tag: a.tag, model: a.model, loanDueAt: a.loanDueAt, holder: a.assignee?.name ?? null }, now);
    if (r) rows.push(r);
  }

  for (const r of reviews) {
    rows.push(purchaseReviewRow({
      id: r.id, refNo: r.refNo, submittedAt: r.submittedAt, updatedAt: r.updatedAt,
      requestedBy: r.requestedBy.name, department: r.department?.name ?? null,
      firstLine: r.units[0]?.description ?? null, lines: r._count.units,
    }, now));
  }

  const saturated = new Set<WorkSectionId>();
  if (triage.length === CAP.large) saturated.add("triage");
  if (repairs.length === CAP.large) saturated.add("repairs");
  if (loans.length === CAP.large) saturated.add("loans");
  if (reviews.length === CAP.large) saturated.add("purchases");
  if (missing.length === CAP.small || orphaned.length === CAP.small) saturated.add("missing");
  if (awaiting.length === CAP.small) saturated.add("check");
  if (hireWork.saturated) saturated.add("hires");
  if (breached.length === CAP.small || failed.length === CAP.small || leavers.length > CAP.small) saturated.add("queue");

  return groupWork(rows, activeDismissals(pref?.value, todayStamp(now)), opts, saturated);
}

/**
 * The worklist's New hires rows (spec §5.1), shared with the Worklist badge:
 * ACTIVE employees who started within HIRE_WINDOW_DAYS with a required slot
 * still empty. `saturated` = the read hit its cap, so more may exist.
 */
export async function hireWorkRows(now: Date): Promise<{ rows: WorkRow[]; saturated: boolean }> {
  const hires = await prisma.employee.findMany({
    where: { employment: "ACTIVE", joinedAt: { gte: new Date(now.getTime() - HIRE_WINDOW_DAYS * DAY_MS) } },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    take: CAP.small,
    select: {
      id: true, name: true, employeeNo: true, title: true, departmentId: true, joinedAt: true,
      assets: { where: { cls: "IT" }, select: { id: true, tag: true, model: true, typeId: true, status: true } },
    },
  });
  if (hires.length === 0) return { rows: [], saturated: false };

  const [policies, hireExceptions] = await Promise.all([
    prisma.equipmentPolicy.findMany({
      select: {
        id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
        slots: { select: { id: true, name: true, assetTypeId: true, required: true, loaner: true }, orderBy: { id: "asc" } },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.employeeSlotException.findMany({
      where: { employeeId: { in: hires.map((e) => e.id) } },
      orderBy: [{ employeeId: "asc" }, { id: "asc" }],
    }),
  ]);
  const hireExceptionsByEmployee = groupExceptionsByEmployee(hireExceptions);

  const rows: WorkRow[] = [];
  for (const e of hires) {
    const policy = resolvePolicy({ title: e.title, departmentId: e.departmentId }, policies);
    const exceptions = hireExceptionsByEmployee.get(e.id) ?? [];
    if (!policy && !exceptions.some((x) => x.kind === "ADD")) continue;
    const loadout = computeLoadout(effectiveSlots(policy?.slots ?? [], exceptions), e.assets);
    if (loadout.missingRequired === 0) continue;
    rows.push({
      key: `hires:${e.id}`,
      section: "hires",
      title: `${e.name} started ${daysSince(e.joinedAt, now)} d ago`,
      meta: `${e.employeeNo} · ${loadout.missingRequired} required slot${loadout.missingRequired === 1 ? "" : "s"} empty · ${policy?.name ?? "personal loadout"}`,
      href: `/employees/${e.id}#loadout`,
      action: "Fill loadout",
      severity: daysSince(e.joinedAt, now),
      ageDays: daysSince(e.joinedAt, now),
      entity: { kind: "employee", id: e.id, label: e.name },
    });
  }
  return { rows, saturated: hires.length === CAP.small };
}

/**
 * The Worklist nav badge (spec §5.3, plan P-9): every row the worklist shows,
 * minus today's hidden ones, uncapped. It runs in the app layout on every
 * navigation, so each section is one indexed count (leavers included — not
 * leaverStates(), which reads every leaver in full); new hires reuse the
 * worklist's own capped helper. Each where mirrors worklist()'s read.
 */
export async function worklistCount(userId: string, role: Role, now: Date = new Date()): Promise<number> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
    select: { value: true },
  });
  const hidden = activeDismissals(pref?.value, todayStamp(now));
  const hiddenIds = (section: WorkSectionId) =>
    [...hidden].filter((k) => k.startsWith(`${section}:`)).map((k) => k.slice(section.length + 1));
  const scope = approvalClassWhere(role);
  // loanRow's edge, on the Manila calendar (see loanSoonEdge).
  const soonEdge = loanSoonEdge(now);
  const [triage, repairs, check, loans, missing, orphaned, breached, failed, leavers, hires, reviews] = await Promise.all([
    prisma.asset.count({ where: { cls: "IT", returnedAt: { not: null }, id: { notIn: hiddenIds("triage") } } }),
    prisma.asset.count({ where: { cls: "IT", status: "DEFECTIVE", id: { notIn: hiddenIds("repairs") } } }),
    prisma.asset.count({ where: { cls: "IT", itVerifiedAt: null, id: { notIn: hiddenIds("check") } } }),
    prisma.asset.count({
      where: { cls: "IT", status: "TEMPORARY", id: { notIn: hiddenIds("loans") }, OR: [{ loanDueAt: null }, { loanDueAt: { lt: soonEdge } }] },
    }),
    prisma.asset.count({ where: { cls: "IT", status: "MISSING", id: { notIn: hiddenIds("missing") } } }),
    prisma.asset.count({ where: { cls: "IT", status: "DEPLOYED", assigneeId: null, id: { notIn: hiddenIds("missing") } } }),
    prisma.approval.count({ where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: now }, id: { notIn: hiddenIds("queue") } }, scope] } }),
    prisma.approval.count({ where: { AND: [{ state: "EXECUTION_FAILED" }, { id: { notIn: hiddenIds("queue") } }, scope] } }),
    prisma.employee.count({ where: { employment: "OFFBOARDING", id: { notIn: hiddenIds("queue") } } }),
    hireWorkRows(now),
    prisma.purchaseRequest.count({ where: { ...PURCHASE_REVIEW_WHERE, id: { notIn: hiddenIds("purchases") } } }),
  ]);
  const hireCount = hires.rows.filter((r) => !hidden.has(r.key)).length;
  return triage + repairs + check + loans + missing + orphaned + breached + failed + leavers + hireCount + reviews;
}

/**
 * The IT nav's "Purchase reviews" badge (spec §6): every request waiting for
 * IT's review — the count of the list the item opens, so it matches its
 * "Awaiting IT" tab; a row hidden on the worklist is still waiting.
 */
export async function purchaseReviewCount(): Promise<number> {
  return prisma.purchaseRequest.count({ where: PURCHASE_REVIEW_WHERE });
}

export interface ClaimRow {
  id: string;
  refNo: string;
  line1: string;
  sla: { text: string; overdue: boolean };
}

/** README: claims sit ABOVE the pool — a forgotten claim is worse than an unclaimed item. */
export async function claimedByYou(userId: string, role: Role, now: Date = new Date()): Promise<ClaimRow[]> {
  const rows = await prisma.approval.findMany({
    where: { AND: [{ state: "CLAIMED" as const, claimedById: userId }, approvalClassWhere(role)] },
    orderBy: [{ slaAt: "asc" }, { id: "asc" }],
    take: 5,
    include: { asset: true, employee: true },
  });
  return rows.map((a) => ({
    id: a.id,
    refNo: a.refNo,
    line1: summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name, cls: a.asset?.cls }).line1,
    sla: slaLabel(a.slaAt, now),
  }));
}

/** Phase 46: every direct change resolved since `since` — when, and the class of the asset it changed. */
export async function directChangeRows(since: Date): Promise<Array<{ at: Date; cls: AssetClass | null }>> {
  const rows = await prisma.approval.findMany({
    where: { appliedDirectly: true, resolvedAt: { gte: since } },
    select: { resolvedAt: true, asset: { select: { cls: true } } },
  });
  return rows.map((r) => ({ at: r.resolvedAt!, cls: r.asset?.cls ?? null }));
}

export interface FleetSlice {
  status: string;
  count: number;
  share: number;
  /** Phase 25: the inventory filtered to this status — the same URL the status facet produces. */
  href: string;
}

export interface Fleet {
  total: number;
  slices: FleetSlice[];
  coverage: string;
}

/**
 * One stacked bar over every status, a legend with counts and shares, and then
 * the line that actually decides something: does the spare pool cover the
 * people starting next week?
 */
export async function fleet(now: Date = new Date()): Promise<Fleet> {
  const [groups, spares, hires] = await Promise.all([
    prisma.asset.groupBy({ by: ["status"], where: { cls: "IT" }, _count: { _all: true } }),
    // a spare under an ACTIVE hold is already promised to someone; a spare
    // back from a person and not yet triaged isn't a spare yet either
    // (spec §4.2) — an untriaged device is not stock IT can hand out.
    prisma.asset.findMany({
      where: { status: "SPARE", reservations: { none: { state: "ACTIVE" } }, returnedAt: null, cls: "IT" },
      select: { typeId: true },
    }),
    prisma.employee.findMany({
      where: { employment: "ACTIVE", joinedAt: { gte: new Date(now.getTime() - HIRE_WINDOW_DAYS * DAY_MS) } },
      select: {
        id: true, title: true, departmentId: true,
        assets: { where: { cls: "IT" }, select: { id: true, tag: true, model: true, typeId: true, status: true } },
      },
    }),
  ]);

  const total = groups.reduce((sum, g) => sum + g._count._all, 0);
  const slices = groups
    .map((g): FleetSlice => ({
      status: g.status,
      count: g._count._all,
      share: total === 0 ? 0 : Math.round((g._count._all / total) * 100),
      href: "/inventory" + serializeListState(
        withFilter(parseListState(new URLSearchParams(), INVENTORY_LIST_CONFIG), "status", [g.status]),
        INVENTORY_LIST_CONFIG,
      ),
    }))
    .sort((a, b) => b.count - a.count);

  const spareByType: Record<string, number> = {};
  for (const s of spares) {
    const key = s.typeId ?? "untyped";
    spareByType[key] = (spareByType[key] ?? 0) + 1;
  }

  const neededByType: Record<string, number> = {};
  if (hires.length) {
    const [policies, exceptions] = await Promise.all([
      prisma.equipmentPolicy.findMany({
        select: {
          id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
          slots: { select: { id: true, name: true, assetTypeId: true, required: true, loaner: true }, orderBy: { id: "asc" } },
        },
        orderBy: [{ name: "asc" }],
      }),
      prisma.employeeSlotException.findMany({
        where: { employeeId: { in: hires.map((e) => e.id) } },
        orderBy: [{ employeeId: "asc" }, { id: "asc" }],
      }),
    ]);
    const exceptionsByEmployee = groupExceptionsByEmployee(exceptions);
    for (const e of hires) {
      const policy = resolvePolicy({ title: e.title, departmentId: e.departmentId }, policies);
      const employeeExceptions = exceptionsByEmployee.get(e.id) ?? [];
      if (!policy && !employeeExceptions.some((x) => x.kind === "ADD")) continue;
      const { slots } = computeLoadout(effectiveSlots(policy?.slots ?? [], employeeExceptions), e.assets);
      for (const { slot, asset } of slots) {
        if (asset || !slot.required) continue;
        const key = slot.assetTypeId ?? "untyped";
        neededByType[key] = (neededByType[key] ?? 0) + 1;
      }
    }
  }

  return { total, slices, coverage: coverageLine(spareByType, neededByType).text };
}

export interface TodoRow {
  id: string;
  refNo: string;
  what: string;
  meta: string;
  href: string;
  action: string;
  /** Purchasing: the request came back to its author (IT rejected it, or Finance asked for more) */
  bounced?: boolean;
}

/** A request's value in pesos: qty × unit price over its units (a unit with no price counts 0). */
export const unitsValue = (units: Array<{ qty: number; unitPrice: unknown }>) =>
  units.reduce((sum, u) => sum + u.qty * (u.unitPrice === null || u.unitPrice === undefined ? 0 : Number(u.unitPrice)), 0);

export interface SpendRow {
  /** completedAt */
  at: Date;
  /** pesos: qty x unit price over the request's units */
  amount: number;
  supplier: string | null;
  department: string | null;
}

/**
 * Completed requests since `since`, each with its value — the one read behind "Spend this month" (Purchasing),
 * "Approved this month" (Finance) and both spend breakdowns, so they can never disagree.
 */
export async function completedSpend(since: Date): Promise<SpendRow[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { state: "COMPLETED", completedAt: { gte: since } },
    select: {
      completedAt: true,
      units: { select: { qty: true, unitPrice: true } },
      vendor: { select: { name: true } },
      department: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    at: r.completedAt!, amount: unitsValue(r.units), supplier: r.vendor?.name ?? null, department: r.department?.name ?? null,
  }));
}

/** Phase 46: the breakdowns' "top 7 + Other". */
export const SPEND_TOP = 7;

/**
 * Purchasing's to-do (Home and the Overview's Needs you): the viewer's drafts and submitted requests, oldest touched
 * first, each with the one action that moves it — and whether it came back to them.
 */
export async function purchasingTodo(userId: string, now: Date = new Date()): Promise<TodoRow[]> {
  const mine = await prisma.purchaseRequest.findMany({
    where: { requestedById: userId, state: { in: ["DRAFT", "SUBMITTED"] } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 8,
    select: {
      id: true, refNo: true, state: true, updatedAt: true,
      units: { select: { qty: true, unitPrice: true } },
      notes: {
        where: { kind: { not: "COMMENT" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { kind: true, author: { select: { name: true } } },
      },
    },
  });
  return mine.map((r) => {
    const last = r.notes[0];
    const bounced = (r.state === "DRAFT" && last?.kind === "IT_REJECT") || (r.state === "SUBMITTED" && last?.kind === "REQUEST_INFO");
    return {
      id: r.id,
      refNo: r.refNo,
      what: bounced ? `came back from ${last?.author.name ?? "review"}` : r.state === "DRAFT" ? "still a draft" : "waiting on IT",
      meta: `${fmtMoney(unitsValue(r.units))} · ${daysSince(r.updatedAt, now)} d`,
      href: `/purchases/${r.id}`,
      action: bounced ? "Fix and resubmit" : r.state === "DRAFT" ? "Submit" : "Open",
      bounced,
    };
  });
}

/**
 * The requests waiting on Finance (IT_REVIEWED), oldest review first: Finance Home's headline and queue, and the
 * snapshot's `fin.waitingC` / `fin.waitingCount` (Phase 46), so the two can never disagree.
 */
export function financeWaitingRows() {
  return prisma.purchaseRequest.findMany({
    where: { state: "IT_REVIEWED" },
    orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
    select: {
      id: true, refNo: true, reviewedAt: true, updatedAt: true,
      requestedBy: { select: { name: true } },
      units: { select: { qty: true, unitPrice: true } },
    },
  });
}

export type FinanceWaitingRow = Awaited<ReturnType<typeof financeWaitingRows>>[number];

/** Days a waiting request has sat with Finance: since IT's review (or its last update, for a pre-review row). */
export function waitingDays(r: Pick<FinanceWaitingRow, "reviewedAt" | "updatedAt">, now: Date): number {
  return daysSince(r.reviewedAt ?? r.updatedAt, now);
}

/** Finance's queue (Home and the Overview's Needs you): the first `take` waiting requests, each opened to review. */
export function financeQueue(rows: FinanceWaitingRow[], now: Date, take = 8): TodoRow[] {
  return rows.slice(0, take).map((r) => ({
    id: r.id,
    refNo: r.refNo,
    what: `from ${r.requestedBy.name}`,
    meta: `${fmtMoney(unitsValue(r.units))} · waiting ${waitingDays(r, now)} d`,
    href: `/purchases/${r.id}`,
    action: "Review",
  }));
}
