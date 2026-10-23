"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type AssetClass, type PaidBy, type Role, type Team } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { notify } from "@/server/notifications/notify";
import { lockPo } from "./po-lock";
import { diffOf, type AuditDiff } from "@/lib/audit-diff";
import { cleanReason } from "@/lib/reason";
import { GROUP_ARCHIVED } from "@/lib/groups";
import {
  canEditField, MONEY_FIELDS, PO_TOTALS_KEY, poMoneyStage, reasonError, teamOfRole, type IntakeStage,
} from "@/lib/intake-rules";
import { lineProgress, PO_WRITE_ROLES, poRefNo, poStateFor, stateAfterSave, type PoState } from "@/lib/po-flow";
import { parseMoney, TOTAL_KEYS, totalsConsistency, type TotalKey } from "@/lib/po-totals";
import { unitSchema } from "@/lib/po-units";
import { PO_DOCUMENT_SLOTS, type PoDocumentSlot } from "@/lib/documents";
import { uniqueTarget } from "@/server/prisma-errors";
import { validateUpload } from "@/server/uploads";
import { storePoFiles, type PoFile, type StoredFile } from "./po-files";
import { moneyForAsset } from "@/lib/po-money";
import { fieldLabels, shouldReopen } from "@/lib/registration";
import { returnOne, undoOne } from "@/server/modules/finance/review-writes";
import { FINANCE_WORDS } from "@/server/modules/finance/review-notify";
import { emitIfPoFullyApproved } from "./po-complete";
import { readPoSendBackUndo } from "./po-undo";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/*
 * Purchase orders (spec §2–§7): save (which is also the send to IT — there are no drafts), send back, the PO-level
 * money fix, close a line short, cancel, and the thread's comment. Every action that reads a PO's registered or
 * approved counts first takes `SELECT … FOR UPDATE` on the PO row, so a registration landing at the same moment
 * (Task 5 locks the same row) waits rather than slipping in between the check and the write. Each action decides
 * everything before its first write: a refusal leaves nothing behind. Notifications are written in the same
 * transaction (notify). Audit: entityType "purchase-order", source "web".
 */

// ---- shared ------------------------------------------------------------------------------------------------------

/**
 * Prisma throws rather than returning, and an interactive transaction that can't get a connection inside `maxWait`
 * raises P2028 — under contention that is "someone else is working on this", not a 500. Everything else rethrows.
 */
async function asActionResult<T>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof StaleAssetError) {
      return conflict(`${err.tag} changed just now — nothing was written. Reload and try again.`);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }
}

function revalidatePo(id: string, assetsToo = false) {
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  revalidatePath(`/purchases/${id}/edit`);
  revalidatePath("/purchases/activity");
  revalidatePath("/audit");
  if (assetsToo) {
    revalidatePath("/inventory");
    revalidatePath("/finance/assets");
  }
}

const ENTITY = "purchase-order";
const poHref = (id: string) => `/purchases/${id}`;
const TEAM_NAME: Record<Team, string> = { IT: "IT", PURCHASING: "Purchasing", FINANCE: "Finance" };

/** Words for the fields a send-back or a fix names (notification titles and thread notes). */
const FIELD_WORDS: Record<string, string> = {
  cost: "unit price", fees: "fees", purchasedAt: "invoice date", vendorId: "vendor",
  invoiceRef: "SI number", receiptRef: "OR number",
  "doc:invoice": "sales invoice", "doc:official-receipt": "official receipt", "doc:delivery-receipt": "delivery receipt",
  other: "something else",
  // Migration 39 (spec §5b.4): the PO's own money fields, and the send-back's one key for the seven totals
  poNumber: "PO number", paidBy: "paid by", [PO_TOTALS_KEY]: "invoice totals",
  totalSales: "total sales", lessVat: "less VAT", netOfVat: "amount net of VAT", discount: "discount",
  amountDue: "amount due", addVat: "add VAT", totalAmountDue: "total amount due",
};

/** "a", "a and b", "a, b and c". */
function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const fieldPhrase = (keys: readonly string[]) => listWords(keys.map((k) => FIELD_WORDS[k] ?? k));
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Prices are Decimal(12,2): .multipleOf(0.01) keeps a third decimal from being silently rounded by Postgres. */
const price = z
  .number({ error: "Enter the unit price" })
  .min(0, "A price can't be negative")
  .max(99_999_999.99)
  .multipleOf(0.01, "Prices go to centavos — two decimal places at most");
const dateStr = z.string({ error: "Enter the date" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const optionalReason = z.string().overwrite(cleanReason).optional();

// ---- migration 39: PO number, paid by, the typed totals (PO form redesign, spec §2.5, §2.9, §4, §5b) ----------------

const PAID_BY = ["CREDIT_CARD", "DEBIT_CARD"] as const satisfies readonly PaidBy[];
const PO_NUMBER_MAX = 40;
/** What a PO from the new form can't be saved without (spec §5b.2); the server's own words for each. */
const NEEDED = {
  poNumber: "Enter the purchase order number",
  paidBy: "Pick how it was paid",
  totalAmountDue: "Enter the total amount due",
  invoice: "Attach the sales invoice",
} as const;
const TOTALS_SELECT = {
  totalSales: true, lessVat: true, netOfVat: true, discount: true, amountDue: true, addVat: true, totalAmountDue: true,
} as const satisfies Record<TotalKey, true>;

/**
 * The save's optional fields, three ways: left out (`undefined`) an edit leaves the field as it is; blank or null
 * clears it; anything else is checked. So a legacy PO saved without them keeps its nulls (spec §5b.3).
 */
const poNumberField = z
  .string()
  .trim()
  .max(PO_NUMBER_MAX, `Keep the PO number to ${PO_NUMBER_MAX} characters or fewer`)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? v : null));
const paidByField = z
  .string()
  .nullable()
  .optional()
  .transform((v, ctx): PaidBy | null | undefined => {
    if (v === undefined) return undefined;
    if (!v) return null;
    if (!(PAID_BY as readonly string[]).includes(v)) {
      ctx.addIssue({ code: "custom", message: "Pick credit card or debit card" });
      return z.NEVER;
    }
    return v as PaidBy;
  });
/** A total as typed ("9,100.00", "₱9,100", or a number): parseMoney, then the column's limits (Decimal(12,2), >= 0). */
const moneyText = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v, ctx): number | null | undefined => {
    if (v === undefined) return undefined;
    const n = parseMoney(v);
    if (n === null) return null;
    const refuse = (message: string) => {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    };
    if (!Number.isFinite(n)) return refuse("Type an amount, like 9,100.00");
    if (n < 0) return refuse("An amount can't be negative");
    if (n > 99_999_999.99) return refuse("That's more than ₱99,999,999.99");
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return refuse("Amounts go to centavos — two decimal places at most");
    return n;
  });
const totalsSchema = z.object({
  totalSales: moneyText, lessVat: moneyText, netOfVat: moneyText, discount: moneyText,
  amountDue: moneyText, addVat: moneyText, totalAmountDue: moneyText,
}).strict();

/** All seven totals, a key left out as null. */
const totalsOf = (t: Partial<Record<TotalKey, number | null | undefined>>): Record<TotalKey, number | null> =>
  Object.fromEntries(TOTAL_KEYS.map((k) => [k, t[k] ?? null])) as Record<TotalKey, number | null>;
/** A PO row's totals (Decimals) as numbers. */
const rowTotals = (row: Partial<Record<TotalKey, unknown>>): Record<TotalKey, number | null> =>
  Object.fromEntries(TOTAL_KEYS.map((k) => [k, row[k] === null || row[k] === undefined ? null : Number(row[k])])) as Record<TotalKey, number | null>;

/**
 * Which live PO already has this number: the partial unique index's own test (migration 39,
 * "PurchaseRequest_poNumber_live_key" ON lower(btrim("poNumber")) WHERE not CANCELLED), leaving out `exceptId`.
 */
async function poNumberOwner(poNumber: string, exceptId: string | null): Promise<{ id: string; refNo: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; refNo: string }>>`
    SELECT "id", "refNo" FROM "PurchaseRequest"
    WHERE lower(btrim("poNumber")) = lower(btrim(${poNumber})) AND "poNumber" IS NOT NULL AND "state" <> 'CANCELLED'
      AND "id" <> ${exceptId ?? ""}
    LIMIT 1`;
  return rows[0] ?? null;
}
const usedOn = (poNumber: string, refNo: string | null) =>
  `PO ${poNumber} is already used on ${refNo ?? "another purchase order"}`;
/** The partial unique index refused a PO number: another save took it after the pre-check. */
const isPoNumberClash = (err: unknown) => uniqueTarget(err).some((t) => t.includes("poNumber"));
/** A PO line's category that no longer exists (IT replaced a new one at Register, and nothing else used it). */
const CATEGORY_GONE = "That category no longer exists — pick another";
/** The line's category foreign key refused the write: the category went after the pre-check. */
const isCategoryGone = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003"
  && String((err.meta as { field_name?: unknown } | undefined)?.field_name ?? "").includes("categoryId");
async function poNumberRefusal(poNumber: string, exceptId: string | null): Promise<string> {
  return usedOn(poNumber, (await poNumberOwner(poNumber, exceptId))?.refNo ?? null);
}

/** What an asset from a PO carries of its money (moneyForAsset's fields), plus its review state. */
const ASSET_SELECT = {
  id: true, tag: true, cls: true, purchaseOrderLineId: true, purchaseRecordId: true,
  financeConfirmedAt: true, financeReturnedAt: true, financeReturnedTo: true,
  cost: true, vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true,
} as const;

function counts(assets: Array<{ financeConfirmedAt: Date | null }>) {
  return { registeredCount: assets.length, approvedCount: assets.filter((a) => a.financeConfirmedAt !== null).length };
}

/** A state-guarded asset write found the asset changed under it: thrown so the whole transaction rolls back. */
class StaleAssetError extends Error {
  constructor(readonly tag: string) {
    super(`stale asset ${tag}`);
  }
}

type PoAsset = {
  id: string; tag: string; cls: AssetClass; purchaseOrderLineId: string | null; purchaseRecordId: string | null;
  financeConfirmedAt: Date | null; financeReturnedAt: Date | null; financeReturnedTo: Team | null;
  cost: unknown; vendorId: string | null; invoiceRef: string | null; receiptRef: string | null; purchasedAt: Date | null;
};
type PoFacts = Partial<{ vendorId: string | null; invoiceRef: string | null; receiptRef: string | null; purchasedAt: Date | null }>;
type Copied = { id: string; diff: AuditDiff; reopened: boolean; extra: boolean };
const isWhole = (f: PoFacts): f is Required<PoFacts> =>
  f.vendorId !== undefined && f.invoiceRef !== undefined && f.receiptRef !== undefined && f.purchasedAt !== undefined;

/**
 * The one place a PO's money reaches its assets and its registrations (spec §5: money lives on the PO and is copied
 * at Register and on every later fix) — Purchasing's resubmit and the PO-level fix both come through here.
 *
 * - **Assets:** each gets `facts` and, as its cost, its line's price from `linePrice` — moneyForAsset's copy, limited
 *   to what the caller passes. `approved: "skip"` leaves approved assets alone (a save never reaches them);
 *   `"include"` writes them without touching their approval, except that a cost given to an approved asset that had
 *   none reopens it (spec §5 keeps that path for not-capitalised assets; `shouldReopen`, the rule updateAsset uses).
 *   `extra(a)` adds per-asset fields (the resubmit's un-return), writing the asset even when its money is unchanged.
 *   Every write is state-guarded; a miss throws StaleAssetError, rolling the transaction back.
 * - **PurchaseRecords** of the PO: the four facts, and `unitCost` when all of a record's assets come from one line.
 *
 * Returns each asset written, with its money diff, so the caller writes its own audit.
 */
async function copyPoMoney(
  tx: Prisma.TransactionClient,
  args: {
    poId: string;
    assets: PoAsset[];
    facts: PoFacts;
    linePrice: Map<string, number>;
    approved: "skip" | "include";
    extra?: (a: PoAsset) => Record<string, unknown> | null;
  },
): Promise<Copied[]> {
  const { assets, facts, linePrice } = args;
  const priceOf = (a: PoAsset) => (a.purchaseOrderLineId ? linePrice.get(a.purchaseOrderLineId) : undefined);
  const out: Copied[] = [];

  for (const a of assets) {
    if (a.financeConfirmedAt && args.approved === "skip") continue;
    const price = priceOf(a);
    // A save passes every fact (moneyForAsset's copy whole); a fix passes only what it changed.
    const target: Record<string, unknown> = isWhole(facts) && price !== undefined
      ? moneyForAsset(facts, { unitPrice: price })
      : { ...facts, ...(price !== undefined ? { cost: price } : {}) };
    const diff = diffOf(a, target);
    const extra = args.extra?.(a) ?? null;
    if (Object.keys(diff).length === 0 && !extra) continue;
    const reopened = "cost" in diff && shouldReopen(a, target.cost);
    const data: Record<string, unknown> = {
      ...Object.fromEntries(Object.keys(diff).map((k) => [k, target[k]])),
      ...extra,
      ...(reopened ? { financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false } : {}),
    };
    const where = reopened
      ? { id: a.id, financeConfirmedAt: { not: null }, cost: null }
      : a.financeConfirmedAt
        ? { id: a.id, financeConfirmedAt: { not: null } }
        : { id: a.id, financeConfirmedAt: null };
    const hit = await tx.asset.updateMany({ where, data });
    if (hit.count === 0) throw new StaleAssetError(a.tag);
    out.push({ id: a.id, diff, reopened, extra: extra !== null });
  }

  const records = await tx.purchaseRecord.findMany({
    where: { purchaseOrderId: args.poId },
    select: { id: true, vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true, unitCost: true },
  });
  for (const r of records) {
    const lines = [...new Set(assets.filter((a) => a.purchaseRecordId === r.id).map((a) => a.purchaseOrderLineId))];
    const unitCost = lines.length === 1 && lines[0] ? linePrice.get(lines[0]) : undefined;
    const target: Record<string, unknown> = { ...facts, ...(unitCost !== undefined ? { unitCost } : {}) };
    const diff = diffOf(r, target);
    if (Object.keys(diff).length === 0) continue;
    await tx.purchaseRecord.update({
      where: { id: r.id },
      data: Object.fromEntries(Object.keys(diff).map((k) => [k, target[k]])),
    });
  }
  return out;
}

// ---- save ----------------------------------------------------------------------------------------------------------

const lineSchema = z.object({
  id: z.string().min(1).optional(), // present = an existing line
  description: z.string().trim().min(2, "Say what this is").max(200),
  specs: z.string().trim().max(500).optional(),
  categoryId: z.string({ error: "Pick a category" }).min(1, "Pick a category"),
  qty: z.number({ error: "Enter a quantity" }).int().min(1, "At least one").max(999),
  unit: unitSchema,
  unitPrice: price,
});

/**
 * The save object (the JSON `payload` of the form's FormData, or a plain object). `fees` is no longer taken: the new
 * form has no fees field (spec §4), so an edit leaves a legacy PO's fees as they are.
 */
const saveSchema = z.object({
  id: z.string().min(1).optional(),
  vendorId: z.string({ error: "Pick the vendor" }).min(1, "Pick the vendor"),
  poNumber: poNumberField,
  invoiceRef: z.string({ error: "Enter the SI number" }).trim().min(1, "Enter the SI number").max(60),
  receiptRef: z.string().trim().max(60).optional(),
  purchasedAt: dateStr,
  paidBy: paidByField,
  departmentId: z.string().optional(),
  lines: z.array(lineSchema, { error: "A purchase order needs at least one line" })
    .min(1, "A purchase order needs at least one line").max(50),
  totals: totalsSchema.optional(),
  reply: optionalReason,
});

type SaveInput = z.infer<typeof saveSchema>;
type Saved = { id: string; refNo: string; state: PoState };

/** "5 laptops" for one IT line, "7 IT items" for several — the IT bell's batch title (spec §7: one notification). */
function itSummary(lines: Array<{ description: string; qty: number }>, cls: Array<AssetClass | null>): string {
  const it = lines.filter((_, i) => cls[i] !== "PURCHASING");
  if (it.length === 1) return `${it[0].qty} ${it[0].description}`;
  return `${it.reduce((s, l) => s + l.qty, 0)} IT items`;
}

const summarize = (lines: Array<{ qty: number; unitPrice: unknown }>) => ({
  units: lines.length,
  total: lines.reduce((sum, l) => sum + l.qty * Number(l.unitPrice ?? 0), 0),
});

/**
 * Purchasing saves a PO. There are no drafts: saving sends it (spec §4 way 1). Only an explicit Save calls this —
 * never an autosave, which would push half-typed orders into IT's queue.
 *
 * - **New:** the state is `stateAfterSave` over the lines' classes (from each line's category). WITH_IT rings IT.
 * - **Editing:** only while the PO's money is with Purchasing or IT (`poMoneyStage`). A line that already has assets
 *   registered from it stays: it can't be removed or re-categorised, and its quantity can't drop below what is
 *   registered or closed short (IT's serials sit on those units).
 * - **SENT_BACK:** Purchasing's reply is required (5–300 characters). The send-back is cleared and the sender's bell
 *   rings. Where the PO goes is `poStateFor` over the saved lines, as for any edit: back to IT while an IT line has
 *   units left and no IT unit is registered (IT's bell rings too when Finance sent it back), otherwise ready to
 *   register — so a mixed PO Finance sent back keeps its unregistered laptops in IT's queue. Finance's returned assets are
 *   un-returned. Every asset from the PO is re-copied with the saved money (`moneyForAsset`), so a PO's assets
 *   always share one SI number, supplier and date.
 */
export async function savePurchaseOrder(input: FormData | unknown): Promise<ActionResult<Saved>> {
  return asActionResult(() => saveImpl(input));
}

const FORM_GARBLED = "The form didn't arrive whole — reload the page and try again.";

/**
 * The new form sends FormData: a JSON `payload` (the save object) and the files `doc:<slot>` (PO_DOCUMENT_SLOTS).
 * Anything else is a plain save object with no files (the old form, and tests). An empty slot is no file: the
 * field left out, sent as "", or an empty file input (a zero-size File with no name).
 */
function unpackSave(input: unknown): { payload: unknown; files: Partial<Record<PoDocumentSlot, FormDataEntryValue>> } | null {
  if (!(input instanceof FormData)) return { payload: input, files: {} };
  const raw = input.get("payload");
  if (typeof raw !== "string") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const files: Partial<Record<PoDocumentSlot, FormDataEntryValue>> = {};
  for (const slot of PO_DOCUMENT_SLOTS) {
    const value = input.get(`doc:${slot}`);
    if (value === null || value === "" || (value instanceof File && value.size === 0 && value.name === "")) continue;
    files[slot] = value;
  }
  return { payload, files };
}

/**
 * Spec §5b.2: on a PO from the new form, what is blank of the fields the save object may leave out. Read off the raw
 * payload, so a save missing everything hears about everything at once (alongside the schema's own errors).
 */
function missingOnV2(raw: unknown): Record<string, string> {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const totals = (p.totals && typeof p.totals === "object" ? p.totals : {}) as Record<string, unknown>;
  const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  const tad = totals.totalAmountDue;
  const out: Record<string, string> = {};
  if (blank(p.poNumber)) out.poNumber = NEEDED.poNumber;
  if (blank(p.paidBy)) out.paidBy = NEEDED.paidBy;
  if (blank(tad) || ((typeof tad === "string" || typeof tad === "number") && parseMoney(tad) === null)) {
    out["totals.totalAmountDue"] = NEEDED.totalAmountDue;
  }
  return out;
}

/**
 * Every refusal comes before the files are stored, except the ones only the PO row (read under its lock) can decide.
 * Then: the files go to storage (po-files.ts), the PO and its document rows are written in one transaction, and if
 * that refuses or throws, `cleanup()` removes the stored files — no PO, no document row, no orphan file
 * (Review Focus 2). A PO number taken in between (the partial unique index's P2002) is refused on its field.
 */
async function saveImpl(input: unknown): Promise<ActionResult<Saved>> {
  const unpacked = unpackSave(input);
  if (!unpacked) return validationError({ payload: FORM_GARBLED });

  const user = await actionRole(...PO_WRITE_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const raw = unpacked.payload;
  const rawId = raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : "";
  // A PO from the new form keeps its required fields on every edit; a legacy one doesn't (spec §5b.3). formV2 never
  // changes after the create, so reading it before the lock is safe.
  const existing = rawId
    ? await prisma.purchaseOrder.findUnique({ where: { id: rawId }, select: { formV2: true } })
    : null;
  const v2 = rawId ? existing?.formV2 === true : true;

  const errors: Record<string, string> = {};
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) Object.assign(errors, zodFieldErrors(parsed.error));
  const files: PoFile[] = [];
  for (const kind of PO_DOCUMENT_SLOTS) {
    const value = unpacked.files[kind];
    if (value === undefined) continue;
    const checked = validateUpload(value);
    if (checked.ok) files.push({ kind, file: checked.file });
    else errors[`doc:${kind}`] = checked.error;
  }
  if (v2) {
    for (const [k, message] of Object.entries(missingOnV2(raw))) errors[k] ??= message;
    if (!errors["doc:invoice"] && !files.some((f) => f.kind === "invoice")) {
      const onFile = rawId
        ? await prisma.requestDocument.count({ where: { orderId: rawId, kind: "invoice", supersededAt: null } })
        : 0;
      if (onFile === 0) errors["doc:invoice"] = NEEDED.invoice;
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return validationError(errors);
  const d = parsed.data;

  const vendor = await prisma.vendor.findUnique({ where: { id: d.vendorId }, select: { id: true, archivedAt: true } });
  if (!vendor) return validationError({ vendorId: "Unknown vendor" });
  const departmentId = d.departmentId ? d.departmentId : null;
  const dept = departmentId
    ? await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, archivedAt: true } })
    : null;
  if (departmentId && !dept) return validationError({ departmentId: "Unknown department" });

  const catIds = [...new Set(d.lines.map((l) => l.categoryId))];
  const cats = await prisma.assetCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, cls: true } });
  const clsOf = new Map(cats.map((c) => [c.id, c.cls]));
  if (cats.length !== catIds.length) {
    // A form held open while IT replaced (and deleted) the line's new category at Register: say so on that line.
    return validationError(Object.fromEntries(d.lines.flatMap((l, i) =>
      clsOf.has(l.categoryId) ? [] : [[`lines.${i}.categoryId`, CATEGORY_GONE]])));
  }
  const lineCls = d.lines.map((l) => clsOf.get(l.categoryId) ?? null);

  const archived = { vendor: vendor.archivedAt !== null, dept: dept?.archivedAt != null };
  if (!d.id) {
    // Phase 37 (spec §2.1): a new order never names an archived department or supplier.
    if (archived.vendor) return validationError({ vendorId: "That vendor is archived" });
    if (archived.dept) return validationError({ departmentId: GROUP_ARCHIVED });
  }
  if (d.poNumber) {
    const owner = await poNumberOwner(d.poNumber, d.id ?? null);
    if (owner) return validationError({ poNumber: usedOn(d.poNumber, owner.refNo) });
  }

  // final review M3: a new PO's id is minted now, so its files are stored under requests/<poId>/ like every other PO
  // document, and the create writes the PO with that id. A plain UUID (re-review): nothing checks an id's shape.
  const poId = d.id ?? randomUUID();
  let store: Awaited<ReturnType<typeof storePoFiles>>;
  try {
    store = await storePoFiles(poId, files);
  } catch {
    return conflict("Could not store the documents — nothing was saved. Try again.");
  }
  // Set once the transaction has committed: from then on the document rows point at the stored files, so nothing
  // after it (revalidation, say) may clean them up.
  const commit = { done: false };
  try {
    const result = d.id
      ? await editPo(d.id, d, user, lineCls, archived, store.stored, commit)
      : await createPo(poId, d, user, lineCls, store.stored, commit);
    // A refusal (decided under the lock, before any write) committed nothing that points at the files.
    if (!result.ok) await store.cleanup();
    return result;
  } catch (err) {
    if (!commit.done) await store.cleanup();
    if (!commit.done && d.poNumber && isPoNumberClash(err)) {
      return validationError({ poNumber: await poNumberRefusal(d.poNumber, d.id ?? null) });
    }
    // The category was deleted between the check above and the line write (the transaction rolled back): say so on
    // each line whose category is gone, as the pre-check does (final review M4); on the items only if none is.
    if (!commit.done && isCategoryGone(err)) {
      const still = await prisma.assetCategory.findMany({ where: { id: { in: catIds } }, select: { id: true } });
      const left = new Set(still.map((c) => c.id));
      const gone = Object.fromEntries(d.lines.flatMap((l, i) =>
        left.has(l.categoryId) ? [] : [[`lines.${i}.categoryId`, CATEGORY_GONE]]));
      return validationError(Object.keys(gone).length > 0 ? gone : { lines: CATEGORY_GONE });
    }
    throw err;
  }
}

type Actor = { id: string; name: string; role: Role };

/** The header fields every save writes (fees are no longer among them: spec §4). */
function header(d: SaveInput) {
  return {
    vendorId: d.vendorId,
    invoiceRef: d.invoiceRef,
    receiptRef: d.receiptRef ? d.receiptRef : null,
    purchasedAt: toDate(d.purchasedAt),
    departmentId: d.departmentId ? d.departmentId : null,
  };
}

/** The document rows of the files a save stored, each with its own `document.uploaded` entry. */
async function writeStoredDocs(tx: Prisma.TransactionClient, orderId: string, stored: readonly StoredFile[], user: Actor) {
  for (const s of stored) {
    const doc = await tx.requestDocument.create({
      data: { orderId, kind: s.kind, fileName: s.fileName, path: s.relPath, checksum: s.checksum, uploadedById: user.id },
      select: { fileName: true },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: orderId, action: "document.uploaded",
      diff: { document: { from: null, to: doc.fileName } }, source: "web",
    });
  }
}

/** Every new PO is from the new form (formV2): saveImpl has refused it unless its required fields are all there. */
async function createPo(
  id: string, d: SaveInput, user: Actor, lineCls: Array<AssetClass | null>, stored: readonly StoredFile[], commit: { done: boolean },
): Promise<ActionResult<Saved>> {
  const state = stateAfterSave(lineCls.map((cls) => ({ cls })));
  const totals = totalsOf(d.totals ?? {});
  const head = {
    ...header(d), poNumber: d.poNumber ?? null, paidBy: d.paidBy ?? null, ...totals,
    totalsConsistent: totalsConsistency(d.lines, totals),
  };

  const saved = await prisma.$transaction(async (tx) => {
    const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('purchase_request_ref_seq')`;
    const refNo = poRefNo(Number(nextval));
    const created = await tx.purchaseOrder.create({
      data: {
        id, refNo, state, requestedById: user.id, formV2: true, ...head,
        lines: {
          create: d.lines.map((l) => ({
            description: l.description, specs: l.specs ? l.specs : null, categoryId: l.categoryId, qty: l.qty, unit: l.unit,
            unitPrice: l.unitPrice,
          })),
        },
      },
      select: { id: true },
    });
    await writeStoredDocs(tx, created.id, stored, user);
    await tx.noteEntry.create({
      data: {
        orderId: created.id, authorId: user.id, kind: "PO_SAVED",
        text: state === "WITH_IT" ? "Saved and sent to IT to check." : "Saved. Ready to register.",
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: created.id, action: "po.save",
      diff: { state: { from: null, to: state }, ...diffOf({}, head), ...diffOf({}, summarize(d.lines)) },
      source: "web",
    });
    if (state === "WITH_IT") {
      await notify(tx, {
        team: "IT", kind: "TO_CHECK", title: `${refNo} · ${itSummary(d.lines, lineCls)} from Purchasing to check`,
        href: poHref(created.id), actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: created.id,
      });
    }
    return { id: created.id, refNo, state };
  });
  commit.done = true;

  revalidatePo(saved.id);
  return ok(saved);
}

async function editPo(
  id: string, d: SaveInput, user: Actor, lineCls: Array<AssetClass | null>, archived: { vendor: boolean; dept: boolean },
  stored: readonly StoredFile[], commit: { done: boolean },
): Promise<ActionResult<Saved>> {
  // The new fields only when the save names them: left out, an edit keeps what the PO has (spec §5b.3).
  const head: ReturnType<typeof header> & Partial<{ poNumber: string | null; paidBy: PaidBy | null; totalsConsistent: boolean | null }>
    & Partial<Record<TotalKey, number | null>> = {
      ...header(d),
      ...(d.poNumber !== undefined ? { poNumber: d.poNumber } : {}),
      ...(d.paidBy !== undefined ? { paidBy: d.paidBy } : {}),
      ...(d.totals ? totalsOf(d.totals) : {}),
    };
  let out: Saved | null = null;
  let failure: ActionResult<Saved> | null = null;
  let touchedAssets = false;

  await prisma.$transaction(async (tx) => {
    await lockPo(tx, id);
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true, refNo: true, state: true, sentBackBy: true,
        vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true, fees: true, departmentId: true,
        poNumber: true, paidBy: true, totalsConsistent: true, ...TOTALS_SELECT,
      },
    });
    if (!po) { failure = conflict("That purchase order no longer exists."); return; }
    if (po.state === "CANCELLED") { failure = conflict(`${po.refNo} is cancelled.`); return; }
    const lines = await tx.purchaseOrderLine.findMany({
      where: { orderId: id },
      select: { id: true, description: true, specs: true, categoryId: true, qty: true, unit: true, unitPrice: true, closedShort: true },
    });
    const assets = await tx.asset.findMany({ where: { purchaseOrderId: id }, select: ASSET_SELECT });

    const stage: IntakeStage = poMoneyStage({ state: po.state, ...counts(assets) });
    if (stage !== "with-purchasing" && stage !== "with-it") {
      // Purchasing's view of why: "It's with Finance; …" / "Approved: only Finance can change it".
      const why = canEditField("purchasing_staff", "invoiceRef", "PURCHASING", stage);
      failure = conflict(why.ok ? `${po.refNo} can't be edited now.` : why.why);
      return;
    }
    const verdict = canEditField(user.role, "invoiceRef", "PURCHASING", stage);
    if (!verdict.ok) { failure = conflict(verdict.why); return; }

    // A legacy draft (DRAFT → SENT_BACK, never sent) has no sender: its first save is a plain save.
    const resubmitTo: Team | null = po.state === "SENT_BACK" ? po.sentBackBy : null;
    const reply = d.reply ? d.reply : null;
    if (resubmitTo || verdict.reasonRequired) {
      const err = reasonError(d.reply);
      if (err) { failure = validationError({ reply: err }); return; }
    }
    // An edit keeps the current archived supplier or department, and refuses any other archived one.
    if (archived.vendor && po.vendorId !== head.vendorId) { failure = validationError({ vendorId: "That vendor is archived" }); return; }
    if (archived.dept && po.departmentId !== head.departmentId) { failure = validationError({ departmentId: GROUP_ARCHIVED }); return; }

    // The lines: known ids only; a line with assets registered from it stays as IT registered it.
    const known = new Map(lines.map((l) => [l.id, l]));
    const registeredOn = new Map<string, number>();
    for (const a of assets) {
      if (a.purchaseOrderLineId) registeredOn.set(a.purchaseOrderLineId, (registeredOn.get(a.purchaseOrderLineId) ?? 0) + 1);
    }
    if (d.lines.some((l) => l.id && !known.has(l.id))) {
      failure = conflict("This purchase order changed elsewhere — reload and try again.");
      return;
    }
    const keep = new Set(d.lines.map((l) => l.id).filter((x): x is string => !!x));
    const drop = lines.filter((l) => !keep.has(l.id));
    const stuck = drop.find((l) => (registeredOn.get(l.id) ?? 0) > 0 || l.closedShort > 0);
    if (stuck) {
      failure = conflict(`"${stuck.description}" has assets registered from it, so it can't be removed.`);
      return;
    }
    for (const [i, l] of d.lines.entries()) {
      if (!l.id) continue;
      const old = known.get(l.id)!;
      const done = registeredOn.get(l.id) ?? 0;
      if (done > 0 && old.categoryId !== null && old.categoryId !== l.categoryId) {
        failure = conflict(`"${old.description}" has assets registered from it, so its category can't change.`);
        return;
      }
      if (l.qty < done + old.closedShort) {
        failure = validationError({ [`lines.${i}.qty`]: `At least ${done + old.closedShort}: that many are registered or closed short` });
        return;
      }
    }

    // Where it goes: the shared rule over the saved lines (a send-back or an old draft is going forward again).
    const state: PoState = poStateFor({
      state: po.state === "SENT_BACK" ? "READY" : po.state,
      lines: d.lines.map((l, i) => ({
        cls: lineCls[i],
        remaining: lineProgress({
          qty: l.qty,
          registered: l.id ? registeredOn.get(l.id) ?? 0 : 0,
          closedShort: l.id ? known.get(l.id)!.closedShort : 0,
        }).remaining,
      })),
      itRegistered: assets.some((a) => a.cls === "IT"),
    });
    // Spec §5b.4: whether the typed totals add up, over the saved lines and the totals the PO will have.
    head.totalsConsistent = totalsConsistency(d.lines, d.totals ? totalsOf(d.totals) : rowTotals(po));
    const diff: AuditDiff = {
      ...(state !== po.state ? { state: { from: po.state, to: state } } : {}),
      ...diffOf(po, head),
      ...diffOf(summarize(lines), summarize(d.lines)),
    };
    const lineChanged = drop.length > 0 || d.lines.some((l) => {
      if (!l.id) return true;
      const old = known.get(l.id)!;
      return Object.keys(diffOf(
        { description: old.description, specs: old.specs, categoryId: old.categoryId, qty: old.qty, unit: old.unit, unitPrice: old.unitPrice },
        { description: l.description, specs: l.specs ? l.specs : null, categoryId: l.categoryId, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice },
      )).length > 0;
    });
    if (!resubmitTo && Object.keys(diff).length === 0 && !lineChanged && stored.length === 0) {
      out = { id, refNo: po.refNo, state: po.state }; // nothing to save: no audit, no note, no bell
      return;
    }

    // ---- writes (every refusal is above this line) ----
    const now = new Date();
    const hit = await tx.purchaseOrder.updateMany({
      where: { id, state: po.state },
      data: {
        state, ...head, updatedAt: now,
        ...(po.state === "SENT_BACK"
          ? { sentBackAt: null, sentBackById: null, sentBackBy: null, sentBackFields: [], sentBackNote: null }
          : {}),
      },
    });
    if (hit.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }

    if (drop.length) await tx.purchaseOrderLine.deleteMany({ where: { id: { in: drop.map((l) => l.id) }, orderId: id } });
    for (const l of d.lines.filter((x) => x.id)) {
      await tx.purchaseOrderLine.update({
        where: { id: l.id },
        data: {
          description: l.description, specs: l.specs ? l.specs : null, categoryId: l.categoryId, qty: l.qty, unit: l.unit,
          unitPrice: l.unitPrice,
        },
      });
    }
    const fresh = d.lines.filter((l) => !l.id);
    if (fresh.length) {
      await tx.purchaseOrderLine.createMany({
        data: fresh.map((l) => ({
          orderId: id, description: l.description, specs: l.specs ? l.specs : null, categoryId: l.categoryId, qty: l.qty,
          unit: l.unit, unitPrice: l.unitPrice,
        })),
      });
    }
    await writeStoredDocs(tx, id, stored, user);

    // Every asset from the PO, and its registrations, carry the saved money. On Finance's resubmit only the assets
    // returned to Purchasing are un-returned: one Finance returned to IT (a serial, say) stays with IT.
    const copied = await copyPoMoney(tx, {
      poId: id,
      assets,
      facts: { vendorId: head.vendorId, invoiceRef: head.invoiceRef, receiptRef: head.receiptRef, purchasedAt: head.purchasedAt },
      linePrice: new Map(d.lines.filter((l) => l.id).map((l) => [l.id!, l.unitPrice])),
      approved: "skip",
      extra: (a) => (resubmitTo === "FINANCE" && a.financeReturnedAt !== null && a.financeReturnedTo === "PURCHASING"
        ? {
            financeReturnedAt: null, financeReturnedById: null, financeReturnedTo: null, financeReturnReason: null,
            financeReturnFields: [], financeResubmitNote: reply,
          }
        : null),
    });
    for (const c of copied) {
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: c.id,
        action: c.extra ? "finance.resubmit" : "update",
        diff: c.extra
          ? { financeReturn: { from: "returned", to: null }, ...(reply ? { reply: { from: null, to: reply } } : {}), ...c.diff }
          : c.diff,
        reason: reply, source: "web",
      });
    }
    touchedAssets = copied.length > 0;

    await tx.noteEntry.create({
      data: {
        orderId: id, authorId: user.id, kind: resubmitTo ? "PO_RESUBMITTED" : "PO_SAVED",
        text: reply ?? (state === "WITH_IT" ? "Saved and sent to IT to check." : "Saved."),
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id,
      action: resubmitTo ? "po.resubmit" : "po.save", diff, reason: reply, source: "web",
    });
    if (resubmitTo) {
      // IT sent it back but Purchasing's correction left no IT work on it: IT hears, with nothing to check.
      const nothingForIt = resubmitTo === "IT" && state !== "WITH_IT";
      await notify(tx, {
        team: resubmitTo, kind: nothingForIt ? "CHANGED" : "TO_CHECK",
        title: nothingForIt
          ? `${po.refNo} · corrected by Purchasing, nothing left for IT to check`
          : `${po.refNo} · corrected by Purchasing, to check again`,
        body: reply, href: poHref(id), actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: id,
      });
      if (state === "WITH_IT" && resubmitTo !== "IT") {
        // Finance sent back a PO whose IT lines are still unregistered (or Purchasing added one): it is IT's again.
        await notify(tx, {
          team: "IT", kind: "TO_CHECK", title: `${po.refNo} · ${itSummary(d.lines, lineCls)} from Purchasing to check`,
          href: poHref(id), actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: id,
        });
      }
    } else if (state === "WITH_IT" && po.state !== "WITH_IT") {
      await notify(tx, {
        team: "IT", kind: "TO_CHECK", title: `${po.refNo} · ${itSummary(d.lines, lineCls)} from Purchasing to check`,
        href: poHref(id), actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: id,
      });
    }
    out = { id, refNo: po.refNo, state };
  });
  commit.done = true;

  if (failure) return failure;
  revalidatePo(id, touchedAssets);
  return ok(out!);
}

// ---- send back -----------------------------------------------------------------------------------------------------

/** PO_SEND_BACK_FIELDS' keys: the money fields, the PO's own (spec §5b.4: PO number, paid by, the invoice totals), the money documents. */
const SEND_BACK_KEYS = [
  ...MONEY_FIELDS, "poNumber", "paidBy", PO_TOTALS_KEY, "doc:invoice", "doc:official-receipt", "doc:delivery-receipt", "other",
] as const;

const sendBackSchema = z.object({
  id: z.string().min(1),
  fields: z.array(z.enum(SEND_BACK_KEYS)).min(1, "Tick what's wrong").max(SEND_BACK_KEYS.length),
  note: optionalReason,
});

/**
 * IT (while the PO is WITH_IT) or Finance (once something from it is registered and nothing is approved) sends a
 * PO's money problems back to Purchasing (spec §4 way 1, §5). Admin takes whichever path the stage gives: with IT →
 * as IT, else as Finance. Finance's send-back also returns every unapproved asset from the PO to Purchasing. Once
 * any asset is approved the money is locked (§5): Finance fixes it itself, with a reason.
 */
export async function sendBackPurchaseOrder(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  return asActionResult(() => sendBackImpl(input));
}

async function sendBackImpl(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const parsed = sendBackSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const fields = [...new Set(parsed.data.fields)];
  const note = parsed.data.note ? parsed.data.note : null;
  if (fields.includes("other") && !note) return validationError({ note: "Say what else is wrong" });
  if (note) {
    const err = reasonError(note);
    if (err) return validationError({ note: err });
  }

  const user = await actionRole("it_staff", "finance_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const { id } = parsed.data;
  let out: { refNo: string } | null = null;
  let failure: ActionResult<{ refNo: string }> | null = null;
  let touchedAssets = false;

  await prisma.$transaction(async (tx) => {
    await lockPo(tx, id);
    const po = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, refNo: true, state: true } });
    if (!po) { failure = conflict("That purchase order no longer exists."); return; }
    if (po.state === "CANCELLED") { failure = conflict(`${po.refNo} is cancelled.`); return; }
    if (po.state === "SENT_BACK") { failure = conflict(`${po.refNo} is already with Purchasing.`); return; }
    const assets = await tx.asset.findMany({
      where: { purchaseOrderId: id },
      select: { id: true, tag: true, financeConfirmedAt: true, financeReturnedAt: true, financeResubmitNote: true },
    });
    const c = counts(assets);
    if (c.approvedCount > 0) {
      failure = conflict(`Some assets from ${po.refNo} are approved. Fix it yourself with a reason.`);
      return;
    }

    let team: Team;
    if (user.role === "it_staff") {
      // The stage, not just the state: a WITH_IT PO with assets registered from it is with Finance (poMoneyStage), and
      // an IT send-back there would return none of them — a later approval would then strand the PO in SENT_BACK.
      if (po.state !== "WITH_IT") { failure = conflict(`${po.refNo} isn't with IT any more.`); return; }
      if (poMoneyStage({ state: po.state, ...c }) !== "with-it") {
        failure = conflict(`Assets from ${po.refNo} are registered, so its money is with Finance now. Ask Finance to send it back.`);
        return;
      }
      team = "IT";
    } else if (user.role === "finance_staff") {
      if (c.registeredCount === 0) { failure = conflict(`Nothing from ${po.refNo} is registered yet, so it isn't with Finance.`); return; }
      team = "FINANCE";
    } else {
      const stage = poMoneyStage({ state: po.state, ...c });
      if (stage === "with-it") team = "IT";
      else if (stage === "with-finance") team = "FINANCE";
      else { failure = conflict(`${po.refNo} is with Purchasing — there is nothing to send back.`); return; }
    }

    const now = new Date();
    // One id for the whole send-back, on the PO's entry and each asset's: its undo finds exactly what it returned.
    const batch = { from: null, to: randomUUID() };
    const hit = await tx.purchaseOrder.updateMany({
      where: { id, state: po.state },
      data: {
        state: "SENT_BACK", sentBackAt: now, sentBackById: user.id, sentBackBy: team, sentBackFields: fields,
        sentBackNote: note, updatedAt: now,
      },
    });
    if (hit.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }

    if (team === "FINANCE") {
      // Only assets not already returned: one Finance sent to IT (a serial, say) keeps that return, its fields and
      // its note — Purchasing's resubmit must not clear an IT problem IT never fixed. Each gets its own
      // finance.return entry (Task 6), so its history shows the return; `po` marks it as the PO's, which comes back
      // with the PO's correction rather than by a per-asset undo (finance-undo.ts).
      const labels = fields.map((f) => fieldLabels([f])[0] ?? capitalise(FIELD_WORDS[f] ?? f));
      for (const a of assets.filter((x) => x.financeConfirmedAt === null && x.financeReturnedAt === null)) {
        const hit = await returnOne(tx, a, user, { team: "PURCHASING", fields, note, labels }, { po: { from: null, to: po.refNo }, batch });
        if (!hit) throw new StaleAssetError(a.tag);
      }
      touchedAssets = true;
    }

    const words = fieldPhrase(fields);
    await tx.noteEntry.create({
      data: { orderId: id, authorId: user.id, kind: "PO_SENT_BACK", text: note ? `${capitalise(words)}: ${note}` : capitalise(words) },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id, action: "po.send-back",
      diff: {
        state: { from: po.state, to: "SENT_BACK" },
        sentBack: { from: null, to: { team, fields: fields.map((f) => FIELD_WORDS[f] ?? f), note } },
        batch,
      },
      reason: note, source: "web",
    });
    await notify(tx, {
      team: "PURCHASING", kind: "SENT_BACK", title: `${po.refNo} sent back by ${TEAM_NAME[team]}: ${words}`, body: note,
      href: poHref(id), actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: id,
    });
    out = { refNo: po.refNo };
  });

  if (failure) return failure;
  revalidatePo(id, touchedAssets);
  return ok(out!);
}

// ---- undo a send-back ----------------------------------------------------------------------------------------------

const undoSendBackSchema = z.object({ id: z.string().min(1) });

/**
 * Task 6 fix round 1 (spec §5: Undo covers the new send-backs, one action each). The person who sent the PO back —
 * IT, Finance or an admin — takes it back within 15 minutes, while nothing was done to the PO since and each asset it
 * returned still has that return as its latest finance change (poSendBackUndoCheck, read under the PO row's lock).
 * All or nothing: the PO goes back to the state it had (recorded in the po.send-back entry), its send-back is
 * cleared, and every asset the send-back returned is un-returned with its own asset.return.undone entry; one
 * po.send-back.undone entry on the PO, and a line in its thread. Purchasing's Sent back tab clears with the state.
 */
export async function undoPoSendBack(input: unknown): Promise<ActionResult<{ refNo: string; undone: number }>> {
  return asActionResult(() => undoSendBackImpl(input));
}

async function undoSendBackImpl(input: unknown): Promise<ActionResult<{ refNo: string; undone: number }>> {
  const parsed = undoSendBackSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const user = await actionRole("it_staff", "finance_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  type Out = { refNo: string; undone: number };
  let out: Out | null = null;
  let failure: ActionResult<Out> | null = null;

  await prisma.$transaction(async (tx) => {
    await lockPo(tx, id);
    const read = await readPoSendBackUndo(tx, id, user.id, new Date());
    if (!read) { failure = conflict("That purchase order no longer exists."); return; }
    const { po, assets, check } = read;
    if (!check.ok) { failure = conflict(check.reason); return; }
    const previous = check.previousState as PoState;

    // ---- writes (every refusal is above this line; a miss below rolls everything back) ----
    const now = new Date();
    const hit = await tx.purchaseOrder.updateMany({
      where: { id, state: "SENT_BACK", sentBackById: user.id },
      data: {
        state: previous, sentBackAt: null, sentBackById: null, sentBackBy: null, sentBackFields: [], sentBackNote: null,
        updatedAt: now,
      },
    });
    if (hit.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }
    for (const item of check.items) {
      const a = assets.find((x) => x.id === item.assetId)!;
      if (!(await undoOne(tx, a, "send-back", item.entry.diff, user, { po: { from: null, to: po.refNo } }))) {
        throw new StaleAssetError(a.tag);
      }
    }
    const sentBack = (check.entry.diff as Record<string, { to?: unknown }> | null)?.sentBack?.to ?? null;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id, action: "po.send-back.undone",
      diff: { state: { from: "SENT_BACK", to: previous }, sentBack: { from: sentBack, to: null } },
      source: "web",
    });
    // The thread is append-only: the send-back stays in it, and so does this.
    await tx.noteEntry.create({ data: { orderId: id, authorId: user.id, kind: "COMMENT", text: "Undid the send-back to Purchasing." } });
    // 2026-10-23: Purchasing heard of the send-back, so it hears it was taken back (the earlier one stays).
    await notify(tx, {
      team: "PURCHASING", kind: "CHANGED", title: FINANCE_WORDS.poSendBackUndone(po.refNo), href: poHref(id),
      actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: id,
    });
    out = { refNo: po.refNo, undone: check.items.length };
  });

  if (failure) return failure;
  revalidatePo(id, true);
  revalidatePath("/finance/review");
  return ok(out!);
}

// ---- fix -----------------------------------------------------------------------------------------------------------

/**
 * Money fields only (`.strict()`): a device field such as a serial is a schema error, never a silent drop. A PO has
 * no cost of its own — the unit price of a line is the cost of every asset registered from it, so `cost` is fixed
 * through `lines`. Migration 39 (spec §5b.4): the PO number, paid by and each of the seven totals are money fields
 * too (PO_MONEY_FIELDS); the PO number and paid by can be corrected, not cleared.
 */
const fixSchema = z.object({
  id: z.string().min(1),
  patch: z.object({
    vendorId: z.string().min(1, "Pick the vendor").optional(),
    poNumber: z.string().trim().min(1, NEEDED.poNumber).max(PO_NUMBER_MAX, `Keep the PO number to ${PO_NUMBER_MAX} characters or fewer`).optional(),
    invoiceRef: z.string().trim().min(1, "Enter the SI number").max(60).optional(),
    receiptRef: z.string().trim().max(60).optional(),
    purchasedAt: dateStr.optional(),
    paidBy: z.enum(PAID_BY, { error: "Pick credit card or debit card" }).optional(),
    fees: price.nullable().optional(),
    totalSales: moneyText, lessVat: moneyText, netOfVat: moneyText, discount: moneyText,
    amountDue: moneyText, addVat: moneyText, totalAmountDue: moneyText,
    lines: z.array(z.object({ id: z.string().min(1), unitPrice: price }).strict()).min(1).max(50).optional(),
  }).strict(),
  reason: optionalReason,
});

const HEADER_KEYS = ["vendorId", "poNumber", "invoiceRef", "receiptRef", "purchasedAt", "paidBy", "fees", ...TOTAL_KEYS] as const;
/** The PO facts an asset (and a registration's PurchaseRecord) copies; fees stay on the PO. */
const COPIED_KEYS = ["vendorId", "invoiceRef", "receiptRef", "purchasedAt"] as const;

/**
 * A PO-level money fix (spec §5, §6). Each patched field must pass `canEditField(role, field, "PURCHASING",
 * poMoneyStage(po))`, with a reason whenever any of them needs one. The fix is copied (copyPoMoney) to every asset
 * from the PO and its registrations — approved assets included, without reopening them (`financeConfirmedAt`
 * untouched), except that a price giving a cost to an approved asset that had none reopens it, as updateAsset does
 * (spec §5) — with one `asset.money.fixed` audit per changed asset (plus `finance.reopened` on a reopen), one
 * `po.fix`, and a PO_FIXED note. Purchasing hears about it unless it made the fix.
 */
export async function fixPurchaseOrder(input: unknown): Promise<ActionResult<{ refNo: string; changed: string[] }>> {
  return asActionResult(() => fixImpl(input));
}

async function fixImpl(input: unknown): Promise<ActionResult<{ refNo: string; changed: string[] }>> {
  const parsed = fixSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, patch } = parsed.data;
  const reason = parsed.data.reason ? parsed.data.reason : null;
  const keys = (Object.keys(patch) as Array<keyof typeof patch>).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return validationError({ patch: "Change at least one money detail" });

  const user = await actionRole("purchasing_staff", "it_staff", "finance_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const vendor = patch.vendorId
    ? await prisma.vendor.findUnique({ where: { id: patch.vendorId }, select: { id: true, archivedAt: true } })
    : null;
  if (patch.vendorId && !vendor) return validationError({ "patch.vendorId": "Unknown vendor" });
  if (patch.poNumber) {
    const owner = await poNumberOwner(patch.poNumber, id);
    if (owner) return validationError({ "patch.poNumber": usedOn(patch.poNumber, owner.refNo) });
  }

  try {
    return await fixWrite(id, patch, keys, reason, user, vendor);
  } catch (err) {
    // Another PO took the number between the pre-check and the write: the partial unique index refused it.
    if (patch.poNumber && isPoNumberClash(err)) return validationError({ "patch.poNumber": await poNumberRefusal(patch.poNumber, id) });
    throw err;
  }
}

type FixPatch = z.infer<typeof fixSchema>["patch"];

async function fixWrite(
  id: string, patch: FixPatch, keys: Array<keyof FixPatch>, reason: string | null, user: Actor,
  vendor: { id: string; archivedAt: Date | null } | null,
): Promise<ActionResult<{ refNo: string; changed: string[] }>> {
  type Out = { refNo: string; changed: string[] };
  let out: Out | null = null;
  let failure: ActionResult<Out> | null = null;

  await prisma.$transaction(async (tx) => {
    // Lock first: the counts that decide the stage must not move under the fix (a registration or approval waits).
    await lockPo(tx, id);
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true, refNo: true, state: true, vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true, fees: true,
        poNumber: true, paidBy: true, formV2: true, totalsConsistent: true, ...TOTALS_SELECT,
      },
    });
    if (!po) { failure = conflict("That purchase order no longer exists."); return; }
    if (po.state === "CANCELLED") { failure = conflict(`${po.refNo} is cancelled.`); return; }
    const lines = await tx.purchaseOrderLine.findMany({
      where: { orderId: id }, select: { id: true, description: true, qty: true, unitPrice: true },
    });
    const assets = await tx.asset.findMany({ where: { purchaseOrderId: id }, select: ASSET_SELECT });
    const stage = poMoneyStage({ state: po.state, ...counts(assets) });

    let needsReason = false;
    for (const k of keys) {
      const verdict = canEditField(user.role, k === "lines" ? "cost" : k, "PURCHASING", stage);
      if (!verdict.ok) { failure = conflict(verdict.why); return; }
      needsReason ||= verdict.reasonRequired;
    }
    if (needsReason) {
      const err = reasonError(reason ?? undefined);
      if (err) { failure = validationError({ reason: err }); return; }
    }
    if (vendor?.archivedAt && vendor.id !== po.vendorId) { failure = validationError({ "patch.vendorId": "That vendor is archived" }); return; }
    // A PO from the new form can't lose its total amount due (spec §5b.2).
    if (po.formV2 && patch.totalAmountDue === null) { failure = validationError({ "patch.totalAmountDue": NEEDED.totalAmountDue }); return; }
    const lineById = new Map(lines.map((l, i) => [l.id, { ...l, index: i + 1 }]));
    if (patch.lines?.some((l) => !lineById.has(l.id))) {
      failure = conflict("This purchase order changed elsewhere — reload and try again.");
      return;
    }

    // What actually changes.
    const after: Record<string, unknown> = {};
    if (patch.vendorId !== undefined) after.vendorId = patch.vendorId;
    if (patch.invoiceRef !== undefined) after.invoiceRef = patch.invoiceRef;
    if (patch.receiptRef !== undefined) after.receiptRef = patch.receiptRef ? patch.receiptRef : null;
    if (patch.purchasedAt !== undefined) after.purchasedAt = toDate(patch.purchasedAt);
    if (patch.fees !== undefined) after.fees = patch.fees;
    if (patch.poNumber !== undefined) after.poNumber = patch.poNumber;
    if (patch.paidBy !== undefined) after.paidBy = patch.paidBy;
    for (const k of TOTAL_KEYS) if (patch[k] !== undefined) after[k] = patch[k];
    const headDiff = diffOf(po, after);
    const newPrice = new Map<string, number>();
    const lineDiff: AuditDiff = {};
    for (const l of patch.lines ?? []) {
      const old = lineById.get(l.id)!;
      const d = diffOf({ unitPrice: old.unitPrice }, { unitPrice: l.unitPrice });
      if (!d.unitPrice) continue;
      newPrice.set(l.id, l.unitPrice);
      lineDiff[`line${old.index}.unitPrice`] = d.unitPrice;
    }
    const changed = [
      ...HEADER_KEYS.filter((k) => k in headDiff),
      ...(newPrice.size ? ["cost"] : []),
    ];
    if (changed.length === 0) { failure = validationError({ patch: "Nothing changed — these are the values it already has." }); return; }

    // Spec §5b.4: a fix to a price or a total re-checks whether the totals add up.
    const consistency: AuditDiff = {};
    if (newPrice.size > 0 || TOTAL_KEYS.some((k) => k in headDiff)) {
      const totals = { ...rowTotals(po), ...Object.fromEntries(TOTAL_KEYS.filter((k) => k in headDiff).map((k) => [k, after[k]])) };
      const next = totalsConsistency(
        lines.map((l) => ({ qty: l.qty, unitPrice: newPrice.get(l.id) ?? (l.unitPrice === null ? null : Number(l.unitPrice)) })),
        totals,
      );
      if (next !== (po.totalsConsistent ?? null)) consistency.totalsConsistent = { from: po.totalsConsistent ?? null, to: next };
    }

    // ---- writes (every refusal is above this line) ----
    const now = new Date();
    const headChanges = Object.fromEntries(Object.keys(headDiff).map((k) => [k, after[k]]));
    const hit = await tx.purchaseOrder.updateMany({
      where: { id, state: po.state },
      data: { ...headChanges, ...(consistency.totalsConsistent ? { totalsConsistent: consistency.totalsConsistent.to as boolean | null } : {}), updatedAt: now },
    });
    if (hit.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }
    for (const [lineId, unitPrice] of newPrice) {
      await tx.purchaseOrderLine.update({ where: { id: lineId }, data: { unitPrice } });
    }
    // Approved assets too, without reopening them — except one approved with no cost that now gets one (spec §5).
    const fixed = await copyPoMoney(tx, {
      poId: id,
      assets,
      facts: Object.fromEntries(COPIED_KEYS.filter((k) => k in headDiff).map((k) => [k, after[k]])) as PoFacts,
      linePrice: newPrice,
      approved: "include",
    });
    for (const c of fixed) {
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: c.id, action: "asset.money.fixed",
        diff: c.diff, reason, source: "web",
      });
      if (c.reopened) {
        // The same entry updateAsset writes when a cost reopens an approved no-cost asset.
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: c.id, action: "finance.reopened",
          diff: { cost: c.diff.cost }, source: "web",
        });
      }
    }

    const words = fieldPhrase(changed);
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id, action: "po.fix",
      diff: { ...headDiff, ...lineDiff, ...consistency }, reason, source: "web",
    });
    await tx.noteEntry.create({
      data: { orderId: id, authorId: user.id, kind: "PO_FIXED", text: reason ? `Fixed the ${words}: ${reason}` : `Fixed the ${words}.` },
    });
    const team = teamOfRole(user.role);
    await notify(tx, {
      team: "PURCHASING", kind: "CHANGED", title: `${team ? TEAM_NAME[team] : "An admin"} changed the ${words} on ${po.refNo}`,
      body: reason, href: poHref(id), actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: id,
    });
    out = { refNo: po.refNo, changed };
  });

  if (failure) return failure;
  revalidatePo(id, true);
  return ok(out!);
}

// ---- close a line short --------------------------------------------------------------------------------------------

const closeSchema = z.object({
  lineId: z.string().min(1),
  qty: z.number().int().min(1, "At least one").max(999),
  reason: optionalReason,
});

/**
 * Spec §4 (partial deliveries): the rest of a line will never arrive. Closing it short counts those units as done,
 * with a reason ("supplier cancelled 2 units"). Never more than what is still to register, re-read under the PO
 * row's lock so a registration landing at the same moment can't push the line past its quantity. Closing the last IT
 * units of a WITH_IT PO short leaves IT nothing to check, so the PO moves on to READY (poStateFor) — otherwise a mixed
 * PO would sit in IT's queue for good with nothing IT can register or send back.
 */
export async function closeLineShort(input: unknown): Promise<ActionResult<{ refNo: string; remaining: number }>> {
  return asActionResult(() => closeImpl(input));
}

async function closeImpl(input: unknown): Promise<ActionResult<{ refNo: string; remaining: number }>> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { lineId, qty } = parsed.data;
  const err = reasonError(parsed.data.reason);
  if (err) return validationError({ reason: err });
  const reason = parsed.data.reason!;

  const user = await actionRole(...PO_WRITE_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const where = await prisma.purchaseOrderLine.findUnique({ where: { id: lineId }, select: { orderId: true } });
  if (!where) return validationError({ lineId: "Unknown line" });
  const id = where.orderId;

  type Out = { refNo: string; remaining: number };
  let out: Out | null = null;
  let failure: ActionResult<Out> | null = null;

  await prisma.$transaction(async (tx) => {
    await lockPo(tx, id);
    const po = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, refNo: true, state: true } });
    if (!po) { failure = conflict("That purchase order no longer exists."); return; }
    if (po.state === "CANCELLED") { failure = conflict(`${po.refNo} is cancelled.`); return; }
    const line = await tx.purchaseOrderLine.findUnique({
      where: { id: lineId }, select: { id: true, description: true, qty: true, closedShort: true },
    });
    if (!line) { failure = conflict("That line no longer exists."); return; }
    const registered = await tx.asset.count({ where: { purchaseOrderLineId: lineId } });
    const { remaining } = lineProgress({ qty: line.qty, registered, closedShort: line.closedShort });
    if (qty > remaining) {
      failure = conflict(remaining === 0
        ? `Nothing is left to close on "${line.description}".`
        : `Only ${remaining} left on "${line.description}" — close ${remaining} or fewer.`);
      return;
    }

    const closedShort = line.closedShort + qty;
    const state = po.state as PoState;
    const next = state === "WITH_IT" ? await stateAfterClose(tx, id, lineId, closedShort) : state;
    // totalsConsistent stays as it is: the items are Σ qty × unit price (spec §3), and closing units short changes
    // neither — nor the paper invoice the totals were typed from.

    // ---- writes (every refusal is above this line; the PO's guarded move comes first, so a miss writes nothing) ----
    if (next !== state) {
      const moved = await tx.purchaseOrder.updateMany({ where: { id, state }, data: { state: next, updatedAt: new Date() } });
      if (moved.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }
    }
    const hit = await tx.purchaseOrderLine.updateMany({
      where: { id: lineId, closedShort: line.closedShort },
      data: { closedShort, closedShortReason: reason },
    });
    if (hit.count === 0) {
      if (next !== state) throw new Error(`${po.refNo}: line changed under the PO row lock`); // rolls the move back
      failure = conflict("Someone else changed this line first — reload and try again.");
      return;
    }
    await tx.noteEntry.create({
      data: { orderId: id, authorId: user.id, kind: "PO_LINE_CLOSED", text: `${line.description}: ${qty} closed short — ${reason}` },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id, action: "po.line-closed",
      diff: {
        ...(next !== state ? { state: { from: state, to: next } } : {}),
        line: { from: null, to: line.description }, closedShort: { from: line.closedShort, to: closedShort },
      },
      reason, source: "web",
    });
    // The last units closed short on an otherwise fully approved PO complete it: its approval webhooks, once.
    await emitIfPoFullyApproved(tx, id, user);
    out = { refNo: po.refNo, remaining: remaining - qty };
  });

  if (failure) return failure;
  revalidatePo(id);
  return ok(out!);
}

/** A WITH_IT PO's state once `lineId` has `closedShort` units closed: poStateFor over every line, read under the lock. */
async function stateAfterClose(tx: Prisma.TransactionClient, id: string, lineId: string, closedShort: number): Promise<PoState> {
  const lines = await tx.purchaseOrderLine.findMany({
    where: { orderId: id }, select: { id: true, categoryId: true, qty: true, closedShort: true },
  });
  const catIds = [...new Set(lines.map((l) => l.categoryId).filter((x): x is string => !!x))];
  const cats = await tx.assetCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, cls: true } });
  const clsOf = new Map(cats.map((c) => [c.id, c.cls]));
  const assets = await tx.asset.findMany({ where: { purchaseOrderId: id }, select: { cls: true, purchaseOrderLineId: true } });
  const registeredOn = new Map<string, number>();
  for (const a of assets) {
    if (a.purchaseOrderLineId) registeredOn.set(a.purchaseOrderLineId, (registeredOn.get(a.purchaseOrderLineId) ?? 0) + 1);
  }
  return poStateFor({
    state: "WITH_IT",
    lines: lines.map((l) => ({
      cls: l.categoryId ? clsOf.get(l.categoryId) ?? null : null,
      remaining: lineProgress({
        qty: l.qty, registered: registeredOn.get(l.id) ?? 0, closedShort: l.id === lineId ? closedShort : l.closedShort,
      }).remaining,
    })),
    itRegistered: assets.some((a) => a.cls === "IT"),
  });
}

// ---- cancel --------------------------------------------------------------------------------------------------------

const cancelSchema = z.object({ id: z.string().min(1), reason: optionalReason });

/**
 * Purchasing (or an admin) withdraws a PO, with a reason, only while nothing is registered from it. The check and
 * the state change happen in one transaction under the PO row's lock, so a registration landing at the same moment
 * can't leave a cancelled PO with assets.
 */
export async function cancelPurchaseOrder(input: unknown): Promise<ActionResult<{ refNo: string; state: PoState }>> {
  return asActionResult(() => cancelImpl(input));
}

async function cancelImpl(input: unknown): Promise<ActionResult<{ refNo: string; state: PoState }>> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;
  const err = reasonError(parsed.data.reason);
  if (err) return validationError({ reason: err });
  const reason = parsed.data.reason!;

  const user = await actionRole(...PO_WRITE_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  type Out = { refNo: string; state: PoState };
  let out: Out | null = null;
  let failure: ActionResult<Out> | null = null;

  await prisma.$transaction(async (tx) => {
    await lockPo(tx, id);
    const po = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, refNo: true, state: true } });
    if (!po) { failure = conflict("That purchase order no longer exists."); return; }
    if (po.state === "CANCELLED") { failure = conflict(`${po.refNo} is already cancelled.`); return; }
    const registered = await tx.asset.count({ where: { purchaseOrderId: id } });
    if (registered > 0) { failure = conflict(`${po.refNo} has assets registered from it — it can't be cancelled.`); return; }

    const now = new Date();
    const hit = await tx.purchaseOrder.updateMany({
      where: { id, state: po.state },
      data: { state: "CANCELLED", cancelledAt: now, cancelReason: reason, updatedAt: now },
    });
    if (hit.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }
    // NoteEntry is append-only (DB trigger): the thread keeps the reason for good.
    await tx.noteEntry.create({ data: { orderId: id, authorId: user.id, kind: "PO_CANCELLED", text: reason } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id, action: "po.cancel",
      diff: { state: { from: po.state, to: "CANCELLED" } }, reason, source: "web",
    });
    out = { refNo: po.refNo, state: "CANCELLED" };
  });

  if (failure) return failure;
  revalidatePo(id);
  return ok(out!);
}

// ---- comment -------------------------------------------------------------------------------------------------------

const commentSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(2, "Say something").max(2000),
});

/**
 * A free comment in the PO's thread — never a state change, and deliberately still allowed on a READY or CANCELLED
 * order: the thread IS the record of a purchase, and "why did we buy this" gets asked after the fact.
 */
export async function addComment(input: unknown): Promise<ActionResult<null>> {
  return asActionResult(() => addCommentImpl(input));
}

async function addCommentImpl(input: unknown): Promise<ActionResult<null>> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, text } = parsed.data;

  const user = await actionRole("purchasing_staff", "it_staff", "finance_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const failure = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true } });
    if (!po) return conflict("That purchase order no longer exists.");
    await tx.noteEntry.create({ data: { orderId: id, authorId: user.id, kind: "COMMENT", text } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id, action: "comment", source: "web",
    });
    return null;
  });

  if (failure) return failure;
  revalidatePo(id);
  return ok(null);
}
