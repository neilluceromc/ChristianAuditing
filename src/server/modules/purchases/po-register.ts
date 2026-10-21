"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type AssetClass } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { notify } from "@/server/notifications/notify";
import { lockPo } from "./po-lock";
import { DEFAULT_STATUS } from "@/lib/asset-class";
import { canRegisterLine, lineProgress, type PoState } from "@/lib/po-flow";
import { moneyForAsset } from "@/lib/po-money";
import { identifierWhere } from "@/lib/inventory-list";
import { WARRANTY_COVERED_BY } from "@/lib/purchase-summary";
import { MAX_BATCH } from "@/lib/register-rows";
import { TYPE_REQUIRED } from "@/lib/register-type";
import { serialRequired } from "@/lib/serial-rules";
import { TAG_RULE, TAG_SHAPE } from "@/lib/tag-key";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/*
 * Register from a purchase order (spec §4 ways 1 and 2, "Partial deliveries"). IT registers a PO's IT lines, Purchasing
 * its other lines (canRegisterLine); an admin either. Each submit is one registration group — one PurchaseRecord — that
 * reaches Finance on its own and rings Finance's bell once. The units per line may be fewer than the line's quantity:
 * the rest registers later, or is closed short.
 *
 * Everything that decides is read inside the transaction AFTER `SELECT … FOR UPDATE` on the PO row (lockPo, the lock
 * every PO action takes): two people registering the last units of a line at once serialise, and the second re-reads
 * what is left (Review Focus 1). Every refusal sits above the first write, so a refused submit writes nothing.
 */

const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);
const toDate = (s: string | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

const unitSchema = z.object({
  tag: z.string().trim().toUpperCase().regex(TAG_SHAPE, TAG_RULE),
  serial: z.string().trim().max(120).optional(),
});

const lineSchema = z.object({
  lineId: z.string().min(1),
  /** Required only when the line has no category (an old request's unit); otherwise it must be the line's own. */
  categoryId: z.string().optional(),
  typeId: z.string().optional(),
  brand: z.string().trim().max(60).optional(),
  model: z.string().trim().min(2, "Name the model").max(120),
  warrantyUntil: dateStr.optional(),
  warrantyCoveredBy: z.union([z.literal(""), z.enum(WARRANTY_COVERED_BY)]).optional(),
  warrantyContact: z.string().trim().max(160).optional(),
  units: z.array(unitSchema).min(1, "Register at least one unit").max(MAX_BATCH),
});

const registerSchema = z.object({
  poId: z.string().min(1),
  lines: z.array(lineSchema).min(1, "Pick a line to register").max(50),
});

type Registered = { created: number; purchaseRecordId: string; ids: string[] };

const plural = (n: number, word: string) => `${n} ${word}`;

/** "3 laptops" for one line, "5 items" for several — the Finance bell's batch title (spec §7: one notification). */
function batchSummary(parts: Array<{ description: string; n: number }>): string {
  if (parts.length === 1) return plural(parts[0].n, parts[0].description);
  return plural(parts.reduce((s, p) => s + p.n, 0), "items");
}

export async function registerFromPurchaseOrder(input: unknown): Promise<ActionResult<Registered>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  // ---- the submit on its own: one entry per line, no tag or serial twice, at most one batch ----
  const errors: Record<string, string> = {};
  const lineIds = d.lines.map((l) => l.lineId);
  const twiceLine = lineIds.findIndex((id, i) => lineIds.indexOf(id) !== i);
  if (twiceLine >= 0) errors[`lines.${twiceLine}.lineId`] = "This line is listed twice";
  const total = d.lines.reduce((s, l) => s + l.units.length, 0);
  if (total > MAX_BATCH) errors.lines = `Register at most ${MAX_BATCH} units at a time`;
  const seenTags = new Set<string>();
  const seenSerials = new Set<string>();
  d.lines.forEach((l, i) => l.units.forEach((u, j) => {
    if (seenTags.has(u.tag)) errors[`lines.${i}.units.${j}.tag`] = `Row ${j + 1} · ${u.tag} appears twice in this batch`;
    seenTags.add(u.tag);
    const s = u.serial ?? "";
    if (s && seenSerials.has(s)) errors[`lines.${i}.units.${j}.serial`] = `Row ${j + 1} · serial ${s} appears twice in this batch`;
    if (s) seenSerials.add(s);
  }));
  if (Object.keys(errors).length) return validationError(errors);

  let out: Registered | null = null;
  let failure: ActionResult<Registered> | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // Lock first: the state, the lines and above all what is left on them must not move under this submit.
      await lockPo(tx, d.poId);
      const po = await tx.purchaseOrder.findUnique({
        where: { id: d.poId },
        select: { id: true, refNo: true, state: true, vendorId: true, invoiceRef: true, receiptRef: true, purchasedAt: true },
      });
      if (!po) { failure = conflict("That purchase order no longer exists."); return; }
      const state = po.state as PoState;
      if (state === "SENT_BACK" || state === "CANCELLED") {
        const v = canRegisterLine(user.role, "IT", state);
        failure = conflict(v.ok ? `${po.refNo} can't be registered now.` : v.why);
        return;
      }

      // Every line of the PO, not only the submitted ones: whether the PO leaves IT's queue depends on all of them.
      const allLines = await tx.purchaseOrderLine.findMany({
        where: { orderId: po.id },
        select: { id: true, description: true, categoryId: true, qty: true, unitPrice: true, closedShort: true },
      });
      const lineById = new Map(allLines.map((l) => [l.id, l]));
      if (lineIds.some((id) => !lineById.has(id))) {
        failure = conflict("This purchase order changed elsewhere — reload and try again.");
        return;
      }

      // ---- category and class per line: the line's own, or (an old unit) the one picked here ----
      const catIds = [...new Set([
        ...allLines.map((l) => l.categoryId),
        ...d.lines.map((l) => l.categoryId),
      ].filter((x): x is string => !!x))];
      const cats = await tx.assetCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, cls: true } });
      const catById = new Map(cats.map((c) => [c.id, c]));
      const plan: Array<{ categoryId: string; cls: AssetClass } | null> = d.lines.map((l, i) => {
        const line = lineById.get(l.lineId)!;
        const own = line.categoryId ? catById.get(line.categoryId) : undefined;
        if (line.categoryId && l.categoryId && l.categoryId !== line.categoryId) {
          errors[`lines.${i}.categoryId`] = `This line is ${own?.name ?? "another category"}`;
          return null;
        }
        const id = line.categoryId ?? l.categoryId;
        if (!id) { errors[`lines.${i}.categoryId`] = "Pick a category"; return null; }
        const cat = catById.get(id);
        if (!cat) { errors[`lines.${i}.categoryId`] = "Unknown category"; return null; }
        const v = canRegisterLine(user.role, cat.cls, state);
        if (!v.ok) { errors[`lines.${i}`] = v.why; return null; }
        return { categoryId: cat.id, cls: cat.cls };
      });
      // One submit, one class — except for an admin, who is every party.
      const classes = new Set(plan.filter((p) => p !== null).map((p) => p.cls));
      if (user.role !== "admin" && classes.size > 1) errors.lines = "Register IT gear and other items separately";

      // ---- type (a category with types needs one) and serials (every IT unit) ----
      for (const [i, l] of d.lines.entries()) {
        const p = plan[i];
        if (!p) continue;
        if (l.typeId) {
          const type = await tx.assetType.findUnique({ where: { id: l.typeId }, select: { categoryId: true } });
          if (!type || type.categoryId !== p.categoryId) errors[`lines.${i}.typeId`] = "That type doesn't belong to the chosen category";
        } else if ((await tx.assetType.count({ where: { categoryId: p.categoryId } })) > 0) {
          errors[`lines.${i}.typeId`] = TYPE_REQUIRED;
        }
        if (serialRequired(p.cls)) {
          l.units.forEach((u, j) => {
            if (!u.serial) errors[`lines.${i}.units.${j}.serial`] = `Row ${j + 1} · ${u.tag} needs a serial`;
          });
        }
      }

      // ---- what is left on each line, re-read under the lock ----
      const done = await tx.asset.groupBy({
        by: ["purchaseOrderLineId"], where: { purchaseOrderLineId: { in: allLines.map((l) => l.id) } }, _count: { _all: true },
      });
      const registeredOn = new Map(done.map((g) => [g.purchaseOrderLineId, g._count._all]));
      for (const [i, l] of d.lines.entries()) {
        const line = lineById.get(l.lineId)!;
        const { remaining } = lineProgress({ qty: line.qty, registered: registeredOn.get(line.id) ?? 0, closedShort: line.closedShort });
        if (l.units.length > remaining) errors[`lines.${i}.units`] = `Only ${remaining} left to register on this line`;
      }

      // ---- tags and serials already in the register, scoped to the class (identifierWhere, as registerAssets) ----
      for (const cls of classes) {
        const mine = d.lines.flatMap((l, i) => (plan[i]?.cls === cls ? l.units.map((u, j) => ({ i, j, u })) : []));
        const where = identifierWhere(cls, mine.map((m) => m.u.tag), mine.flatMap((m) => (m.u.serial ? [m.u.serial] : [])));
        const [tagsTaken, serialsTaken] = await Promise.all([
          tx.asset.findMany({ where: where.tags, select: { tag: true } }),
          tx.asset.findMany({ where: where.serials, select: { serial: true, tag: true } }),
        ]);
        const takenTag = new Set(tagsTaken.map((a) => a.tag));
        const serialOn = new Map(serialsTaken.map((a) => [a.serial, a.tag]));
        for (const { i, j, u } of mine) {
          if (takenTag.has(u.tag)) errors[`lines.${i}.units.${j}.tag`] = `Row ${j + 1} · ${u.tag} is already registered`;
          if (u.serial && serialOn.has(u.serial)) errors[`lines.${i}.units.${j}.serial`] = `Serial ${u.serial} is already on ${serialOn.get(u.serial)}`;
        }
      }

      if (Object.keys(errors).length) { failure = validationError(errors); return; }

      /*
       * Controller ruling (Task 5 fix round 1): a WITH_IT PO leaves IT's queue for READY only when IT's part is done —
       * (a) this submit registers at least one IT unit (IT registering is IT's check), or (b) after it, no line whose
       * class is IT or still unknown (an old unit with no category) has units left. Purchasing registering the chairs
       * of a mixed PO first leaves it WITH_IT, so IT still sees its laptops to check.
       */
      function leavesIt(): boolean {
        if (classes.has("IT")) return true;
        const adding = new Map(d.lines.map((l) => [l.lineId, l.units.length]));
        return allLines.every((line) => {
          const cls = line.categoryId ? catById.get(line.categoryId)?.cls ?? null : null;
          if (cls === "PURCHASING") return true;
          const registered = (registeredOn.get(line.id) ?? 0) + (adding.get(line.id) ?? 0);
          return lineProgress({ qty: line.qty, registered, closedShort: line.closedShort }).remaining === 0;
        });
      }

      // ---- writes (every refusal is above this line) ----
      const now = new Date();
      const next: PoState = state === "WITH_IT" && leavesIt() ? "READY" : state;
      const hit = await tx.purchaseOrder.updateMany({ where: { id: po.id, state }, data: { state: next, updatedAt: now } });
      if (hit.count === 0) { failure = conflict("Someone else changed this purchase order first — reload and try again."); return; }

      // One registration group. Its class is the submit's (an admin's mixed submit files under IT, whose Labels
      // queue it lands in first); its unit cost is the line's price when one line is registered, as copyPoMoney keeps it.
      const recordCls: AssetClass = classes.has("IT") ? "IT" : "PURCHASING";
      const single = d.lines.length === 1 ? lineById.get(d.lines[0].lineId)! : null;
      const record = await tx.purchaseRecord.create({
        data: {
          purchaseOrderId: po.id, cls: recordCls, quantity: total,
          vendorId: po.vendorId, invoiceRef: po.invoiceRef, receiptRef: po.receiptRef, purchasedAt: po.purchasedAt,
          unitCost: single ? single.unitPrice : null, fees: null, createdById: user.id,
        },
      });

      const ids: string[] = [];
      let sum = 0;
      for (const [i, l] of d.lines.entries()) {
        const line = lineById.get(l.lineId)!;
        const { categoryId, cls } = plan[i]!;
        const it = cls === "IT";
        for (const u of l.units) {
          const asset = await tx.asset.create({
            data: {
              ...moneyForAsset(po, line),
              tag: u.tag,
              serial: u.serial ? u.serial : null,
              model: l.model,
              brand: l.brand ? l.brand : null,
              categoryId,
              typeId: l.typeId ? l.typeId : null,
              cls,
              status: DEFAULT_STATUS[cls],
              warrantyUntil: toDate(l.warrantyUntil),
              warrantyCoveredBy: l.warrantyCoveredBy ? l.warrantyCoveredBy : null,
              warrantyContact: l.warrantyContact ? l.warrantyContact : null,
              purchaseOrderId: po.id,
              purchaseOrderLineId: line.id,
              purchaseRecordId: record.id,
              // IT registering IT gear is IT's check (spec §4 way 1); a non-IT item never carries the stamp.
              itVerifiedAt: it ? now : null,
              itVerifiedById: it ? user.id : null,
            },
            select: { id: true, tag: true },
          });
          ids.push(asset.id);
          sum += Number(line.unitPrice ?? 0);
          await writeAudit(tx, {
            actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id, action: "register",
            diff: { tag: { from: null, to: asset.tag }, status: { from: null, to: DEFAULT_STATUS[cls] } },
            source: "web",
          });
        }
      }

      // The group's own entry, as a direct registration writes one: the asset's Financial history reads it.
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "purchase-record", entityId: record.id, action: "purchase.recorded",
        diff: { quantity: { from: null, to: total }, total: { from: null, to: sum.toFixed(2) } },
        source: "web",
      });

      const parts = d.lines.map((l) => ({ description: lineById.get(l.lineId)!.description, n: l.units.length }));
      const progress = d.lines.map((l) => {
        const line = lineById.get(l.lineId)!;
        const after = (registeredOn.get(line.id) ?? 0) + l.units.length;
        return `${plural(l.units.length, line.description)} (${after} of ${line.qty})`;
      });
      await tx.noteEntry.create({
        data: { orderId: po.id, authorId: user.id, kind: "PO_REGISTERED", text: `Registered ${progress.join(", ")}.` },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "purchase-order", entityId: po.id, action: "po.register",
        diff: {
          ...(next !== state ? { state: { from: state, to: next } } : {}),
          registered: { from: null, to: total },
          group: { from: null, to: record.id },
        },
        source: "web",
      });
      await notify(tx, {
        team: "FINANCE", kind: "TO_CHECK", title: `${po.refNo} · ${batchSummary(parts)} registered, ready to check`,
        href: `/finance/review/${record.id}`, actorId: user.id, actorRole: user.role,
        entityType: "purchase-order", entityId: po.id,
      });

      out = { created: ids.length, purchaseRecordId: record.id, ids };
    }, {
      // 200 units × (one create + one audit) can outrun Prisma's 5 s default, as in registerAssets.
      timeout: 60_000, maxWait: 10_000,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // A tag or serial taken between the check and the write, in the other class or by a racing submit.
      const target = (e.meta as { target?: string[] | string } | undefined)?.target;
      const t = Array.isArray(target) ? target.join(",") : String(target ?? "");
      return conflict(t.includes("serial")
        ? "One of those serials was just registered. Reload and try again."
        : "One of those tags was just taken. Reload and try again.");
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw e;
  }

  if (failure) return failure;
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${d.poId}`);
  revalidatePath(`/purchases/${d.poId}/register`);
  revalidatePath("/inventory");
  revalidatePath("/inventory/labels");
  revalidatePath("/finance/assets");
  revalidatePath("/audit");
  return ok(out!);
}
