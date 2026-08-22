/**
 * Scope decision 5. An import writes one AuditEntry per row, so this cap bounds
 * an append-only table from a single click. Between BULK_MAX (200) and the
 * 10,000-row export cap, deliberately.
 */
export const IMPORT_ROW_CAP = 2_000;

export function rowCapRefusal(count: number): string {
  return (
    `That file has ${count} rows, over the ${IMPORT_ROW_CAP}-row import cap. ` +
    "Split it and upload the parts. Nothing was imported."
  );
}

export const BLOCK_CAUSES = [
  "missing-tag",
  "duplicate-serial",
  "unknown-category",
  "unknown-type",
  "unknown-assignee",
  "unknown-vendor",
  "bad-status",
  "bad-date",
  "bad-number",
] as const;

export type BlockCause = (typeof BLOCK_CAUSES)[number];

/**
 * A fix is either a LINK out of the wizard (the operator has to create
 * something that does not exist — scope decision 12 refuses to create taxonomy
 * as a side effect of an upload) or an OPTION that re-plans the same file with
 * one decision changed. Nothing here mutates: an option flips a boolean and the
 * dry run happens again, so the operator sees the new verdict before anything
 * is written.
 */
export type ImportOption = "treatDuplicateSerialAsUpdate" | "dropUnknownAssignee";

export interface BlockFix {
  kind: "link" | "option";
  label: string;
  href?: string;
  option?: ImportOption;
}

export interface BlockSpec {
  label: string;
  explain: string;
  fix: BlockFix | null;
}

const SPECS: Record<BlockCause, BlockSpec> = {
  "missing-tag": {
    label: "No asset tag",
    explain:
      "The Tag column is empty on these rows. A tag is how every other screen in this app names an " +
      "asset, so a row without one can be neither created nor matched to an existing record.",
    fix: { kind: "link", label: "Fix the file", href: "/inventory/import" },
  },
  "duplicate-serial": {
    label: "Duplicate serial",
    explain:
      "The serial on these rows already belongs to a different asset. Serials are unique here, so this " +
      "is either a re-upload of assets you already have or a typo.",
    fix: { kind: "option", label: "Update those assets instead", option: "treatDuplicateSerialAsUpdate" },
  },
  "unknown-category": {
    label: "Category doesn't exist",
    explain:
      "These rows name a category this system has never seen. Categories are created deliberately, " +
      "not as a side effect of an upload, so create it first and re-upload.",
    fix: { kind: "link", label: "Create category", href: "/admin/asset-categories" },
  },
  "unknown-type": {
    label: "Type doesn't exist",
    explain:
      "These rows name an asset type this system has never seen. Same rule as categories: create it " +
      "first, then re-upload.",
    fix: { kind: "link", label: "Create type", href: "/admin/asset-types" },
  },
  "unknown-assignee": {
    label: "Assignee not found",
    explain:
      "These rows name someone who is not an employee record here, by employee number or by name. You " +
      "can import them unassigned and hand them out later.",
    fix: { kind: "option", label: "Leave as spare", option: "dropUnknownAssignee" },
  },
  "unknown-vendor": {
    label: "Vendor not found",
    explain:
      "These rows name a vendor this system has never seen. Vendors are reference data, so create it " +
      "first and re-upload.",
    fix: { kind: "link", label: "Create vendor", href: "/admin/vendors" },
  },
  "bad-status": {
    label: "Status not recognised",
    explain:
      "These rows carry a status that is not one of this system's eight. Leave the column blank to get " +
      "SPARE, or correct it to a listed value.",
    fix: { kind: "link", label: "See the statuses", href: "/inventory" },
  },
  "bad-date": {
    label: "Date not readable",
    explain:
      "A date cell on these rows is neither a real spreadsheet date nor YYYY-MM-DD text. Format the " +
      "column as a date in the spreadsheet and re-upload.",
    fix: { kind: "link", label: "Fix the file", href: "/inventory/import" },
  },
  "bad-number": {
    label: "Amount not readable",
    explain:
      "A cost cell on these rows is not a number. Remove currency symbols and thousands separators — " +
      "the cell should hold a plain amount.",
    fix: { kind: "link", label: "Fix the file", href: "/inventory/import" },
  },
};

export function blockSpec(cause: BlockCause): BlockSpec {
  return SPECS[cause];
}

export interface BlockedRow { row: number; cause: BlockCause; detail: string }

export interface CauseGroup {
  cause: BlockCause;
  count: number;
  rows: number[];
  /** distinct offending values, capped at three, so a group can name examples */
  examples: string[];
}

/**
 * The brief's rule made mechanical: one group per cause, biggest first, each
 * carrying its row numbers so the operator can find them in the file. Ties keep
 * BLOCK_CAUSES order, so two runs over one file group identically.
 */
export function groupByCause(blocked: BlockedRow[]): CauseGroup[] {
  const byCause = new Map<BlockCause, BlockedRow[]>();
  for (const b of blocked) {
    const list = byCause.get(b.cause) ?? [];
    list.push(b);
    byCause.set(b.cause, list);
  }
  return [...byCause.entries()]
    .map(([cause, rows]) => ({
      cause,
      count: rows.length,
      rows: rows.map((r) => r.row),
      examples: [...new Set(rows.map((r) => r.detail))].filter(Boolean).slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count || BLOCK_CAUSES.indexOf(a.cause) - BLOCK_CAUSES.indexOf(b.cause));
}
