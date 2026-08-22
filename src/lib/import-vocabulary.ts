import { ASSET_STATUSES } from "./inventory-list";

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

/**
 * Task 11 round two, V-4. `next.config.ts`'s `bodySizeLimit: "4mb"` (Next's
 * compiled `bytes` package: "mb" is `1 << 20`, i.e. MiB, not decimal) is a
 * hard ceiling nothing client-side checks — a workbook past it rejects at the
 * framework boundary with no `catch` anywhere in this app to turn into a
 * banner. `next.config.ts` cannot import a TS constant from `src/lib` (its
 * own comment says so), so the number is duplicated by necessity: this is the
 * canonical copy, and `next.config.ts`'s literal carries a comment pointing
 * back here. Keep the two in sync by hand if either ever changes.
 */
export const IMPORT_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function uploadTooLargeRefusal(bytes: number): string {
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  return (
    `That file is ${mb(bytes)} MB, over the ${mb(IMPORT_MAX_UPLOAD_BYTES)} MB upload limit. ` +
    "Split it and upload the parts. Nothing was imported."
  );
}

/**
 * Amended 2026-08-22 (Task 7 quality review, both rounds): the order IS the
 * `groupByCause` tiebreak (equal-count groups sort by this array's index), so
 * re-ordering it changes API behaviour a caller may already depend on.
 * New causes are ALWAYS appended at the end — never inserted — so every
 * existing cause keeps its index. `value-too-long` was renamed in place to
 * `value-out-of-range` (NI-6, round 2): it fired on a model that was too
 * SHORT, a label stating the opposite of the problem, so the string itself
 * was wrong rather than merely misplaced.
 */
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
  "bad-tag",
  "missing-model",
  "duplicate-in-file",
  "ambiguous-assignee",
  "inactive-assignee",
  "deployed-without-holder",
  "lifecycle-via-import",
  "value-out-of-range",
  "missing-category",
  "type-outside-category",
  // R-1 (round 2): three, not one shared cause — the honest fix differs per
  // entity (an admin can rename a category or type; nothing in this app can
  // rename or create a Vendor at all), and a fix is defined PER CAUSE, not
  // per row. Appended, per this array's own rule above.
  "duplicate-category-name",
  "duplicate-type-name",
  "duplicate-vendor-name",
] as const;

export type BlockCause = (typeof BLOCK_CAUSES)[number];

/**
 * A fix is one of three things:
 * - LINK: out of the wizard, to a page that actually exists and can act on the
 *   cause (scope decision 12 refuses to create taxonomy as a side effect of an
 *   upload, so the operator goes create it themselves).
 * - OPTION: re-plans the same file with one decision changed. Nothing here
 *   mutates: an option flips a boolean and the dry run happens again, so the
 *   operator sees the new verdict before anything is written.
 * - REUPLOAD: the only real fix is editing the sheet itself. There is no admin
 *   page to send the operator to (most of these causes are typos or shape
 *   problems), and `/inventory/import` is the page the operator is already
 *   standing on — linking to it would be a link to nowhere. T11 renders this
 *   as the wizard's own restart affordance instead of an anchor tag.
 *
 * D-B (2026-08-22): every cause must resolve to a fix the operator can act on
 * right now. `unknown-vendor` shipped violating this — it linked to
 * `/admin/vendors`, which does not exist, and no surface in this application
 * can create a Vendor at all (`reference-actions.ts`'s entity enum has no
 * "vendor" member). Fixed by turning it into an option: Vendor is nullable
 * and purely informational, so dropping it loses nothing unrecoverable.
 */
/**
 * T9: promoted from a bare union to an `as const` array so this is the ONLY
 * place all five options are enumerated. Before this, the sole enumeration
 * was a hand-typed copy inside `import-vocabulary.test.ts` — a list that
 * would silently drift from this union the day a sixth option is added, in a
 * test whose entire job is to assert every option is real. The test now
 * imports this array instead of retyping it, and `optionsFrom`
 * (`asset-actions.ts`) folds over it too, so a sixth option is impossible to
 * forget in any of the three places. The same defect §6a rules 26/37/38
 * describe for `ASSET_STATUSES`, caught here before it cost anything.
 */
export const IMPORT_OPTIONS = [
  "treatDuplicateSerialAsUpdate",
  "dropUnknownAssignee",
  "dropUnknownVendor",
  "keepCurrentLifecycle",
  "importUnheldAsSpare",
] as const;

export type ImportOption = (typeof IMPORT_OPTIONS)[number];

export interface BlockFix {
  kind: "link" | "option" | "reupload";
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
    fix: { kind: "reupload", label: "Fix the file" },
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
      "These rows name an asset type this system has never seen, or one that belongs to a different " +
      "category than the one on the row. Same rule as categories: create it first, then re-upload.",
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
      "These rows name a vendor this system has never seen. Vendor is optional and purely informational " +
      "here, so you can import without it and set it later from the asset's edit form.",
    fix: { kind: "option", label: "Import without the vendor", option: "dropUnknownVendor" },
  },
  "bad-status": {
    label: "Status not recognised",
    explain:
      `These rows carry a status that is not one of this system's eight: ${ASSET_STATUSES.join(", ")}. ` +
      "Leave the column blank to get SPARE, or correct it to one of those.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "bad-date": {
    label: "Date not readable",
    explain:
      "A date cell on these rows is neither a real spreadsheet date, YYYY-MM-DD text, nor a real " +
      "calendar day (a shape like 2026-02-30 is not a date). Format the column as a date in the " +
      "spreadsheet and re-upload.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "bad-number": {
    label: "Amount not readable",
    explain:
      "A cost cell on these rows is not a plain non-negative amount of at most two decimal places, or " +
      "is too large. Remove currency symbols and thousands separators — the cell should hold a plain " +
      "amount no bigger than 10,000,000.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "bad-tag": {
    label: "Tag format not recognised",
    explain:
      "The Tag column on these rows isn't shaped like BR-XX-0000 — two letters and four digits after " +
      "the prefix. Every tag in this app follows that pattern, so a differently shaped value can be " +
      "neither matched to an existing asset nor safely created.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "missing-model": {
    label: "No model",
    explain:
      "The Model column is empty on these rows. Every asset needs a model name to be created or " +
      "updated, so the column being present in the sheet doesn't excuse a blank cell.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "duplicate-in-file": {
    label: "Duplicate within this file",
    explain:
      "This tag or serial already appears on an earlier row of the same file. Each identifies one " +
      "physical asset, so the file can't claim it twice — likely a copy-paste while editing an export.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "ambiguous-assignee": {
    label: "Assignee name matches more than one employee",
    explain:
      "Employee names aren't unique here, and this name matches more than one record. Add an Employee " +
      "no column (or fill it in) to say which one you mean, then re-upload.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "inactive-assignee": {
    label: "Assignee is not active",
    explain:
      "These rows name an employee whose employment here is no longer ACTIVE. Assignments are frozen " +
      "for anyone mid-offboarding or already gone, so this row can't hand equipment to them.",
    fix: { kind: "option", label: "Leave as spare", option: "dropUnknownAssignee" },
  },
  "deployed-without-holder": {
    label: "Deployed with no one holding it",
    explain:
      "These rows request a Deployed or Temporary status with no Assigned-to. Leave the Status column " +
      "blank to get SPARE, name who holds it, or import these rows as spare instead.",
    fix: { kind: "option", label: "Import as spare instead", option: "importUnheldAsSpare" },
  },
  "lifecycle-via-import": {
    label: "Status or assignee would move without an approval",
    explain:
      "These rows are updates whose Status or Assigned-to disagrees with the current record. Everywhere " +
      "else in this app those two fields move only through the approval queue, so an import can't move " +
      "them either — apply the row's other columns and leave the lifecycle alone, or use the approval flow.",
    fix: { kind: "option", label: "Keep the current status and assignee", option: "keepCurrentLifecycle" },
  },
  "value-out-of-range": {
    label: "Value out of range",
    explain:
      "A cell on these rows is outside the length this system allows for that column (Model needs 2–120 " +
      "characters, Serial at most 120, Notes at most 2,000). Shorten or lengthen it to fit, and re-upload.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "missing-category": {
    label: "No category",
    explain:
      "The Category column is empty on these rows. Every asset needs a category to be created or " +
      "updated, so the column being present in the sheet doesn't excuse a blank cell.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "type-outside-category": {
    label: "Type no longer matches the category",
    explain:
      "This row moves an existing asset to a new Category with no Type column to go with it. The " +
      "asset's current type belongs to its OLD category, so leaving it untouched here would strand a " +
      "type that no longer fits its category — the same thing this app's own edit form refuses to save. " +
      "Add a Type column naming a type that belongs to the new category, or add it blank to clear the " +
      "type, and re-upload.",
    fix: { kind: "reupload", label: "Fix the file" },
  },
  "duplicate-category-name": {
    label: "Category name collides case-insensitively",
    explain:
      "Two categories in this system share this name, differing only in letter case — the database " +
      "allows that today, but this import can't tell which one you mean. An admin needs to rename one " +
      "of them — to something differing by more than letter case, or the rename lands on this same " +
      "block — before rows naming this category can resolve.",
    fix: { kind: "link", label: "Rename a category", href: "/admin/asset-categories" },
  },
  "duplicate-type-name": {
    label: "Type name collides case-insensitively",
    explain:
      "Two types under this row's category share this name, differing only in letter case — the " +
      "database allows that today, but this import can't tell which one you mean. An admin needs to " +
      "rename one of them — to something differing by more than letter case, or the rename lands on " +
      "this same block — before rows naming this type can resolve.",
    fix: { kind: "link", label: "Rename a type", href: "/admin/asset-types" },
  },
  "duplicate-vendor-name": {
    label: "Vendor name collides case-insensitively",
    explain:
      "Two vendors in this system share this name, differing only in letter case, so this import can't " +
      "tell which one you mean. Vendor is optional and purely informational here — no page in this app " +
      "can rename or create one — so you can import without it and set it later from the asset's edit form.",
    fix: { kind: "option", label: "Import without the vendor", option: "dropUnknownVendor" },
  },
};

export function blockSpec(cause: BlockCause): BlockSpec {
  return SPECS[cause];
}

/**
 * Task 11 round two, V-6: a human label for an option already in force, so
 * the wizard can show which decisions are riding on the next write and offer
 * to remove one. Derived from `SPECS` rather than a second hand-typed map —
 * the same wording the fix button used to turn it on, so the two can never
 * drift apart. Falls back to the raw key only if a future option is ever
 * added with no cause routing a fix to it yet, which `import-vocabulary.test.ts`
 * guards against for every member of `IMPORT_OPTIONS`.
 */
export function optionLabel(option: ImportOption): string {
  for (const cause of BLOCK_CAUSES) {
    const fix = blockSpec(cause).fix;
    if (fix?.kind === "option" && fix.option === option) return fix.label;
  }
  return option;
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
