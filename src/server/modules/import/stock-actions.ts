"use server";

import { revalidatePath } from "next/cache";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { prisma } from "@/server/db/client";
import { writeAudit } from "@/server/audit";
import { diffOf } from "@/lib/audit-diff";
import { classifyRowError, RowWriteError, type RowErrorSubject } from "@/lib/row-error";
import { readGrid } from "@/server/import/read-sheet";
import { matchHeaders } from "@/lib/import-assets";
import { STOCK_IMPORT_HEADERS, planStockRows, type StockPlan } from "@/lib/import-stock";
import { formatStockCode, parseStockCode } from "@/lib/stock-code";
import { signedQuantity } from "@/lib/stock-movement-rules";
import { groupByCause, type CauseGroup } from "@/lib/import-vocabulary";
import { resolveStockRefs } from "./resolve";
import { conflict, forbidden, ok, rateLimited, type ActionResult } from "@/server/action-result";

export interface StockPlanResult {
  plan: StockPlan;
  groups: CauseGroup[];
  unknownColumns: string[];
}

/**
 * P-1: import audit actions are `import-create`/`import-update` on
 * entityType `stock-item` — the same shape `supplier-actions.ts` writes for
 * `vendor`. Two surfaces write a StockItem (the manual create/edit forms in
 * `item-actions.ts`, and this importer), and each names its own action so
 * the audit trail can tell an operator's edit apart from a spreadsheet row.
 */
const STOCK_ROW_SUBJECT: RowErrorSubject = {
  unique: "an item code already on file",
  fk: "a category that no longer exists",
};

/**
 * Stage two of three — this importer's own `planSupplierImport`. WRITES
 * NOTHING: no transaction, no insert, no persisted plan.
 */
export async function planStockImport(form: FormData): Promise<ActionResult<StockPlanResult>> {
  const actor = await actionRole("admin", "purchasing_staff");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id, "import_plan");
  if (!rate.allowed) {
    return rateLimited(
      rate.retryAfterSec,
      `You've checked ${RATE_LIMITS.import_plan.limit} files this minute — the cap. Nothing was ` +
        "imported and nothing was changed; checking a file only reads it.",
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) return conflict("No file was uploaded.");

  const read = await readGrid(file);
  if (!read.ok) return conflict(read.reason);

  const headers = matchHeaders(read.header, STOCK_IMPORT_HEADERS);
  if (headers.missing.length) {
    return conflict(
      `That sheet is missing ${headers.missing.length === 1 ? "a column" : "columns"}: ` +
        `${headers.missing.join(", ")}. Nothing was imported.`,
    );
  }

  const refs = await resolveStockRefs();
  const plan = planStockRows(headers, read.rows, refs);
  const blocked = plan.rows.flatMap((r) => (r.kind === "blocked" ? [r] : []));
  return ok({ plan, groups: groupByCause(blocked), unknownColumns: headers.unknown });
}

/**
 * Stage three — this importer's own `applySupplierImport`. Re-plans from the
 * FILE, not the browser's held plan (the same divergence guard); each row is
 * its own transaction, so one row's failure never rolls back another.
 *
 * Spec §5.2/§6: a CREATE with an explicit code raises the category's series
 * counter to at least one past that code (`GREATEST`, never a plain
 * decrement-proof subtraction — a sheet naming OS-0009 while the counter is
 * still at 6 must leave the NEXT manual create at OS-0010, not silently
 * mint OS-0007 later and collide); a CREATE with no code takes the next
 * number from that same series, the exact `UPDATE … RETURNING` row lock
 * `createStockItem` (`item-actions.ts`) uses, so two concurrent creates —
 * one from this importer, one from the manual form — can never mint the
 * same code.
 */
export async function applyStockImport(
  form: FormData,
): Promise<
  ActionResult<{
    created: number;
    updated: number;
    unchanged: number;
    skipped: number;
    failed: number;
    failures: { row: number; reason: string }[];
    groups: CauseGroup[];
  }>
> {
  const planned = await planStockImport(form);
  if (!planned.ok) {
    if (planned.kind === "rate_limited") {
      return rateLimited(
        planned.retryAfterSec ?? 0,
        `You've checked ${RATE_LIMITS.import_plan.limit} files this minute — the cap. Applying re-checks ` +
          "the file first, so nothing from it has been written; wait a moment and try Apply again.",
      );
    }
    return planned;
  }
  const actor = await actionRole("admin", "purchasing_staff");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id, "import");
  if (!rate.allowed) {
    return rateLimited(
      rate.retryAfterSec,
      `You've run ${RATE_LIMITS.import.limit} imports this minute — the cap. Nothing from this file ` +
        "has been written.",
    );
  }

  const { plan, groups } = planned.data;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const failures: { row: number; reason: string }[] = [];

  for (const row of plan.rows) {
    if (row.kind === "blocked") continue;
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        if (row.kind === "create") {
          const d = row.data;
          let code = d.code;
          if (code) {
            // An explicit code: raise the series past it so a LATER manual
            // create (or a later import) never mints a code this file just
            // claimed. `GREATEST`, not a plain increment — a code below the
            // current counter (re-importing an old export, say) must never
            // move it BACKWARD.
            const parsed = parseStockCode(code)!;
            await tx.$executeRaw`UPDATE "StockCategory" SET "nextNumber" = GREATEST("nextNumber", ${parsed.n + 1}) WHERE "id" = ${d.categoryId}`;
          } else {
            const rows = await tx.$queryRaw<[{ nextNumber: number }]>`UPDATE "StockCategory" SET "nextNumber" = "nextNumber" + 1 WHERE "id" = ${d.categoryId} RETURNING "nextNumber"`;
            if (!rows.length) throw new RowWriteError(`names ${STOCK_ROW_SUBJECT.fk}`);
            code = formatStockCode(d.prefix, rows[0].nextNumber - 1);
          }
          const item = await tx.stockItem.create({
            data: {
              code, name: d.name, unit: d.unit, packSize: d.packSize, reorderLevel: d.reorderLevel,
              notes: d.notes, categoryId: d.categoryId,
            },
          });
          if (d.openingQty > 0) {
            await tx.stockMovement.create({
              data: {
                itemId: item.id, kind: "OPENING", quantity: signedQuantity("OPENING", d.openingQty),
                actorId: actor.id, reason: "Opening stock (import)", occurredAt: new Date(),
              },
            });
          }
          await writeAudit(tx, {
            actorId: actor.id, actorLabel: actor.name, entityType: "stock-item", entityId: item.id,
            action: "import-create", diff: { code: { from: null, to: item.code }, name: { from: null, to: item.name } },
          });
          return { kind: "created" as const, itemId: item.id };
        }

        const before = await tx.stockItem.findUnique({ where: { id: row.itemId } });
        if (!before) throw new RowWriteError("that item no longer exists");

        const diff = diffOf(before as unknown as Record<string, unknown>, row.data);
        if (Object.keys(diff).length === 0) {
          return { kind: "unchanged" as const, itemId: row.itemId };
        }

        // Same last-writer-wins guard every other importer's apply uses: the
        // version is read inside THIS row's own transaction, microseconds
        // before the write, so a concurrent edit landing in that gap loses
        // rather than being silently overwritten.
        const written = await tx.stockItem.updateMany({
          where: { id: row.itemId, updatedAt: before.updatedAt },
          data: row.data,
        });
        if (written.count === 0) {
          throw new RowWriteError("changed since this import was checked — re-check and retry");
        }
        await writeAudit(tx, {
          actorId: actor.id, actorLabel: actor.name, entityType: "stock-item", entityId: row.itemId,
          action: "import-update", diff,
        });
        return { kind: "updated" as const, itemId: row.itemId };
      });

      if (outcome.kind === "created") created += 1;
      else if (outcome.kind === "updated") updated += 1;
      else unchanged += 1;
    } catch (err) {
      failures.push({ row: row.row, reason: classifyRowError(err, row.kind, STOCK_ROW_SUBJECT) });
    }
  }

  revalidatePath("/stock");
  // A dynamic-segment form revalidates every matching `/stock/items/[id]`
  // page in one call — the same shape the supplier importer's own
  // `applySupplierImport` uses, and the right one here since a single apply
  // can touch many different item ids.
  revalidatePath("/stock/items/[id]", "page");
  revalidatePath("/audit");
  return ok({
    created,
    updated,
    unchanged,
    skipped: plan.counts.blocked,
    failed: failures.length,
    failures,
    groups,
  });
}
