import { prisma } from "@/server/db/client";
import { fmtDate } from "@/lib/format";
import { slaLabel } from "@/lib/approvals-list";
import { summarizeApproval } from "@/lib/approval-execution";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import {
  AGE_BUCKETS, DISMISS_PREF_KEY, activeDismissals, ageBucket, coverageLine, shiftOrder,
  todayStamp, warrantyClusters, warrantyDaysLeft, type AgeBucket, type ShiftRow,
} from "@/lib/home";

const DAY_MS = 86_400_000;
const daysSince = (d: Date, now: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / DAY_MS));

/** ACTIVE employees who started recently are the ones whose kit is still landing. */
const HIRE_WINDOW_DAYS = 30;
const WARRANTY_WINDOW_DAYS = 90;

/**
 * "Your shift" (README): five rows ordered by what breaks first, each with the
 * one action that clears it. Every row is a real record — nothing here is a
 * count for its own sake.
 */
export async function yourShift(userId: string, now: Date = new Date()): Promise<ShiftRow[]> {
  const [breached, failed, leavers, hires, missing, orphaned, pref] = await Promise.all([
    prisma.approval.findMany({
      where: { state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: now } },
      orderBy: { slaAt: "asc" },
      take: 10,
      include: { asset: true, employee: true },
    }),
    prisma.approval.findMany({
      where: { state: "EXECUTION_FAILED" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      include: { asset: true, employee: true },
    }),
    prisma.employee.findMany({
      where: { employment: "OFFBOARDING" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, name: true, employeeNo: true, updatedAt: true, _count: { select: { assets: true } } },
    }),
    prisma.employee.findMany({
      where: { employment: "ACTIVE", joinedAt: { gte: new Date(now.getTime() - HIRE_WINDOW_DAYS * DAY_MS) } },
      orderBy: { joinedAt: "asc" },
      take: 10,
      select: {
        id: true, name: true, employeeNo: true, title: true, departmentId: true, joinedAt: true,
        assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } },
      },
    }),
    prisma.asset.findMany({
      where: { status: "MISSING" },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, tag: true, model: true, updatedAt: true },
    }),
    // custody that doesn't add up: DEPLOYED with nobody holding it
    prisma.asset.findMany({
      where: { status: "DEPLOYED", assigneeId: null },
      orderBy: { updatedAt: "asc" },
      take: 10,
      select: { id: true, tag: true, model: true, updatedAt: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
      select: { value: true },
    }),
  ]);

  const policies = hires.length
    ? await prisma.equipmentPolicy.findMany({
        select: {
          id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
          slots: { select: { id: true, name: true, assetTypeId: true, required: true } },
        },
      })
    : [];

  const rows: ShiftRow[] = [];

  for (const a of breached) {
    const s = summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name });
    rows.push({
      key: `SLA:${a.id}`,
      kind: "SLA",
      title: `${a.refNo} · ${s.line1}`,
      meta: `${slaLabel(a.slaAt, now).text} · ${a.priority.toLowerCase()}`,
      href: `/approvals/${a.id}`,
      action: a.state === "PENDING" ? "Claim" : "Open",
      severity: daysSince(a.slaAt, now),
    });
  }

  for (const a of failed) {
    const s = summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name });
    rows.push({
      key: `EXEC:${a.id}`,
      kind: "EXEC",
      title: `${a.refNo} · ${s.line1}`,
      meta: `execution failed ${daysSince(a.updatedAt, now)} d ago`,
      href: `/approvals/${a.id}`,
      action: "Retry",
      severity: daysSince(a.updatedAt, now),
    });
  }

  for (const e of leavers) {
    rows.push({
      key: `LEAVE:${e.id}`,
      kind: "LEAVE",
      title: `${e.name} is leaving`,
      meta: `${e.employeeNo} · ${e._count.assets} item${e._count.assets === 1 ? "" : "s"} still out`,
      href: `/employees/${e.id}`,
      action: "Collect equipment",
      severity: daysSince(e.updatedAt, now),
    });
  }

  for (const e of hires) {
    const policy = resolvePolicy({ title: e.title, departmentId: e.departmentId }, policies);
    if (!policy) continue;
    const loadout = computeLoadout(policy.slots, e.assets);
    if (loadout.missingRequired === 0) continue;
    rows.push({
      key: `HIRE:${e.id}`,
      kind: "HIRE",
      title: `${e.name} started ${daysSince(e.joinedAt, now)} d ago`,
      meta: `${e.employeeNo} · ${loadout.missingRequired} required slot${loadout.missingRequired === 1 ? "" : "s"} empty · ${policy.name}`,
      href: `/employees/${e.id}`,
      action: "Fill loadout",
      severity: daysSince(e.joinedAt, now),
    });
  }

  for (const a of missing) {
    rows.push({
      key: `DATA:${a.id}`,
      kind: "DATA",
      title: `${a.tag} is MISSING`,
      meta: `${a.model} · custody lost ${daysSince(a.updatedAt, now)} d ago`,
      href: `/inventory/${a.id}`,
      action: "Investigate",
      severity: daysSince(a.updatedAt, now),
    });
  }

  for (const a of orphaned) {
    rows.push({
      key: `DATA:${a.id}`,
      kind: "DATA",
      title: `${a.tag} reads DEPLOYED with no holder`,
      meta: `${a.model} · assign it or return it to the pool`,
      href: `/inventory/${a.id}`,
      action: "Fix record",
      severity: daysSince(a.updatedAt, now),
    });
  }

  return shiftOrder(rows, activeDismissals(pref?.value, todayStamp(now)));
}

export interface ClaimRow {
  id: string;
  refNo: string;
  line1: string;
  sla: { text: string; overdue: boolean };
}

/** README: claims sit ABOVE the pool — a forgotten claim is worse than an unclaimed item. */
export async function claimedByYou(userId: string, now: Date = new Date()): Promise<ClaimRow[]> {
  const rows = await prisma.approval.findMany({
    where: { state: "CLAIMED", claimedById: userId },
    orderBy: { slaAt: "asc" },
    take: 5,
    include: { asset: true, employee: true },
  });
  return rows.map((a) => ({
    id: a.id,
    refNo: a.refNo,
    line1: summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name }).line1,
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
    prisma.asset.groupBy({ by: ["status"], _count: { _all: true } }),
    // a spare under an ACTIVE hold is already promised to someone
    prisma.asset.findMany({
      where: { status: "SPARE", reservations: { none: { state: "ACTIVE" } } },
      select: { typeId: true },
    }),
    prisma.employee.findMany({
      where: { employment: "ACTIVE", joinedAt: { gte: new Date(now.getTime() - HIRE_WINDOW_DAYS * DAY_MS) } },
      select: {
        title: true, departmentId: true,
        assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } },
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
        slots: { select: { id: true, name: true, assetTypeId: true, required: true } },
      },
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
  const assets = await prisma.asset.findMany({ select: { purchasedAt: true } });
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
