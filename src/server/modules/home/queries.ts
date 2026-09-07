import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { fmtDate, fmtMoney } from "@/lib/format";
import { slaLabel } from "@/lib/approvals-list";
import { summarizeApproval } from "@/lib/approval-execution";
import { approvalClassWhere } from "@/lib/approval-access";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import { beyondRepair, downDays, repairStage, REPAIR_STAGE_LABEL } from "@/lib/repairs";
import {
  AGE_BUCKETS, DISMISS_PREF_KEY, activeDismissals, ageBucket, coverageLine,
  todayStamp, warrantyClusters, warrantyDaysLeft, type AgeBucket,
} from "@/lib/home";
import { LOAN_DAYS, groupWork, type WorkGroup, type WorkRow } from "@/lib/worklist";

const DAY_MS = 86_400_000;
const daysSince = (d: Date, now: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / DAY_MS));

/** ACTIVE employees who started recently are the ones whose kit is still landing. */
const HIRE_WINDOW_DAYS = 30;
const WARRANTY_WINDOW_DAYS = 90;

/**
 * The worklist (Phase 15, spec §5): grouped sections in a fixed order, each
 * row with the one action that clears it. Every row is a real record —
 * nothing here is a count for its own sake.
 */
export async function worklist(userId: string, role: Role, opts: { limit?: number }, now: Date = new Date()): Promise<WorkGroup[]> {
  const scope = approvalClassWhere(role);
  const [breached, failed, leavers, hires, missing, orphaned, awaiting, pref, triage, repairs, loans] = await Promise.all([
    prisma.approval.findMany({
      where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: now } }, scope] },
      orderBy: { slaAt: "asc" },
      take: 10,
      include: { asset: true, employee: true },
    }),
    prisma.approval.findMany({
      where: { AND: [{ state: "EXECUTION_FAILED" as const }, scope] },
      orderBy: { updatedAt: "asc" },
      take: 10,
      include: { asset: true, employee: true },
    }),
    prisma.employee.findMany({
      where: { employment: "OFFBOARDING" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, name: true, employeeNo: true, updatedAt: true, _count: { select: { assets: { where: { cls: "IT" } } } } },
    }),
    prisma.employee.findMany({
      where: { employment: "ACTIVE", joinedAt: { gte: new Date(now.getTime() - HIRE_WINDOW_DAYS * DAY_MS) } },
      orderBy: { joinedAt: "asc" },
      take: 10,
      select: {
        id: true, name: true, employeeNo: true, title: true, departmentId: true, joinedAt: true,
        assets: { where: { cls: "IT" }, select: { id: true, tag: true, model: true, typeId: true, status: true } },
      },
    }),
    prisma.asset.findMany({
      where: { status: "MISSING", cls: "IT" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, tag: true, model: true, updatedAt: true },
    }),
    // custody that doesn't add up: DEPLOYED with nobody holding it
    prisma.asset.findMany({
      where: { status: "DEPLOYED", assigneeId: null, cls: "IT" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, tag: true, model: true, updatedAt: true },
    }),
    // Phase 14 (spec §5.5): IT assets Purchasing registered, waiting for IT.
    prisma.asset.findMany({
      where: { cls: "IT", itVerifiedAt: null },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true, tag: true, model: true, createdAt: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
      select: { value: true },
    }),
    // Phase 15 (spec §5): back from a person, sitting on SPARE unchecked.
    prisma.asset.findMany({
      where: { cls: "IT", returnedAt: { not: null } },
      orderBy: { returnedAt: "asc" },
      take: 50,
      select: { id: true, tag: true, model: true, returnedAt: true },
    }),
    // Repairs to chase — the same fields the Repairs saved view derives its
    // stage and down-clock from (src/lib/repairs.ts).
    prisma.asset.findMany({
      where: { cls: "IT", status: "DEFECTIVE" },
      orderBy: { defectiveSince: "asc" },
      take: 50,
      select: {
        id: true, tag: true, model: true, status: true, vendorId: true, rmaRef: true,
        repairQuote: true, cost: true, defectiveSince: true, vendor: { select: { name: true } },
      },
    }),
    // Loans: ALL of them, not just the overdue ones — LOAN_DAYS only decides
    // whether the row reads "overdue", not whether it's on the list.
    prisma.asset.findMany({
      where: { cls: "IT", status: "TEMPORARY" },
      select: { id: true, tag: true, model: true, updatedAt: true, assignee: { select: { name: true } } },
    }),
  ]);

  // When a loan most recently became TEMPORARY — falls back to updatedAt
  // when no such audit row exists (e.g. seeded directly).
  const loanAudits = loans.length
    ? await prisma.auditEntry.findMany({
        where: {
          entityType: "asset",
          entityId: { in: loans.map((a) => a.id) },
          diff: { path: ["status", "to"], equals: "TEMPORARY" },
        },
        orderBy: { createdAt: "desc" },
        select: { entityId: true, createdAt: true },
      })
    : [];
  const loanSince = new Map<string, Date>();
  for (const entry of loanAudits) {
    if (!loanSince.has(entry.entityId)) loanSince.set(entry.entityId, entry.createdAt);
  }

  const policies = hires.length
    ? await prisma.equipmentPolicy.findMany({
        select: {
          id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
          slots: { select: { id: true, name: true, assetTypeId: true, required: true, loaner: true } },
        },
        orderBy: [{ name: "asc" }],
      })
    : [];

  const rows: WorkRow[] = [];

  for (const a of breached) {
    const s = summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name, cls: a.asset?.cls });
    rows.push({
      key: `queue:${a.id}`,
      section: "queue",
      title: `${a.refNo} · ${s.line1}`,
      meta: `${slaLabel(a.slaAt, now).text} · ${a.priority.toLowerCase()}`,
      href: `/approvals/${a.id}`,
      action: a.state === "PENDING" ? "Claim" : "Open",
      severity: daysSince(a.slaAt, now),
      rank: 0,
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
      action: "Retry",
      severity: daysSince(a.updatedAt, now),
      rank: 1,
    });
  }

  for (const e of leavers) {
    rows.push({
      key: `queue:${e.id}`,
      section: "queue",
      title: `${e.name} is leaving`,
      // "0 items still out" is true but useless as a call to action — when the
      // kit is already back, what's left is the accounts half of offboarding
      meta: e._count.assets > 0
        ? `${e.employeeNo} · ${e._count.assets} item${e._count.assets === 1 ? "" : "s"} still out`
        : `${e.employeeNo} · equipment returned · accounts still to close`,
      // Phase 7: both halves of offboarding (kit and accounts) live in the
      // wizard now, so the one action that clears this row opens it.
      href: `/offboarding/${e.id}`,
      action: e._count.assets > 0 ? "Collect equipment" : "Close accounts",
      severity: daysSince(e.updatedAt, now),
      rank: 2,
    });
  }

  for (const e of hires) {
    const policy = resolvePolicy({ title: e.title, departmentId: e.departmentId }, policies);
    if (!policy) continue;
    const loadout = computeLoadout(policy.slots, e.assets);
    if (loadout.missingRequired === 0) continue;
    rows.push({
      key: `hires:${e.id}`,
      section: "hires",
      title: `${e.name} started ${daysSince(e.joinedAt, now)} d ago`,
      meta: `${e.employeeNo} · ${loadout.missingRequired} required slot${loadout.missingRequired === 1 ? "" : "s"} empty · ${policy.name}`,
      href: `/employees/${e.id}`,
      action: "Fill loadout",
      severity: daysSince(e.joinedAt, now),
    });
  }

  for (const a of missing) {
    rows.push({
      key: `missing:${a.id}`,
      section: "missing",
      title: `${a.tag} is MISSING`,
      meta: `${a.model} · custody lost ${daysSince(a.updatedAt, now)} d ago`,
      href: `/inventory/${a.id}`,
      action: "Investigate",
      severity: daysSince(a.updatedAt, now),
    });
  }

  for (const a of orphaned) {
    rows.push({
      key: `missing:${a.id}`,
      section: "missing",
      title: `${a.tag} reads DEPLOYED with no holder`,
      meta: `${a.model} · assign it or return it to the pool`,
      href: `/inventory/${a.id}`,
      action: "Fix record",
      severity: daysSince(a.updatedAt, now),
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
    });
  }

  for (const a of repairs) {
    const quote = a.repairQuote === null ? null : Number(a.repairQuote);
    const cost = a.cost === null ? null : Number(a.cost);
    const stage = repairStage({
      status: a.status, vendorId: a.vendorId, rmaRef: a.rmaRef,
      repairQuote: quote, cost, defectiveSince: a.defectiveSince,
    }) ?? "to-assess";
    const down = downDays({ status: a.status, defectiveSince: a.defectiveSince }, now) ?? 0;
    const beyond = beyondRepair(quote, cost);
    rows.push({
      key: `repairs:${a.id}`,
      section: "repairs",
      title: `${a.tag} · ${a.model}`,
      meta: `${REPAIR_STAGE_LABEL[stage]} · ${a.vendor?.name ?? "no vendor"}${a.rmaRef ? ` · ${a.rmaRef}` : ""} · down ${down} d${beyond ? " · beyond repair" : ""}`,
      href: `/inventory/${a.id}`,
      action: "Chase",
      severity: down,
    });
  }

  for (const a of loans) {
    const n = daysSince(loanSince.get(a.id) ?? a.updatedAt, now);
    rows.push({
      key: `loans:${a.id}`,
      section: "loans",
      title: `${a.tag} · ${a.model}`,
      meta: `${a.assignee?.name ?? "unassigned"} · out ${n} d${n > LOAN_DAYS ? " · overdue" : ""}`,
      href: `/inventory/${a.id}`,
      action: "Review",
      severity: n,
    });
  }

  return groupWork(rows, activeDismissals(pref?.value, todayStamp(now)), opts);
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
    orderBy: { slaAt: "asc" },
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

export interface FleetSlice {
  status: string;
  count: number;
  share: number;
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
        title: true, departmentId: true,
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
    }))
    .sort((a, b) => b.count - a.count);

  const spareByType: Record<string, number> = {};
  for (const s of spares) {
    const key = s.typeId ?? "untyped";
    spareByType[key] = (spareByType[key] ?? 0) + 1;
  }

  const neededByType: Record<string, number> = {};
  if (hires.length) {
    const policies = await prisma.equipmentPolicy.findMany({
      select: {
        id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
        slots: { select: { id: true, name: true, assetTypeId: true, required: true, loaner: true } },
      },
      orderBy: [{ name: "asc" }],
    });
    for (const e of hires) {
      const policy = resolvePolicy({ title: e.title, departmentId: e.departmentId }, policies);
      if (!policy) continue;
      const { slots } = computeLoadout(policy.slots, e.assets);
      for (const { slot, asset } of slots) {
        if (asset || !slot.required) continue;
        const key = slot.assetTypeId ?? "untyped";
        neededByType[key] = (neededByType[key] ?? 0) + 1;
      }
    }
  }

  return { total, slices, coverage: coverageLine(spareByType, neededByType).text };
}

export interface AgeBar {
  bucket: AgeBucket;
  count: number;
}

/** Five buckets; only 4y+ changes colour, because that's next year's capex conversation. */
export async function ageHistogram(now: Date = new Date()): Promise<AgeBar[]> {
  const assets = await prisma.asset.findMany({ where: { cls: "IT" }, select: { purchasedAt: true } });
  const counts = new Map<AgeBucket, number>(AGE_BUCKETS.map((b) => [b, 0]));
  for (const a of assets) {
    const bucket = ageBucket(a.purchasedAt, now);
    if (bucket) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return AGE_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }));
}

export interface WarrantyRow {
  id: string;
  tag: string;
  model: string;
  until: string;
  days: number;
  clustered: boolean;
}

export async function warrantyRunway(now: Date = new Date()): Promise<WarrantyRow[]> {
  const horizon = new Date(now.getTime() + WARRANTY_WINDOW_DAYS * DAY_MS);
  const assets = await prisma.asset.findMany({
    // a runway looks FORWARD: without the floor this card fills with kit that
    // came off warranty a year ago, which is a different problem entirely
    where: {
      warrantyUntil: { gte: now, lte: horizon },
      status: { notIn: ["DISPOSE", "DONATED", "BUYOUT"] },
      cls: "IT",
    },
    orderBy: { warrantyUntil: "asc" },
    take: 8,
    select: { id: true, tag: true, model: true, warrantyUntil: true },
  });
  return warrantyClusters(
    assets.map((a) => ({
      id: a.id,
      tag: a.tag,
      model: a.model,
      until: fmtDate(a.warrantyUntil),
      days: warrantyDaysLeft(a.warrantyUntil!, now),
    })),
  );
}

export interface TodoRow {
  id: string;
  refNo: string;
  what: string;
  meta: string;
  href: string;
  action: string;
}

export interface PurchasingHome {
  todo: TodoRow[];
  draftCount: number;
  awaitingIT: number;
  awaitingFinance: number;
  /** completed this calendar month, preformatted */
  spendThisMonth: string;
  approvalsWaiting: number;
  awaitingItCheck: number;
}

const unitsValue = (units: Array<{ qty: number; unitPrice: unknown }>) =>
  units.reduce((sum, u) => sum + u.qty * (u.unitPrice === null || u.unitPrice === undefined ? 0 : Number(u.unitPrice)), 0);

/**
 * Purchasing Home leads with what this person still has to do: drafts nobody
 * has sent, and anything that came back to them.
 */
export async function purchasingHome(userId: string, role: Role, now: Date = new Date()): Promise<PurchasingHome> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [mine, counts, completed, approvalsWaiting, awaitingItCheck] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { requestedById: userId, state: { in: ["DRAFT", "SUBMITTED"] } },
      orderBy: { updatedAt: "asc" },
      take: 8,
      select: {
        id: true, refNo: true, state: true, updatedAt: true,
        units: { select: { qty: true, unitPrice: true } },
        notes: {
          where: { kind: { not: "COMMENT" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { kind: true, author: { select: { name: true } } },
        },
      },
    }),
    prisma.purchaseRequest.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.purchaseRequest.findMany({
      where: { state: "COMPLETED", completedAt: { gte: monthStart } },
      select: { units: { select: { qty: true, unitPrice: true } } },
    }),
    prisma.approval.count({ where: { AND: [{ state: { in: ["PENDING", "CLAIMED"] } }, approvalClassWhere(role)] } }),
    prisma.asset.count({ where: { cls: "IT", itVerifiedAt: null } }),
  ]);

  const count = (state: string) => counts.find((c) => c.state === state)?._count._all ?? 0;

  const todo: TodoRow[] = mine.map((r) => {
    const last = r.notes[0];
    const bounced = (r.state === "DRAFT" && last?.kind === "IT_REJECT") || (r.state === "SUBMITTED" && last?.kind === "REQUEST_INFO");
    return {
      id: r.id,
      refNo: r.refNo,
      what: bounced ? `came back from ${last?.author.name ?? "review"}` : r.state === "DRAFT" ? "still a draft" : "waiting on IT",
      meta: `${fmtMoney(unitsValue(r.units))} · ${daysSince(r.updatedAt, now)} d`,
      href: `/purchases/${r.id}`,
      action: bounced ? "Fix and resubmit" : r.state === "DRAFT" ? "Submit" : "Open",
    };
  });

  return {
    todo,
    draftCount: count("DRAFT"),
    awaitingIT: count("SUBMITTED"),
    awaitingFinance: count("IT_REVIEWED"),
    spendThisMonth: fmtMoney(completed.reduce((sum, r) => sum + unitsValue(r.units), 0)),
    approvalsWaiting,
    awaitingItCheck,
  };
}

export interface FinanceHome {
  /** the headline: money sitting on finance's desk */
  waiting: string;
  waitingCount: number;
  /** "oldest 2 days" — null when nothing is waiting */
  oldestDays: number | null;
  approvedThisMonth: string;
  capitalized: string;
  capitalizedCount: number;
  queue: TodoRow[];
}

/**
 * README 5d: Finance Home leads with MONEY AND AGE, not counts — "₱208k
 * waiting, oldest 2 days". The count is the supporting detail, not the headline.
 */
export async function financeHome(now: Date = new Date()): Promise<FinanceHome> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [waiting, completed, capitalized] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { state: "IT_REVIEWED" },
      orderBy: { reviewedAt: "asc" },
      select: {
        id: true, refNo: true, reviewedAt: true, updatedAt: true,
        requestedBy: { select: { name: true } },
        units: { select: { qty: true, unitPrice: true } },
      },
    }),
    prisma.purchaseRequest.findMany({
      where: { state: "COMPLETED", completedAt: { gte: monthStart } },
      select: { units: { select: { qty: true, unitPrice: true } } },
    }),
    // financeHome is the ONE prisma.asset read in this file NOT pinned to IT.
    // Spec §6 makes IT's HOME alerts IT-only; this is FINANCE's home, and spec
    // line 8 gives Finance both classes — /finance/assets shows both on its
    // tabs, so a headline total that showed one would contradict the page it
    // fronts (D-16).
    prisma.asset.aggregate({ where: { cost: { not: null } }, _sum: { cost: true }, _count: { _all: true } }),
  ]);

  const oldest = waiting[0];
  return {
    waiting: fmtMoney(waiting.reduce((sum, r) => sum + unitsValue(r.units), 0)),
    waitingCount: waiting.length,
    oldestDays: oldest ? daysSince(oldest.reviewedAt ?? oldest.updatedAt, now) : null,
    approvedThisMonth: fmtMoney(completed.reduce((sum, r) => sum + unitsValue(r.units), 0)),
    // Prisma returns Decimal | null from _sum — Number() before it ever leaves here
    capitalized: fmtMoney(capitalized._sum.cost === null ? 0 : Number(capitalized._sum.cost)),
    capitalizedCount: capitalized._count._all,
    queue: waiting.slice(0, 8).map((r) => ({
      id: r.id,
      refNo: r.refNo,
      what: `from ${r.requestedBy.name}`,
      meta: `${fmtMoney(unitsValue(r.units))} · waiting ${daysSince(r.reviewedAt ?? r.updatedAt, now)} d`,
      href: `/purchases/${r.id}`,
      action: "Review",
    })),
  };
}
