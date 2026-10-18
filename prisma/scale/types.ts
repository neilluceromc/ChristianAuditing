import type { AssetClass, GroupKind, Prisma } from "@prisma/client";
import type { Rng } from "./random";

/** A user an audit row or a decision is attributed to. */
export interface Actor { id: string; name: string }

/** An equipment policy as resolvePolicy/computeLoadout (src/lib/loadout.ts) read it. */
export interface PolicyDef {
  id: string;
  name: string;
  appliesToDepartmentId: string | null;
  appliesToTitle: string | null;
  slots: Array<{ assetTypeId: string | null; required: boolean; loaner: boolean }>;
}

/**
 * The fixed rows the scale seed builds on, read from the database after `npm run db:seed` (prisma/seed-scale.ts).
 * The generators never invent a category, type, vendor or one of these departments: they only reference them.
 */
export interface ScaleContext {
  /** category name → id, class and its types (type name → id) */
  categories: Record<string, { id: string; cls: AssetClass; types: Record<string, string> }>;
  /** vendor name → id */
  vendors: Record<string, string>;
  /** department name → id and kind */
  departments: Record<string, { id: string; kind: GroupKind }>;
  fixedUsers: { admin: Actor; it: Actor; purchasing: Actor; finance: Actor };
  /** the normal seed's equipment policies (Finance standard, Bluepeak Telecom), so loadouts are filled against them too */
  policies: PolicyDef[];
}

/** A vendor the normal seed must have created; a missing one is a broken context, never a silent null. */
export function vendorIdOf(ctx: ScaleContext, name: string): string {
  const id = ctx.vendors[name];
  if (!id) throw new Error(`scale seed: no vendor ${name} — run npm run db:seed first`);
  return id;
}

/** The shared generation state: one PRNG stream, one id stream, and the clock everything is relative to. */
export interface Gen {
  rng: Rng;
  id: () => string;
  /** epoch ms the data set is generated against */
  now: number;
  /** start of the six-month history window (spec §3) */
  windowStart: number;
}

/** The scale seed's actors, by role (spec §3: perf01–10 IT, 11–12 Purchasing, 13–14 Finance, 15 admin). */
export interface Actors {
  it: Actor[];
  purchasing: Actor[];
  finance: Actor[];
  admin: Actor[];
}

export interface EmpRec {
  row: Prisma.EmployeeCreateManyInput & { id: string; employeeNo: string; name: string; title: string; joinedAt: Date };
  deptName: string;
  isClient: boolean;
  /** OFFBOARDED only: when the offboarding was completed */
  completedAt: Date | null;
}

export interface AssetRec {
  row: Prisma.AssetCreateManyInput & { id: string; tag: string; cls: AssetClass; createdAt: Date };
  category: string;
  type: string;
}

export type AuditRow = Prisma.AuditEntryCreateManyInput & { createdAt: Date; diff?: Prisma.InputJsonObject };
export type ApprovalRow = Prisma.ApprovalCreateManyInput & { createdAt: Date; refNo: string };

export interface ScaleData {
  departments: Prisma.DepartmentCreateManyInput[];
  users: Array<Omit<Prisma.UserCreateManyInput, "passwordHash">>;
  employees: Prisma.EmployeeCreateManyInput[];
  employeeNotes: Prisma.EmployeeNoteCreateManyInput[];
  policies: Prisma.EquipmentPolicyCreateManyInput[];
  policySlots: Prisma.PolicySlotCreateManyInput[];
  purchaseRequests: Prisma.PurchaseRequestCreateManyInput[];
  purchaseUnits: Prisma.PurchaseUnitCreateManyInput[];
  noteEntries: Prisma.NoteEntryCreateManyInput[];
  assets: Prisma.AssetCreateManyInput[];
  approvals: ApprovalRow[];
  reservations: Prisma.ReservationCreateManyInput[];
  auditEntries: AuditRow[];
  /** the last refNo numbers used, so the entry point can advance the app's sequences past them */
  sequences: { purchaseRequest: number; approval: number };
}
