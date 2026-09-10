import type { ApprovalType, AssetClass, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { OPEN_APPROVAL_STATES } from "@/server/modules/approvals/create";
import { computeLoadout, effectiveSlots, groupExceptionsByEmployee, resolvePolicy } from "@/lib/loadout";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  decisionOf, reportTotals, returnTargetStatus,
  type Decision, type DecisionCandidate, type ReportTotals,
} from "@/lib/offboarding";
import {
  buildOffboardingOrderBy, buildOffboardingWhere, progressOf, sortByUndecided, type Progress,
} from "@/lib/offboarding-list";
import { pageOf, ENTITY_PAGE_SIZE } from "@/lib/paging";
import type { ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";

/** One row of the /offboarding queue. */
export interface OffboardingRow {
  id: string;
  name: string;
  employeeNo: string;
  title: string;
  department: string;
  /** Phase 20 (spec §4.2): the Department facet's own filter value. */
  departmentId: string;
  m365: string | null;
  /** still physically held by them */
  itemsOut: number;
  /** decided items, INCLUDING ones whose return already executed and left */
  decided: number;
  /** items of this offboarding: still-out plus already-returned */
  total: number;
  undecided: number;
  /** Phase 20 (spec §4.2): `employee.offboardingAt` — the "started" sort key. */
  started: Date | null;
  joined: string;
}

export interface ApprovalLike {
  id: string;
  refNo: string;
  state: string;
  payload: unknown;
  createdAt: Date;
  assetId: string | null;
  /** Phase 20 (spec §4.1): the approval's claimer — who decided this item. */
  claimedBy: { name: string } | null;
  /** Phase 20 (spec §4.1): when the approval was resolved — when it was decided. */
  resolvedAt: Date | null;
}

/** The decision's own reason lives in the payload; resolutionReason is the approver's. */
function payloadReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const reason = (payload as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

/**
 * The candidates of THIS offboarding: the window, then the grouping.
 *
 * "Decided" has three parts — the window, the grouping, and `decisionOf` — and
 * every reader must apply all three. Sharing only the last two is what let the
 * completion gate disagree with the wizard: it saw a `lifecycle.return` created
 * BEFORE the person was marked offboarding (a routine `−` on the employee
 * record) and called the item decided, while the wizard, which windows, showed
 * it as still needing a decision. A null anchor means no window, so nothing
 * historical is decided — the safe direction, and the same answer both give.
 */
export function candidatesFor(
  employee: { offboardingAt: Date | null },
  approvals: ApprovalLike[],
): Map<string, DecisionCandidate[]> {
  const since = employee.offboardingAt;
  return groupCandidates(since ? approvals.filter((a) => a.createdAt >= since) : []);
}

/** Bucket return approvals by the asset they move. Prefer `candidatesFor`. */
function groupCandidates(approvals: ApprovalLike[]): Map<string, DecisionCandidate[]> {
  const byAsset = new Map<string, DecisionCandidate[]>();
  for (const a of approvals) {
    if (!a.assetId) continue; // the seeded APR-2040 has no asset — it decides nothing
    const list = byAsset.get(a.assetId) ?? [];
    list.push({
      id: a.id,
      refNo: a.refNo,
      state: a.state,
      toStatus: returnTargetStatus(a.payload),
      reason: payloadReason(a.payload),
      createdAt: a.createdAt,
      // Phase 20 (spec §4.1): the approval's claimer/resolved time, straight
      // off the row — decisionOf carries these onto the winning Decision.
      decidedBy: a.claimedBy?.name ?? null,
      decidedAt: a.resolvedAt,
    });
    byAsset.set(a.assetId, list);
  }
  return byAsset;
}

/** ids of what this person holds right now — the only assets a decision can name */
async function heldIds(employeeId: string): Promise<string[]> {
  const rows = await prisma.asset.findMany({ where: { assigneeId: employeeId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Narrow include shared by every branch that needs to compute a row — the SQL-paged path and the in-memory candidate pass alike. */
const OFFBOARDING_INCLUDE = {
  department: true,
  assets: { select: { id: true } },
  approvals: {
    where: { type: "lifecycle_return" as const, assetId: { not: null } },
    select: {
      id: true, refNo: true, state: true, payload: true, createdAt: true, assetId: true,
      claimedBy: { select: { name: true } }, resolvedAt: true,
    },
  },
} satisfies Prisma.EmployeeInclude;

type OffboardingCandidate = Prisma.EmployeeGetPayload<{ include: typeof OFFBOARDING_INCLUDE }>;

function toOffboardingRow(e: OffboardingCandidate): OffboardingRow {
  const byAsset = candidatesFor(e, e.approvals);
  const heldIdSet = new Set(e.assets.map((a) => a.id));
  // every asset in e.assets is held by them right now, hence held: true —
  // which is what makes an EXECUTED return from an EARLIER holding not count
  const decidedHeld = e.assets.filter(
    (a) => decisionOf(byAsset.get(a.id) ?? [], { held: true }) !== null,
  ).length;
  // Items whose return already executed have LEFT e.assets. Counting only the
  // held ones made this numerator run backwards as work progressed ("1 of 3"
  // becoming "0 of 2" when the worker ran) and disagree with the wizard's own
  // fraction. Both now count the same union.
  const decidedGone = [...byAsset].filter(
    ([assetId, candidates]) =>
      !heldIdSet.has(assetId) && decisionOf(candidates, { held: false }) !== null,
  ).length;
  return {
    id: e.id,
    name: e.name,
    employeeNo: e.employeeNo,
    title: e.title,
    department: e.department.name,
    departmentId: e.departmentId,
    m365: e.m365Status,
    itemsOut: heldIdSet.size,
    decided: decidedHeld + decidedGone,
    total: heldIdSet.size + decidedGone,
    undecided: heldIdSet.size - decidedHeld,
    started: e.offboardingAt,
    joined: fmtDate(e.joinedAt),
  };
}

/** `where` with one facet cleared, matching the without(facet) shape every other list's facetOptions helper uses. */
function withoutFilter(state: ListState, facet: string): ListState {
  return { ...state, filters: { ...state.filters, [facet]: [] } };
}

/**
 * Phase 20 (spec §4.2): Department counts by real SQL groupBy; Progress
 * counts are derived, so they can only be had by computing rows over the
 * candidate set (plan P-5) — both computed over `where` minus their OWN key,
 * the same convention `employeeFacetOptions`/`facetOptions` already use.
 */
async function offboardingFacets(state: ListState): Promise<{ department: FacetOption[]; progress: FacetOption[] }> {
  const [deptGroups, departments, progressCandidates] = await Promise.all([
    prisma.employee.groupBy({
      by: ["departmentId"], where: buildOffboardingWhere(withoutFilter(state, "department")), _count: true,
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.employee.findMany({
      where: buildOffboardingWhere(withoutFilter(state, "progress")),
      include: OFFBOARDING_INCLUDE,
    }),
  ]);

  const progressCounts: Record<Progress, number> = { open: 0, complete: 0 };
  for (const e of progressCandidates) progressCounts[progressOf(toOffboardingRow(e).undecided)] += 1;

  return {
    department: departments.map((d) => ({
      value: d.id, label: d.name, count: deptGroups.find((g) => g.departmentId === d.id)?._count ?? 0,
    })),
    progress: [
      { value: "open", label: "Open", count: progressCounts.open },
      { value: "complete", label: "Complete", count: progressCounts.complete },
    ],
  };
}

/**
 * Spec §4.2 / plan P-5: `progress` and the `undecided` sort are both DERIVED
 * — neither can be expressed in SQL over `Employee` alone — so whenever
 * either is active this fetches every OFFBOARDING candidate (bounded by how
 * many people are mid-offboarding at once, never the whole roster), computes
 * rows, filters/sorts in memory, then pages the KEPT set with `pageOf` —
 * the same "narrow candidate pass, then page the cut" shape
 * `employees/queries.ts`'s own gaps-only branch uses. Every other sort pages
 * straight off SQL.
 */
export async function listOffboarding(state: ListState): Promise<{
  rows: OffboardingRow[]; total: number; page: number; pageCount: number;
  facets: { department: FacetOption[]; progress: FacetOption[] };
}> {
  const where = buildOffboardingWhere(state);
  const orderBy = buildOffboardingOrderBy(state.sort);
  const progressFilter = (state.filters.progress ?? []).filter(
    (p): p is Progress => p === "open" || p === "complete",
  );

  let rows: OffboardingRow[];
  let pg: ReturnType<typeof pageOf>;

  if (progressFilter.length > 0 || orderBy === null) {
    const stableOrder: Prisma.EmployeeOrderByWithRelationInput[] =
      orderBy ?? [{ name: "asc" }, { employeeNo: "asc" }, { id: "asc" }];
    const candidates = await prisma.employee.findMany({ where, orderBy: stableOrder, include: OFFBOARDING_INCLUDE });
    let computed = candidates.map(toOffboardingRow);
    if (progressFilter.length > 0) {
      computed = computed.filter((r) => progressFilter.includes(progressOf(r.undecided)));
    }
    if (orderBy === null) {
      const undecidedSort = state.sort.find((s) => s.key === "undecided");
      computed = sortByUndecided(computed, undecidedSort?.dir ?? "asc");
    }
    pg = pageOf(computed.length, state.page, ENTITY_PAGE_SIZE);
    rows = computed.slice(pg.skip, pg.skip + pg.take);
  } else {
    const total = await prisma.employee.count({ where });
    pg = pageOf(total, state.page, ENTITY_PAGE_SIZE);
    const employees = await prisma.employee.findMany({
      where, orderBy, include: OFFBOARDING_INCLUDE, skip: pg.skip, take: pg.take,
    });
    rows = employees.map(toOffboardingRow);
  }

  const facets = await offboardingFacets(state);
  return { rows, total: pg.total, page: pg.page, pageCount: pg.pageCount, facets };
}

export interface WizardItem {
  assetId: string;
  tag: string;
  cls: AssetClass;
  model: string;
  category: string;
  status: string;
  cost: number | null;
  costLabel: string;
  /** false once the return EXECUTED and the asset left their name */
  held: boolean;
  decision: Decision | null;
  /**
   * An OPEN approval of some OTHER type on this asset. The one-open-per-asset
   * index is per asset, not per type, so a pending lifecycle.change-status
   * makes this item undecidable until it clears — and without naming it, the
   * operator gets a refusal that points nowhere.
   */
  // ApprovalType, not string: it comes straight off the Approval row, and the
  // wizard renders it through APPROVAL_TYPE_LABEL the same way decideItem's
  // refusal does
  blockedBy: { refNo: string; type: ApprovalType } | null;
}

export interface WizardSlot {
  name: string;
  required: boolean;
  typeName: string;
  tag: string | null;
  model: string | null;
  status: string | null;
}

/** A `WizardItem` known to carry a real decision — `decision` narrowed from nullable. */
export interface DecidedItem extends WizardItem {
  decision: Decision;
}

/**
 * The rows the farewell report prints, on either surface. Both the printable
 * page and its `.xlsx` export need exactly "items with a live decision" — the
 * held-but-undecided items in `WizardData.items` are not part of the report
 * for either audience. One filter, called from both places, is what keeps the
 * two from disagreeing about which rows belong (§6a rule 47).
 */
export function decidedItems(items: WizardItem[]): DecidedItem[] {
  return items.flatMap((i) => (i.decision ? [{ ...i, decision: i.decision }] : []));
}

export interface WizardData {
  employee: {
    id: string;
    name: string;
    employeeNo: string;
    title: string;
    department: string;
    employment: string;
    m365Status: string | null;
    joined: string;
  };
  policyName: string | null;
  slots: WizardSlot[];
  items: WizardItem[];
  /** held items with no live decision — Continue is blocked while this is > 0 */
  undecided: number;
  totals: ReportTotals;
}

/**
 * Step 1 reads the loadout the other way round (entry criterion #7): the same
 * computeLoadout/resolvePolicy that drive the employee record and Home's HIRE
 * rows, asked "what is still out" instead of "what is missing".
 */
export async function getWizard(employeeId: string): Promise<WizardData | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { department: true },
  });
  if (!employee) return null;

  const [held, allReturns, blockers, policies, exceptions] = await Promise.all([
    prisma.asset.findMany({
      where: { assigneeId: employeeId },
      include: { category: true },
      orderBy: [{ tag: "asc" }],
    }),
    prisma.approval.findMany({
      where: { employeeId, type: "lifecycle_return", assetId: { not: null } },
      select: {
        id: true, refNo: true, state: true, payload: true, createdAt: true, assetId: true,
        // Phase 20 (spec §4.1): the wizard rows and the farewell report/export
        // (both read straight off Decision.decidedBy/decidedAt) need the
        // claimer and resolved time on every ApprovalLike this module builds.
        claimedBy: { select: { name: true } }, resolvedAt: true,
        asset: {
          select: {
            id: true, tag: true, cls: true, model: true, status: true, cost: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
    // ANY open approval holds the one-per-asset slot, so decideItem would refuse
    // for a reason the operator can't see. Returns are included deliberately: a
    // return created BEFORE this offboarding began is outside the window, so it
    // is not this item's decision, yet it still owns the slot — and telling the
    // operator "that decision is already recorded" while showing the item as
    // undecided would deadlock them.
    prisma.approval.findMany({
      where: {
        assetId: { in: await heldIds(employeeId) },
        state: { in: [...OPEN_APPROVAL_STATES] },
      },
      select: { refNo: true, type: true, assetId: true },
    }),
    prisma.equipmentPolicy.findMany({
      include: { slots: { include: { assetType: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } },
      orderBy: [{ name: "asc" }],
    }),
    // Phase 16 (spec §3.3): this person's own slot exceptions — every
    // computeLoadout/resolvePolicy consumer computes over effectiveSlots, and
    // the wizard's Step 1 loadout (entry criterion #7) is no exception.
    prisma.employeeSlotException.findMany({
      where: { employeeId },
      orderBy: [{ employeeId: "asc" }, { id: "asc" }],
    }),
  ]);

  // The window lives in candidatesFor — see its comment. Applied to the row list
  // too, because the item set is built from these same rows.
  const since = employee.offboardingAt;
  const returns = since ? allReturns.filter((r) => r.createdAt >= since) : [];
  const byAsset = candidatesFor(employee, allReturns);
  const openByAsset = new Map(
    blockers.filter((b) => b.assetId).map((b) => [b.assetId!, { refNo: b.refNo, type: b.type }]),
  );

  /**
   * An open approval only BLOCKS this item if it isn't the item's own decision.
   * Comparing refNos is what separates "your decision is pending" from "someone
   * else's request owns this asset" — including a pre-window return, which is a
   * real request the operator has to clear even though it decides nothing here.
   */
  const blockerFor = (assetId: string, decision: Decision | null) => {
    const open = openByAsset.get(assetId);
    return open && open.refNo !== decision?.refNo ? open : null;
  };

  const money = (cost: Prisma.Decimal | null) => (cost === null ? null : Number(cost));

  const toItem = (
    a: {
      id: string; tag: string; cls: AssetClass; model: string; status: string;
      cost: Prisma.Decimal | null; category: { name: string };
    },
    held: boolean,
    decision: Decision | null,
  ): WizardItem => ({
    assetId: a.id,
    tag: a.tag,
    cls: a.cls,
    model: a.model,
    category: a.category.name,
    status: a.status,
    cost: money(a.cost),
    costLabel: fmtMoney(money(a.cost)),
    held,
    decision,
    blockedBy: blockerFor(a.id, decision),
  });

  // The item set is what they hold UNION what a return already moved out of
  // their name: an EXECUTED return clears assigneeId, and a decided item must
  // not vanish from the wizard the moment the worker runs.
  const items = new Map<string, WizardItem>();
  for (const a of held) {
    items.set(a.id, toItem(a, true, decisionOf(byAsset.get(a.id) ?? [], { held: true })));
  }
  for (const r of returns) {
    const a = r.asset;
    if (!a || items.has(a.id)) continue;
    // held: false — the asset already left their name, which is precisely why
    // an EXECUTED return counts here and is skipped in the loop above
    const decision = decisionOf(byAsset.get(a.id) ?? [], { held: false });
    if (!decision) continue; // a rejected-only history is not an item of this offboarding
    items.set(a.id, toItem(a, false, decision));
  }

  // plain comparison, not localeCompare: deterministic beats locale-aware, and
  // src/lib/offboarding.ts's tiebreaker makes the same choice for the same reason
  const rows = [...items.values()].sort((x, y) => (x.tag < y.tag ? -1 : x.tag > y.tag ? 1 : 0));
  const policy = resolvePolicy(employee, policies);
  const employeeExceptions = groupExceptionsByEmployee(exceptions).get(employeeId) ?? [];
  const loadout = computeLoadout(effectiveSlots(policy?.slots ?? [], employeeExceptions), held);
  // computeLoadout is generic over assets, not slots, so the slot it hands back
  // is typed SlotLike and has lost its assetType include — look the name back up.
  const typeName = new Map((policy?.slots ?? []).map((s) => [s.id, s.assetType?.name ?? "any"]));

  return {
    employee: {
      id: employee.id,
      name: employee.name,
      employeeNo: employee.employeeNo,
      title: employee.title,
      department: employee.department.name,
      employment: employee.employment,
      m365Status: employee.m365Status,
      joined: fmtDate(employee.joinedAt),
    },
    policyName: policy?.name ?? null,
    slots: loadout.slots.map(({ slot, asset }) => ({
      name: slot.name,
      required: slot.required,
      typeName: typeName.get(slot.id) ?? "any",
      tag: asset?.tag ?? null,
      model: asset?.model ?? null,
      status: asset?.status ?? null,
    })),
    items: rows,
    undecided: rows.filter((i) => i.held && !i.decision).length,
    totals: reportTotals(
      rows.filter((i) => i.decision).map((i) => ({ outcome: i.decision!.outcome, cost: i.cost })),
    ),
  };
}
