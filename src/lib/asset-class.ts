import type { AssetClass, AssetStatus, Prisma, Role } from "@prisma/client";

/**
 * Phase 13. THE partition of AssetStatus into the two classes, and every rule
 * that follows from it. Nothing else in the codebase may hard-code which
 * status belongs to which class — it asks here.
 *
 * "Admin" in the 2026-09-02 meeting notes is the PURCHASING department; the
 * codebase's `admin` is the sysadmin role. Hence the class is PURCHASING.
 */
// Order is load-bearing: index 0 is the default class -- what parseCls(null)
// means and which tab a class-split screen opens on.
export const ASSET_CLASSES = ["IT", "PURCHASING"] as const satisfies readonly AssetClass[];

export const CLASS_LABEL: Record<AssetClass, string> = { IT: "IT", PURCHASING: "Purchasing" };

/**
 * Example copy for form placeholders and hints — one per class, so a
 * Purchasing user registering a car is not told to model it on a ThinkPad.
 * Kept here (not in the component) so vitest can pin it.
 */
export const CLASS_EXAMPLE: Record<AssetClass, { model: string; prefixHint: string; tag: string }> = {
  IT: { model: "ThinkPad T14 Gen 4", prefixHint: "Two letters, e.g. LT for laptops.", tag: "BR-LT-0201" },
  PURCHASING: { model: "Toyota Vios 1.3 E", prefixHint: "Two letters, e.g. VH for vehicles.", tag: "BR-VH-0201" },
};

/**
 * The label with its indefinite article — "an IT asset", "a Purchasing
 * category". Use this, never `a ${CLASS_LABEL[cls]}`: "a IT" has shipped
 * twice in this phase (D-8, D-13).
 */
export const CLASS_PHRASE: Record<AssetClass, string> = { IT: "an IT", PURCHASING: "a Purchasing" };

/**
 * A control that offers statuses to a PERSON -- a picker, a facet, a chip row
 * -- must use statusesFor(cls). A flat list of every AssetStatus is only for
 * "is this any valid value at all" checks (zod enums, an import's error text).
 * Offering DEPLOYED for a car is a bug, and a flat list makes it an easy one.
 */
export const STATUSES_BY_CLASS = {
  IT: ["DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING"],
  PURCHASING: ["OPERATIONAL", "STORED", "REPAIRING", "RETIRED", "SOLD", "LOST"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/** What a freshly registered or created asset reads. */
export const DEFAULT_STATUS = {
  IT: "SPARE", PURCHASING: "STORED",
} as const satisfies Record<AssetClass, AssetStatus>;

/**
 * The status an asset must currently hold to be ASSIGNED -- the worker's
 * precondition, and the approval detail's "Asset is assignable" check. Its own
 * constant, not DEFAULT_STATUS: that one is what a new asset READS, and the two
 * coincide today by design, not by definition. A test pins them equal.
 */
export const ASSIGNABLE_FROM = {
  IT: "SPARE", PURCHASING: "STORED",
} as const satisfies Record<AssetClass, AssetStatus>;

/** What lifecycle.assign lands on when the payload does not say. */
export const DEFAULT_ASSIGN_STATUS = {
  IT: "DEPLOYED", PURCHASING: "OPERATIONAL",
} as const satisfies Record<AssetClass, AssetStatus>;

/** Legal `to.status` for lifecycle.assign. */
export const ASSIGN_TARGETS = {
  IT: ["DEPLOYED", "TEMPORARY"], PURCHASING: ["OPERATIONAL"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/** Legal `to.status` for lifecycle.return — the wizard's outcomes. */
export const RETURN_TARGETS = {
  IT: ["SPARE", "DEFECTIVE", "BUYOUT", "MISSING"], PURCHASING: ["STORED", "REPAIRING", "LOST"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/** Offered on the create form (README 3b); anything beyond the default routes through an approval. */
export const CREATABLE_BY_CLASS = {
  IT: ["SPARE", "DEPLOYED", "TEMPORARY"], PURCHASING: ["STORED", "OPERATIONAL"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/**
 * Statuses an asset may hold WHILE assigned -- the worker's change-status
 * guard, which exists to stop an asset being status-changed out from under
 * its holder. Its OWN literal, not an alias of ASSIGN_TARGETS: that one is a
 * workflow set that may widen (spec §7 anticipates replace/transfer); this one
 * is a safety invariant. They coincide today, and a test says so.
 */
export const HOLDER_STATUSES = {
  IT: ["DEPLOYED", "TEMPORARY"], PURCHASING: ["OPERATIONAL"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/**
 * Which classes a role may REGISTER, CREATE, EDIT, and REQUEST STATUS CHANGES
 * on -- the four write rows of spec §5. Deliberately NOT "act on" in general:
 * finance_staff acts on assets of BOTH classes through confirm / send back
 * (Phase 12) and is [] here on purpose. A guard on those Finance actions must
 * not use this map.
 */
export const MANAGEABLE_CLASSES: Record<Role, readonly AssetClass[]> = {
  admin: ["IT", "PURCHASING"],
  it_staff: ["IT"],
  purchasing_staff: ["PURCHASING"],
  finance_staff: [],
  viewer: [],
};

export function statusesFor(cls: AssetClass): readonly AssetStatus[] {
  return STATUSES_BY_CLASS[cls];
}

export function isStatusOf(cls: AssetClass, status: string): status is AssetStatus {
  return (STATUSES_BY_CLASS[cls] as readonly string[]).includes(status);
}

export function canManageClass(role: Role, cls: AssetClass): boolean {
  return MANAGEABLE_CLASSES[role].includes(cls);
}

/**
 * `?cls=` is a nav destination, not a config facet — the same shape as
 * `?purchaseYear=` (see inventory-list.ts's parsePurchaseYear). Invalid input
 * parses to null and the caller treats null as IT, so every URL that predates
 * this phase means exactly what it used to.
 */
export function parseCls(raw: string | null | undefined): AssetClass | null {
  return raw != null && (ASSET_CLASSES as readonly string[]).includes(raw) ? (raw as AssetClass) : null;
}

/** Splice `cls` onto an already-serialized list query string. IT is the default and is never written. */
export function withClsQS(qs: string, cls: AssetClass | null): string {
  if (cls !== "PURCHASING") return qs;
  return qs ? `${qs}&cls=PURCHASING` : "?cls=PURCHASING";
}

/**
 * Phase 14 (spec §2). Which classes a role SEES on the register — list, record,
 * export, search, scan, activity. IT's department sees IT only; Purchasing,
 * Finance and admin see everything; the viewer is IT's read-only seat.
 * Person-centric pages (an employee's holdings, offboarding) are NOT scoped by
 * this map — they render an invisible tag as text (spec §3.3).
 */
export const VISIBLE_CLASSES: Record<Role, readonly AssetClass[]> = {
  admin: ["IT", "PURCHASING"],
  it_staff: ["IT"],
  purchasing_staff: ["IT", "PURCHASING"],
  finance_staff: ["IT", "PURCHASING"],
  viewer: ["IT"],
};

/**
 * Which classes a role may REGISTER or CREATE into. Purchasing buys for the
 * whole company, so it registers both; IT registers its own. Registering is
 * not managing: a laptop Purchasing registers is IT's from that moment.
 */
export const REGISTRABLE_CLASSES: Record<Role, readonly AssetClass[]> = {
  admin: ["IT", "PURCHASING"],
  it_staff: ["IT"],
  purchasing_staff: ["IT", "PURCHASING"],
  finance_staff: [],
  viewer: [],
};

export function canSeeClass(role: Role, cls: AssetClass): boolean {
  return VISIBLE_CLASSES[role].includes(cls);
}

export function canRegisterClass(role: Role, cls: AssetClass): boolean {
  return REGISTRABLE_CLASSES[role].includes(cls);
}

/** AND this into any asset read a single-class role may reach. `{}` for an all-class role. */
export function visibleClassWhere(role: Role): Prisma.AssetWhereInput {
  const mine = VISIBLE_CLASSES[role];
  return mine.length === ASSET_CLASSES.length ? {} : { cls: { in: [...mine] } };
}

/**
 * Spec §5.1. An IT asset registered by a department that does not manage IT
 * waits for IT's check. The class is part of the predicate on purpose: a
 * Purchasing asset never carries a stamp and is never "awaiting".
 */
export function isAwaitingItCheck(a: { cls: AssetClass; itVerifiedAt: Date | null }): boolean {
  return a.cls === "IT" && a.itVerifiedAt === null;
}

/**
 * Spec §5.4. Who may EDIT: the managing department always; the registering
 * department only while IT has not yet checked it (so Purchasing can fix its
 * own typo). Status, assign and return follow canManageClass alone.
 */
export function canEditAsset(role: Role, a: { cls: AssetClass; itVerifiedAt: Date | null }): boolean {
  return canManageClass(role, a.cls) || (isAwaitingItCheck(a) && canRegisterClass(role, a.cls));
}
