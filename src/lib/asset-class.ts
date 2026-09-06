import type { AssetClass, AssetStatus, Role } from "@prisma/client";

/**
 * Phase 13. THE partition of AssetStatus into the two classes, and every rule
 * that follows from it. Nothing else in the codebase may hard-code which
 * status belongs to which class — it asks here.
 *
 * "Admin" in the 2026-09-02 meeting notes is the PURCHASING department; the
 * codebase's `admin` is the sysadmin role. Hence the class is PURCHASING.
 */
export const ASSET_CLASSES = ["IT", "PURCHASING"] as const satisfies readonly AssetClass[];

export const CLASS_LABEL: Record<AssetClass, string> = { IT: "IT", PURCHASING: "Purchasing" };

export const STATUSES_BY_CLASS = {
  IT: ["DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING"],
  PURCHASING: ["OPERATIONAL", "STORED", "REPAIRING", "RETIRED", "SOLD", "LOST"],
} as const satisfies Record<AssetClass, readonly AssetStatus[]>;

/** What a freshly registered or created asset reads. */
export const DEFAULT_STATUS = {
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

/** Statuses an asset may hold WHILE assigned — the worker's change-status guard. */
export const HOLDER_STATUSES = ASSIGN_TARGETS;

/** Which classes a role may register, edit and request changes on. Finance and viewers act on none. */
export const CLASSES_FOR_ROLE: Record<Role, readonly AssetClass[]> = {
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

export function canActOnClass(role: Role, cls: AssetClass): boolean {
  return CLASSES_FOR_ROLE[role].includes(cls);
}

/**
 * `?cls=` is a nav destination, not a config facet — the same shape as
 * `?purchaseYear=` (see inventory-list.ts's parsePurchaseYear). Invalid input
 * parses to null and the caller treats null as IT, so every URL that predates
 * this phase means exactly what it used to.
 */
export function parseCls(raw: string | null | undefined): AssetClass | null {
  return raw === "IT" || raw === "PURCHASING" ? raw : null;
}

/** Splice `cls` onto an already-serialized list query string. IT is the default and is never written. */
export function withClsQS(qs: string, cls: AssetClass | null): string {
  if (cls !== "PURCHASING") return qs;
  return qs ? `${qs}&cls=PURCHASING` : "?cls=PURCHASING";
}
