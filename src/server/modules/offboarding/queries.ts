import { prisma } from "@/server/db/client";
import { computeLoadout, resolvePolicy } from "@/lib/loadout";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  decisionOf, reportTotals, returnTargetStatus,
  type Decision, type DecisionCandidate, type ReportTotals,
} from "@/lib/offboarding";

/** One row of the /offboarding queue. */
export interface OffboardingRow {
  id: string;
  name: string;
  employeeNo: string;
  title: string;
  department: string;
  m365: string | null;
  /** still physically held by them */
  itemsOut: number;
  decided: number;
  undecided: number;
  joined: string;
}

export interface ApprovalLike {
  id: string;
  refNo: string;
  state: string;
  payload: unknown;
  createdAt: Date;
  assetId: string | null;
}

/** The decision's own reason lives in the payload; resolutionReason is the approver's. */
function payloadReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const reason = (payload as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

/**
 * Every return approval this person has, bucketed by the asset it moves.
 * EXPORTED because `completeOffboarding` re-derives "is everything decided?"
 * server-side, and a second definition there would be a second answer.
 */
export function groupCandidates(approvals: ApprovalLike[]): Map<string, DecisionCandidate[]> {
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
    });
    byAsset.set(a.assetId, list);
  }
  return byAsset;
}

export async function listOffboarding(): Promise<OffboardingRow[]> {
  const employees = await prisma.employee.findMany({
    where: { employment: "OFFBOARDING" },
    include: {
      department: true,
      assets: { select: { id: true } },
      approvals: {
        where: { type: "lifecycle_return", assetId: { not: null } },
        select: { id: true, refNo: true, state: true, payload: true, createdAt: true, assetId: true },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return employees.map((e) => {
    const byAsset = groupCandidates(e.approvals);
    // every asset in e.assets is held by them right now, hence held: true —
    // which is what makes an EXECUTED return from an EARLIER holding not count
    const decided = e.assets.filter((a) => decisionOf(byAsset.get(a.id) ?? [], { held: true }) !== null).length;
    return {
      id: e.id,
      name: e.name,
      employeeNo: e.employeeNo,
      title: e.title,
      department: e.department.name,
      m365: e.m365Status,
      itemsOut: e.assets.length,
      decided,
      undecided: e.assets.length - decided,
      joined: fmtDate(e.joinedAt),
    };
  });
}

export interface WizardItem {
  assetId: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  cost: number | null;
  costLabel: string;
  /** false once the return EXECUTED and the asset left their name */
  held: boolean;
  decision: Decision | null;
}

export interface WizardSlot {
  name: string;
  required: boolean;
  typeName: string;
  tag: string | null;
  model: string | null;
  status: string | null;
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

  const [held, returns, policies] = await Promise.all([
    prisma.asset.findMany({
      where: { assigneeId: employeeId },
      include: { category: true },
      orderBy: [{ tag: "asc" }],
    }),
    prisma.approval.findMany({
      where: { employeeId, type: "lifecycle_return", assetId: { not: null } },
      select: {
        id: true, refNo: true, state: true, payload: true, createdAt: true, assetId: true,
        asset: {
          select: {
            id: true, tag: true, model: true, status: true, cost: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
    prisma.equipmentPolicy.findMany({
      include: { slots: { include: { assetType: true } } },
      orderBy: [{ name: "asc" }],
    }),
  ]);

  const byAsset = groupCandidates(returns);
  const money = (cost: unknown) => (cost === null || cost === undefined ? null : Number(cost));

  // The item set is what they hold UNION what a return already moved out of
  // their name: an EXECUTED return clears assigneeId, and a decided item must
  // not vanish from the wizard the moment the worker runs.
  const items = new Map<string, WizardItem>();
  for (const a of held) {
    items.set(a.id, {
      assetId: a.id, tag: a.tag, model: a.model, category: a.category.name, status: a.status,
      cost: money(a.cost), costLabel: fmtMoney(money(a.cost)),
      held: true,
      decision: decisionOf(byAsset.get(a.id) ?? [], { held: true }),
    });
  }
  for (const r of returns) {
    const a = r.asset;
    if (!a || items.has(a.id)) continue;
    // held: false — the asset already left their name, which is precisely why
    // an EXECUTED return counts here and is skipped in the loop above
    const decision = decisionOf(byAsset.get(a.id) ?? [], { held: false });
    if (!decision) continue; // a rejected-only history is not an item of this offboarding
    items.set(a.id, {
      assetId: a.id, tag: a.tag, model: a.model, category: a.category.name, status: a.status,
      cost: money(a.cost), costLabel: fmtMoney(money(a.cost)),
      held: false,
      decision,
    });
  }

  const rows = [...items.values()].sort((x, y) => x.tag.localeCompare(y.tag));
  const policy = resolvePolicy(employee, policies);
  const loadout = computeLoadout(policy?.slots ?? [], held);
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
