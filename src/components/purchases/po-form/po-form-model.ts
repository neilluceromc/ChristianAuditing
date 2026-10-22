import type { AssetClass } from "@prisma/client";
import { PO_DOCUMENT_SLOTS, type PoDocumentSlot } from "@/lib/documents";
import { checkTotals, itemsTotal, parseMoney, TOTAL_KEYS, type TotalKey } from "@/lib/po-totals";
import { UPLOAD_MAX_BYTES } from "@/lib/upload-meta";

/**
 * PO form redesign (A3, spec §2): the form's pure model. The form holds strings exactly as typed; this file turns them
 * into the rail's ticks, the "Before you save" checklist, the Save button's words, the totals status and the save
 * payload. Nothing here blocks a save — the server enforces the required fields (spec §5b.2).
 */

export type PaidByValue = "CREDIT_CARD" | "DEBIT_CARD";

/** One item card, as typed. `key` is the card's React key (stable while cards are added, duplicated and removed). */
export interface LineDraft {
  key: string;
  /** An existing line (an edit). */
  id?: string;
  description: string;
  specs: string;
  categoryId: string;
  qty: string;
  unit: string;
  unitPrice: string;
  /** Units already registered or closed short from this line: its category can't change and its qty can't drop below this. */
  locked?: number;
}

export interface PoDraft {
  vendorId: string;
  poNumber: string;
  invoiceRef: string;
  receiptRef: string;
  purchasedAt: string;
  paidBy: PaidByValue | "";
  departmentId: string;
  lines: LineDraft[];
  totals: Record<TotalKey, string>;
}

/** What the draft alone can't say: the chosen vendor's TIN, each category's class, whether a sales invoice is attached. */
export interface DraftContext {
  vendorTin: string | null;
  classes: Record<string, AssetClass>;
  invoiceAttached: boolean;
  /** An edit where IT has already registered a unit: the PO doesn't go back to IT (poStateFor). */
  itRegistered?: boolean;
  /**
   * A legacy PO (created before migration 39, spec §5b.3): its PO number, paid by, total amount due and sales invoice
   * are optional, so they never hold up the rail or the checklist (a blank one counts as done).
   */
  legacy?: boolean;
}

export const blankLine = (key: string): LineDraft => ({
  key, description: "", specs: "", categoryId: "", qty: "1", unit: "pc", unitPrice: "",
});

export const emptyTotals = (): Record<TotalKey, string> =>
  Object.fromEntries(TOTAL_KEYS.map((k) => [k, ""])) as Record<TotalKey, string>;

export type SectionKey = "vendor" | "invoice" | "items" | "docs" | "totals";

/** The "On this page" rail: each section's card carries the id its link points at. */
export const SECTIONS: ReadonlyArray<{ key: SectionKey; label: string; href: `#${string}` }> = [
  { key: "vendor", label: "Vendor", href: "#po-vendor" },
  { key: "invoice", label: "Invoice & payment", href: "#po-invoice" },
  { key: "items", label: "Items", href: "#po-items" },
  { key: "docs", label: "Documents", href: "#po-docs" },
  { key: "totals", label: "Totals", href: "#po-totals" },
];

const filled = (s: string) => s.trim() !== "";

/** A new card nobody has typed into (qty and unit keep their defaults): left out of the save and the checks. */
export const isBlankLine = (l: LineDraft) =>
  !l.id && !filled(l.description) && !filled(l.specs) && !l.categoryId && !filled(l.unitPrice);

export const usedLines = (d: PoDraft) => d.lines.filter((l) => !isBlankLine(l));

/** A whole quantity of 1 or more, or null. */
export function parseQty(s: string): number | null {
  const t = s.trim();
  return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) : null;
}

/** A price as typed ("9,100.00", "₱9,100"), or null when blank or unreadable. */
function parsePrice(s: string): number | null {
  const n = parseMoney(s);
  return n !== null && Number.isFinite(n) && n >= 0 ? n : null;
}

/** qty × unit price, or null until both are readable. */
export function lineAmount(l: LineDraft): number | null {
  const q = parseQty(l.qty);
  const p = parsePrice(l.unitPrice);
  return q === null || p === null ? null : Math.round(q * p * 100) / 100;
}

const hasCategory = (l: LineDraft, ctx: DraftContext) => !!l.categoryId && !!ctx.classes[l.categoryId];
const hasQtyAndPrice = (l: LineDraft) => parseQty(l.qty) !== null && parsePrice(l.unitPrice) !== null;

function itemFacts(d: PoDraft, ctx: DraftContext) {
  const lines = usedLines(d);
  const any = lines.length > 0;
  return {
    allCategories: any && lines.every((l) => hasCategory(l, ctx)),
    allQtyAndPrice: any && lines.every(hasQtyAndPrice),
    allDescribed: any && lines.every((l) => l.description.trim().length >= 2),
  };
}

/** "partial": something is typed and nothing is wrong yet, but it isn't complete (no total amount due) — neutral. */
export type TotalsStatus = "empty" | "ok" | "off" | "partial";

const STATUS_TEXT: Record<TotalsStatus, string> = {
  empty: "Type the total amount due from the invoice.",
  partial: "Type the total amount due from the invoice.",
  ok: "The figures add up, and the items match total sales.",
  off: "Some figures don't add up — check the highlighted lines against the invoice. You can still save if the invoice itself is off; Finance will see the note.",
};

/**
 * The typed totals against the items (spec §3): Σ qty × unit price, the four checks, and a figure that isn't an
 * amount. `problems` holds each amber line's words; `status` is the box under TOTAL AMOUNT DUE.
 */
export function totalsReview(d: PoDraft): {
  items: number; status: TotalsStatus; text: string; problems: Partial<Record<TotalKey, string>>;
} {
  const items = itemsTotal(usedLines(d).map((l) => ({ qty: parseQty(l.qty) ?? 0, unitPrice: parsePrice(l.unitPrice) ?? 0 })));
  const typed = Object.fromEntries(TOTAL_KEYS.map((k) => [k, parseMoney(d.totals[k])])) as Record<TotalKey, number | null>;
  const result = checkTotals(items, typed);
  const problems: Partial<Record<TotalKey, string>> = { ...result.problems };
  for (const k of TOTAL_KEYS) if (Number.isNaN(typed[k])) problems[k] = "Type an amount, like 9,100.00";
  // "empty" only while nothing is typed (task 6 review); "off" once a line has a problem; "partial" (neutral) while
  // what is typed is fine so far but not complete — so a legacy PO's partial totals don't count as done either.
  const blank = TOTAL_KEYS.every((k) => typed[k] === null);
  const status: TotalsStatus = blank ? "empty" : result.ok ? "ok" : Object.keys(problems).length > 0 ? "off" : "partial";
  return { items, status, text: STATUS_TEXT[status], problems };
}

/** The rail's ticks: each section is done when what it asks for is all there (guidance only). */
export function sectionsDone(d: PoDraft, ctx: DraftContext): Record<SectionKey, boolean> {
  const items = itemFacts(d, ctx);
  const legacy = !!ctx.legacy;
  return {
    vendor: !!d.vendorId && filled(ctx.vendorTin ?? ""),
    invoice: filled(d.invoiceRef) && !!d.purchasedAt && (legacy || (filled(d.poNumber) && !!d.paidBy)),
    items: items.allCategories && items.allQtyAndPrice && items.allDescribed,
    docs: legacy || ctx.invoiceAttached,
    totals: totalsDone(d, legacy),
  };
}

/** "Totals add up": on a legacy PO, blank totals are fine too (the total amount due is optional there). */
function totalsDone(d: PoDraft, legacy: boolean): boolean {
  const status = totalsReview(d).status;
  return status === "ok" || (legacy && status === "empty");
}

export interface ChecklistItem {
  label: string;
  done: boolean;
  /** Optional on this PO (a legacy one): shown as such, and done while blank. */
  optional?: boolean;
}

/** "Before you save" (spec §2.10), in order. Guidance only: the server enforces the required fields. */
export function checklist(d: PoDraft, ctx: DraftContext): ChecklistItem[] {
  const items = itemFacts(d, ctx);
  const legacy = !!ctx.legacy;
  const opt = legacy ? { optional: true } : {};
  return [
    { label: "Purchase order number", done: legacy || filled(d.poNumber), ...opt },
    { label: "Vendor with a TIN", done: !!d.vendorId && filled(ctx.vendorTin ?? "") },
    { label: "SI number and date", done: filled(d.invoiceRef) && !!d.purchasedAt },
    { label: "Every item has a category", done: items.allCategories },
    { label: "Every item has a quantity and price", done: items.allQtyAndPrice },
    { label: "Sales invoice attached", done: legacy || ctx.invoiceAttached, ...opt },
    { label: "Totals add up", done: totalsDone(d, legacy), ...opt },
  ];
}

/** Units still to go somewhere, by where they go: IT gear to IT, office items to register. A line with no category yet counts nowhere. */
export function unitCounts(d: PoDraft, ctx: DraftContext): { it: number; office: number } {
  const out = { it: 0, office: 0 };
  for (const l of usedLines(d)) {
    const cls = l.categoryId ? ctx.classes[l.categoryId] : undefined;
    if (!cls) continue;
    const left = Math.max(0, (parseQty(l.qty) ?? 0) - (l.locked ?? 0));
    if (cls === "IT") out.it += left;
    else out.office += left;
  }
  return out;
}

const units = (n: number) => `${n} ${n === 1 ? "unit" : "units"}`;

/** The Items card's header chips. */
export const unitChips = (c: { it: number; office: number }): [string, string] =>
  [`${units(c.it)} to IT`, `${units(c.office)} to register`];

/** "When you save": where the units go. */
export function whenYouSave(c: { it: number; office: number }): [string, string] {
  return [
    c.it > 0 ? `${units(c.it)} of IT gear ${c.it === 1 ? "goes" : "go"} to IT to check and register.` : "No IT gear on this order.",
    c.office > 0 ? `${units(c.office)} ${c.office === 1 ? "is" : "are"} ready for you to register.` : "Nothing for you to register yet.",
  ];
}

/** Spec §2.11: the order goes to IT when IT gear on it still has units to check (and IT hasn't started registering). */
export function saveLabel(d: PoDraft, ctx: DraftContext): string {
  return unitCounts(d, ctx).it > 0 && !ctx.itRegistered ? "Save and send to IT" : "Save and register";
}

export interface SaveLine {
  id?: string;
  description: string;
  specs: string;
  categoryId: string;
  qty: number | null;
  unit: string;
  unitPrice: number | null;
}

export interface SavePayload {
  id?: string;
  vendorId: string;
  poNumber: string;
  invoiceRef: string;
  receiptRef: string;
  purchasedAt: string;
  paidBy: PaidByValue | "";
  departmentId: string;
  lines: SaveLine[];
  totals: Record<TotalKey, string>;
  reply?: string;
}

/**
 * The save object (savePurchaseOrder's JSON payload). It always names the PO number, paid by, all seven totals ("" for
 * blank) and every line's unit: a field left out of an edit keeps its stored value, and partial totals null the rest.
 * Blank cards are left out; `cardOf[i]` is the card that payload line `i` came from, for the server's line errors.
 * An unreadable qty or price goes as null, so the server says what's missing on that line.
 */
export function toPayload(d: PoDraft, opts: { id?: string; reply?: string }): { payload: SavePayload; cardOf: number[] } {
  const cardOf: number[] = [];
  const lines: SaveLine[] = [];
  d.lines.forEach((l, i) => {
    if (isBlankLine(l)) return;
    cardOf.push(i);
    lines.push({
      ...(l.id ? { id: l.id } : {}),
      description: l.description.trim(),
      specs: l.specs.trim(),
      categoryId: l.categoryId,
      qty: parseQty(l.qty) ?? (filled(l.qty) && /^\d+$/.test(l.qty.trim()) ? Number(l.qty.trim()) : null),
      unit: l.unit.trim() || "pc",
      unitPrice: parsePrice(l.unitPrice),
    });
  });
  const payload: SavePayload = {
    ...(opts.id ? { id: opts.id } : {}),
    vendorId: d.vendorId,
    poNumber: d.poNumber,
    invoiceRef: d.invoiceRef,
    receiptRef: d.receiptRef,
    purchasedAt: d.purchasedAt,
    paidBy: d.paidBy,
    departmentId: d.departmentId,
    lines,
    totals: Object.fromEntries(TOTAL_KEYS.map((k) => [k, d.totals[k].trim()])) as Record<TotalKey, string>,
    ...(opts.reply && opts.reply.trim() ? { reply: opts.reply } : {}),
  };
  return { payload, cardOf };
}

/** The files held in the form's document slots until Save (spec §5b.1: nothing is stored before the PO is). */
export type HeldFiles = Partial<Record<PoDocumentSlot, File>>;

/** "Sales invoice attached": a file held in the invoice slot, or (an edit) one already on file. */
export const invoiceAttached = (files: HeldFiles, onFile: Partial<Record<PoDocumentSlot, unknown>>): boolean =>
  !!files.invoice || !!onFile.invoice;

/**
 * What the Save button sends (savePurchaseOrder takes FormData): the save object as the JSON field `payload`, and
 * each filled slot's file as `doc:<slot>`. An empty slot is left out.
 */
export function toFormData(payload: SavePayload, files: HeldFiles): FormData {
  const fd = new FormData();
  fd.set("payload", JSON.stringify(payload));
  for (const slot of PO_DOCUMENT_SLOTS) {
    const file = files[slot];
    if (file) fd.set(`doc:${slot}`, file, file.name);
  }
  return fd;
}

/** A file's size as the slots show it: "120 KB", "0.8 MB" (decimal, like the 4 MB cap). */
export function fileSize(bytes: number): string {
  if (bytes < 500_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * One save carries the PO and its files in one request, which can't be bigger than the server's body limit (4 MB,
 * next.config.ts). Each file is already capped at 4 MB; this catches several that together are too big, before the
 * request fails without a word.
 */
export function filesTooBig(files: HeldFiles): string | null {
  const total = PO_DOCUMENT_SLOTS.reduce((sum, s) => sum + (files[s]?.size ?? 0), 0);
  if (total <= UPLOAD_MAX_BYTES) return null;
  return `Together the files come to ${fileSize(total)}, and one save carries 4 MB. Save with the sales invoice, then add the others on the purchase order's page.`;
}

/** The server's `lines.<i>.<field>` errors, keyed by card index then field. */
export function lineErrors(fieldErrors: Record<string, string>, cardOf: number[]): Record<number, Record<string, string>> {
  const out: Record<number, Record<string, string>> = {};
  for (const [key, message] of Object.entries(fieldErrors)) {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(key);
    if (!m) continue;
    const card = cardOf[Number(m[1])];
    if (card === undefined) continue;
    (out[card] ??= {})[m[2]] ??= message;
  }
  return out;
}

/** A badge's two letters: the first two words' initials, or a one-word name's first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The header fields in the order the form shows them (a failed save focuses the first one with an error). */
const HEADER_ORDER = ["vendorId", "poNumber", "invoiceRef", "purchasedAt", "receiptRef", "paidBy", "departmentId"] as const;
const LINE_FIELD_ORDER = ["description", "categoryId", "qty", "unit", "unitPrice"] as const;

/**
 * After a failed save: the first field with an error, in the order the form shows them — the header, then the items
 * card by card (description, category, qty, unit, price), then the document slots, then the totals, then the reply.
 * The value is the field's `data-po-field` mark: a header key, "lines", `line:<card>:<field>`, `doc:<slot>`, "docs"
 * (the files together too big), `totals.<key>` or "reply". Null when no error is on a field the form shows (a
 * conflict, a garbled form): the banner takes focus instead.
 */
export function firstErrorTarget(fieldErrors: Record<string, string>, cardOf: number[]): string | null {
  for (const k of HEADER_ORDER) if (fieldErrors[k]) return k;
  if (fieldErrors.lines) return "lines";
  const byCard = lineErrors(fieldErrors, cardOf);
  const cards = Object.keys(byCard).map(Number).sort((a, b) => a - b);
  for (const card of cards) {
    for (const f of LINE_FIELD_ORDER) if (byCard[card][f]) return `line:${card}:${f}`;
  }
  for (const s of PO_DOCUMENT_SLOTS) if (fieldErrors[`doc:${s}`]) return `doc:${s}`;
  if (fieldErrors.docs) return "docs";
  for (const k of TOTAL_KEYS) if (fieldErrors[`totals.${k}`]) return `totals.${k}`;
  if (fieldErrors.reply) return "reply";
  return null;
}
