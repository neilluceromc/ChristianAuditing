"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type AssetClass, type Role, type Team } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { notify } from "@/server/notifications/notify";
import { diffOf, type AuditDiff } from "@/lib/audit-diff";
import { cleanReason } from "@/lib/reason";
import { GROUP_ARCHIVED } from "@/lib/groups";
import { canEditField, MONEY_FIELDS, poMoneyStage, reasonError, teamOfRole, type IntakeStage } from "@/lib/intake-rules";
import { lineProgress, PO_WRITE_ROLES, poRefNo, stateAfterResubmit, stateAfterSave, type PoState } from "@/lib/po-flow";
import { moneyForAsset } from "@/lib/po-money";
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }
}

/** `SELECT … FOR UPDATE` on the PO row (table keeps its old name), held until the transaction ends. */
async function lockPo(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "PurchaseRequest" WHERE "id" = ${id} FOR UPDATE`;
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
  cost: "unit price", fees: "fees", purchasedAt: "purchase date", vendorId: "supplier",
  invoiceRef: "SI number", receiptRef: "OR number",
  "doc:invoice": "sales invoice", "doc:official-receipt": "official receipt", "doc:delivery-receipt": "delivery receipt",
  other: "something else",
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
  .number()
  .min(0, "A price can't be negative")
  .max(99_999_999.99)
  .multipleOf(0.01, "Prices go to centavos — two decimal places at most");
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const optionalReason = z.string().overwrite(cleanReason).optional();

/** What an asset from a PO carries of its money (moneyForAsset's fields), plus its review state. */
const ASSET_SELECT = {
  id: true, tag: true, purchaseOrderLineId: true, financeConfirmedAt: true, financeReturnedAt: true, financeReturnedTo: true,
  cost: true, vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true,
} as const;

function counts(assets: Array<{ financeConfirmedAt: Date | null }>) {
  return { registeredCount: assets.length, approvedCount: assets.filter((a) => a.financeConfirmedAt !== null).length };
}

// ---- save ----------------------------------------------------------------------------------------------------------

const lineSchema = z.object({
  id: z.string().min(1).optional(), // present = an existing line
  description: z.string().trim().min(2, "Say what this is").max(200),
  specs: z.string().trim().max(500).optional(),
  categoryId: z.string().min(1, "Pick a category"),
  qty: z.number().int().min(1, "At least one").max(999),
  unitPrice: price,
});

const saveSchema = z.object({
  id: z.string().min(1).optional(),
  vendorId: z.string().min(1, "Pick the supplier"),
  invoiceRef: z.string().trim().min(1, "Enter the SI number").max(60),
  receiptRef: z.string().trim().max(60).optional(),
  purchasedAt: dateStr,
  departmentId: z.string().optional(),
  fees: price.nullable().optional(),
  lines: z.array(lineSchema).min(1, "A purchase order needs at least one line").max(50),
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
 * - **SENT_BACK:** Purchasing's reply is required (5–300 characters). The PO goes back to whoever sent it
 *   (`stateAfterResubmit`), the send-back is cleared and that team's bell rings. Finance's returned assets are
 *   un-returned. Every asset from the PO is re-copied with the saved money (`moneyForAsset`), so a PO's assets
 *   always share one SI number, supplier and date.
 */
export async function savePurchaseOrder(input: unknown): Promise<ActionResult<Saved>> {
  return asActionResult(() => saveImpl(input));
}

async function saveImpl(input: unknown): Promise<ActionResult<Saved>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const user = await actionRole(...PO_WRITE_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const vendor = await prisma.vendor.findUnique({ where: { id: d.vendorId }, select: { id: true, archivedAt: true } });
  if (!vendor) return validationError({ vendorId: "Unknown supplier" });
  const departmentId = d.departmentId ? d.departmentId : null;
  const dept = departmentId
    ? await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, archivedAt: true } })
    : null;
  if (departmentId && !dept) return validationError({ departmentId: "Unknown department" });

  const catIds = [...new Set(d.lines.map((l) => l.categoryId))];
  const cats = await prisma.assetCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, cls: true } });
  if (cats.length !== catIds.length) return validationError({ lines: "Unknown category" });
  const clsOf = new Map(cats.map((c) => [c.id, c.cls]));
  const lineCls = d.lines.map((l) => clsOf.get(l.categoryId) ?? null);

  const archived = { vendor: vendor.archivedAt !== null, dept: dept?.archivedAt != null };
  return d.id ? editPo(d.id, d, user, lineCls, archived) : createPo(d, user, lineCls, archived);
}

type Actor = { id: string; name: string; role: Role };

function header(d: SaveInput) {
  return {
    vendorId: d.vendorId,
    invoiceRef: d.invoiceRef,
    receiptRef: d.receiptRef ? d.receiptRef : null,
    purchasedAt: toDate(d.purchasedAt),
    fees: d.fees ?? null,
    departmentId: d.departmentId ? d.departmentId : null,
  };
}

async function createPo(
  d: SaveInput, user: Actor, lineCls: Array<AssetClass | null>, archived: { vendor: boolean; dept: boolean },
): Promise<ActionResult<Saved>> {
  // Phase 37 (spec §2.1): a new order never names an archived department or supplier.
  if (archived.vendor) return validationError({ vendorId: "That supplier is archived" });
  if (archived.dept) return validationError({ departmentId: GROUP_ARCHIVED });
  const state = stateAfterSave(lineCls.map((cls) => ({ cls })));
  const head = header(d);

  const saved = await prisma.$transaction(async (tx) => {
    const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('purchase_request_ref_seq')`;
    const refNo = poRefNo(Number(nextval));
    const created = await tx.purchaseOrder.create({
      data: {
        refNo, state, requestedById: user.id, ...head,
        lines: {
          create: d.lines.map((l) => ({
            description: l.description, specs: l.specs ? l.specs : null, categoryId: l.categoryId, qty: l.qty, unitPrice: l.unitPrice,
          })),
        },
      },
      select: { id: true },
    });
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

  revalidatePo(saved.id);
  return ok(saved);
}

async function editPo(
  id: string, d: SaveInput, user: Actor, lineCls: Array<AssetClass | null>, archived: { vendor: boolean; dept: boolean },
): Promise<ActionResult<Saved>> {
  const head = header(d);
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
      },
    });
    if (!po) { failure = conflict("That purchase order no longer exists."); return; }
    if (po.state === "CANCELLED") { failure = conflict(`${po.refNo} is cancelled.`); return; }
    const lines = await tx.purchaseOrderLine.findMany({
      where: { orderId: id },
      select: { id: true, description: true, specs: true, categoryId: true, qty: true, unitPrice: true, closedShort: true },
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
    if (archived.vendor && po.vendorId !== head.vendorId) { failure = validationError({ vendorId: "That supplier is archived" }); return; }
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

    const state: PoState = resubmitTo ? stateAfterResubmit(resubmitTo) : stateAfterSave(lineCls.map((cls) => ({ cls })));
    const diff: AuditDiff = {
      ...(state !== po.state ? { state: { from: po.state, to: state } } : {}),
      ...diffOf(po, head),
      ...diffOf(summarize(lines), summarize(d.lines)),
    };
    const lineChanged = drop.length > 0 || d.lines.some((l) => {
      if (!l.id) return true;
      const old = known.get(l.id)!;
      return Object.keys(diffOf(
        { description: old.description, specs: old.specs, categoryId: old.categoryId, qty: old.qty, unitPrice: old.unitPrice },
        { description: l.description, specs: l.specs ? l.specs : null, categoryId: l.categoryId, qty: l.qty, unitPrice: l.unitPrice },
      )).length > 0;
    });
    if (!resubmitTo && Object.keys(diff).length === 0 && !lineChanged) {
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
        data: { description: l.description, specs: l.specs ? l.specs : null, categoryId: l.categoryId, qty: l.qty, unitPrice: l.unitPrice },
      });
    }
    const fresh = d.lines.filter((l) => !l.id);
    if (fresh.length) {
      await tx.purchaseOrderLine.createMany({
        data: fresh.map((l) => ({
          orderId: id, description: l.description, specs: l.specs ? l.specs : null, categoryId: l.categoryId, qty: l.qty, unitPrice: l.unitPrice,
        })),
      });
    }

    // Every asset from the PO carries the saved money; Finance's returned ones are un-returned on its resubmit.
    const priceOf = new Map(d.lines.filter((l) => l.id).map((l) => [l.id!, l.unitPrice]));
    for (const a of assets) {
      const linePrice = a.purchaseOrderLineId ? priceOf.get(a.purchaseOrderLineId) : undefined;
      const money = moneyForAsset(head, { unitPrice: linePrice ?? a.cost });
      const moneyDiff = diffOf(a, money);
      const unreturn = resubmitTo === "FINANCE" && a.financeReturnedAt !== null && a.financeReturnedTo === "PURCHASING";
      if (!unreturn && Object.keys(moneyDiff).length === 0) continue;
      await tx.asset.updateMany({
        where: { id: a.id, financeConfirmedAt: null },
        data: {
          ...money,
          ...(unreturn
            ? {
                financeReturnedAt: null, financeReturnedById: null, financeReturnedTo: null, financeReturnReason: null,
                financeReturnFields: [], financeResubmitNote: reply,
              }
            : {}),
        },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: a.id,
        action: unreturn ? "finance.resubmit" : "update",
        diff: unreturn
          ? { financeReturn: { from: "returned", to: null }, ...(reply ? { reply: { from: null, to: reply } } : {}), ...moneyDiff }
          : moneyDiff,
        reason: reply, source: "web",
      });
      touchedAssets = true;
    }

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
      await notify(tx, {
        team: resubmitTo, kind: "TO_CHECK", title: `${po.refNo} · corrected by Purchasing, to check again`, body: reply,
        href: poHref(id), actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: id,
      });
    } else if (state === "WITH_IT" && po.state !== "WITH_IT") {
      await notify(tx, {
        team: "IT", kind: "TO_CHECK", title: `${po.refNo} · ${itSummary(d.lines, lineCls)} from Purchasing to check`,
        href: poHref(id), actorId: user.id, actorRole: user.role, entityType: ENTITY, entityId: id,
      });
    }
    out = { id, refNo: po.refNo, state };
  });

  if (failure) return failure;
  revalidatePo(id, touchedAssets);
  return ok(out!);
}

// ---- send back -----------------------------------------------------------------------------------------------------

const SEND_BACK_KEYS = [...MONEY_FIELDS, "doc:invoice", "doc:official-receipt", "doc:delivery-receipt", "other"] as const;

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
    const assets = await tx.asset.findMany({ where: { purchaseOrderId: id }, select: { id: true, financeConfirmedAt: true } });
    const c = counts(assets);
    if (c.approvedCount > 0) {
      failure = conflict(`Some assets from ${po.refNo} are approved. Fix it yourself with a reason.`);
      return;
    }

    let team: Team;
    if (user.role === "it_staff") {
      if (po.state !== "WITH_IT") { failure = conflict(`${po.refNo} isn't with IT any more.`); return; }
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
    const hit = await tx.purchaseOrder.updateMany({
      where: { id, state: po.state },
      data: {
        state: "SENT_BACK", sentBackAt: now, sentBackById: user.id, sentBackBy: team, sentBackFields: fields,
        sentBackNote: note, updatedAt: now,
      },
    });
    if (hit.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }

    if (team === "FINANCE") {
      await tx.asset.updateMany({
        where: { purchaseOrderId: id, financeConfirmedAt: null },
        data: {
          financeReturnedAt: now, financeReturnedById: user.id, financeReturnedTo: "PURCHASING",
          financeReturnFields: fields, financeReturnReason: note, financeResubmitNote: null,
        },
      });
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

// ---- fix -----------------------------------------------------------------------------------------------------------

/**
 * Money fields only (`.strict()`): a device field such as a serial is a schema error, never a silent drop. A PO has
 * no cost of its own — the unit price of a line is the cost of every asset registered from it, so `cost` is fixed
 * through `lines`.
 */
const fixSchema = z.object({
  id: z.string().min(1),
  patch: z.object({
    vendorId: z.string().min(1, "Pick the supplier").optional(),
    invoiceRef: z.string().trim().min(1, "Enter the SI number").max(60).optional(),
    receiptRef: z.string().trim().max(60).optional(),
    purchasedAt: dateStr.optional(),
    fees: price.nullable().optional(),
    lines: z.array(z.object({ id: z.string().min(1), unitPrice: price }).strict()).min(1).max(50).optional(),
  }).strict(),
  reason: optionalReason,
});

const HEADER_KEYS = ["vendorId", "invoiceRef", "receiptRef", "purchasedAt", "fees"] as const;
/** The PO facts an asset (and a registration's PurchaseRecord) copies; fees stay on the PO. */
const COPIED_KEYS = ["vendorId", "invoiceRef", "receiptRef", "purchasedAt"] as const;

/**
 * A PO-level money fix (spec §5, §6). Each patched field must pass `canEditField(role, field, "PURCHASING",
 * poMoneyStage(po))`, with a reason whenever any of them needs one. The fix is copied to every asset from the PO —
 * approved ones included, without reopening them (`financeConfirmedAt` untouched) — with one `asset.money.fixed`
 * audit per changed asset, one `po.fix`, and a PO_FIXED note. Purchasing hears about it unless it made the fix.
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
  if (patch.vendorId && !vendor) return validationError({ "patch.vendorId": "Unknown supplier" });

  type Out = { refNo: string; changed: string[] };
  let out: Out | null = null;
  let failure: ActionResult<Out> | null = null;

  await prisma.$transaction(async (tx) => {
    // Lock first: the counts that decide the stage must not move under the fix (a registration or approval waits).
    await lockPo(tx, id);
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, refNo: true, state: true, vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true, fees: true },
    });
    if (!po) { failure = conflict("That purchase order no longer exists."); return; }
    if (po.state === "CANCELLED") { failure = conflict(`${po.refNo} is cancelled.`); return; }
    const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: id }, select: { id: true, description: true, unitPrice: true } });
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
    if (vendor?.archivedAt && vendor.id !== po.vendorId) { failure = validationError({ "patch.vendorId": "That supplier is archived" }); return; }
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

    // ---- writes (every refusal is above this line) ----
    const now = new Date();
    const headChanges = Object.fromEntries(Object.keys(headDiff).map((k) => [k, after[k]]));
    const hit = await tx.purchaseOrder.updateMany({ where: { id, state: po.state }, data: { ...headChanges, updatedAt: now } });
    if (hit.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }
    for (const [lineId, unitPrice] of newPrice) {
      await tx.purchaseOrderLine.update({ where: { id: lineId }, data: { unitPrice } });
    }
    const copied = Object.fromEntries(COPIED_KEYS.filter((k) => k in headDiff).map((k) => [k, after[k]]));
    if (Object.keys(copied).length) {
      await tx.purchaseRecord.updateMany({ where: { purchaseOrderId: id }, data: copied });
    }
    for (const a of assets) {
      const target: Record<string, unknown> = { ...copied };
      if (a.purchaseOrderLineId && newPrice.has(a.purchaseOrderLineId)) target.cost = newPrice.get(a.purchaseOrderLineId);
      const assetDiff = diffOf(a, target);
      if (Object.keys(assetDiff).length === 0) continue;
      // Approved assets too, and never their approval: financeConfirmedAt is not in the write.
      await tx.asset.update({ where: { id: a.id }, data: Object.fromEntries(Object.keys(assetDiff).map((k) => [k, target[k]])) });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: a.id, action: "asset.money.fixed",
        diff: assetDiff, reason, source: "web",
      });
    }

    const words = fieldPhrase(changed);
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id, action: "po.fix",
      diff: { ...headDiff, ...lineDiff }, reason, source: "web",
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
 * row's lock so a registration landing at the same moment can't push the line past its quantity.
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
    const hit = await tx.purchaseOrderLine.updateMany({
      where: { id: lineId, closedShort: line.closedShort },
      data: { closedShort, closedShortReason: reason },
    });
    if (hit.count === 0) { failure = conflict("Someone else changed this line first — reload and try again."); return; }
    await tx.noteEntry.create({
      data: { orderId: id, authorId: user.id, kind: "PO_LINE_CLOSED", text: `${line.description}: ${qty} closed short — ${reason}` },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: ENTITY, entityId: id, action: "po.line-closed",
      diff: { line: { from: null, to: line.description }, closedShort: { from: line.closedShort, to: closedShort } },
      reason, source: "web",
    });
    out = { refNo: po.refNo, remaining: remaining - qty };
  });

  if (failure) return failure;
  revalidatePo(id);
  return ok(out!);
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
