"use server";

import { revalidatePath } from "next/cache";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { prisma } from "@/server/db/client";
import { writeAudit } from "@/server/audit";
import { classifyRowError, RowWriteError, type RowErrorSubject } from "@/lib/row-error";
import { readGrid } from "@/server/import/read-sheet";
import { matchHeaders } from "@/lib/import-assets";
import {
  SUPPLIER_IMPORT_HEADERS, findBankColumns, planSupplierRows, supplierChanges, type SupplierPlan,
} from "@/lib/import-suppliers";
import { groupByCause, type CauseGroup } from "@/lib/import-vocabulary";
import { resolveSupplierRefs } from "./resolve";
import { conflict, forbidden, ok, rateLimited, type ActionResult } from "@/server/action-result";

export interface SupplierPlanResult {
  plan: SupplierPlan;
  groups: CauseGroup[];
  unknownColumns: string[];
}

/**
 * P-1: import audit actions are `import-create`/`import-update` on
 * entityType `vendor` — the same shape `employee-actions.ts` writes for
 * `employee`, never the hand-typed `supplier.created`/`supplier.updated`
 * pair `suppliers/actions.ts`'s own form-driven create/update use. Two
 * surfaces write a Vendor here, and each names its own action so the audit
 * trail can tell an operator's edit apart from a spreadsheet row.
 */
const SUPPLIER_ROW_SUBJECT: RowErrorSubject = {
  unique: "a supplier name already on file",
  fk: "a reference that no longer exists",
};

/**
 * Stage two of three — this importer's own `planEmployeeImport`. WRITES
 * NOTHING: no transaction, no insert, no persisted plan.
 *
 * P-3: the bank-column refusal is FILE-level, checked before header
 * matching even runs — a sheet carrying a bank column is wrong in its
 * entirety (bank details are entered on the supplier's own page, never
 * imported), so this is a `conflict`, never a row cause.
 */
export async function planSupplierImport(form: FormData): Promise<ActionResult<SupplierPlanResult>> {
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

  const bank = findBankColumns(read.header);
  if (bank.length) {
    return conflict(
      `This sheet carries a bank column (${bank.join(", ")}). Bank details are entered on the supplier's ` +
        "page, never imported. Remove the column and re-upload.",
    );
  }

  const headers = matchHeaders(read.header, SUPPLIER_IMPORT_HEADERS);
  if (headers.missing.length) {
    return conflict(
      `That sheet is missing ${headers.missing.length === 1 ? "a column" : "columns"}: ` +
        `${headers.missing.join(", ")}. Nothing was imported.`,
    );
  }

  const refs = await resolveSupplierRefs();
  const plan = planSupplierRows(headers, read.rows, refs);
  const blocked = plan.rows.flatMap((r) => (r.kind === "blocked" ? [r] : []));
  return ok({ plan, groups: groupByCause(blocked), unknownColumns: headers.unknown });
}

/**
 * Stage three — this importer's own `applyEmployeeImport`. Re-plans from
 * the FILE, not the browser's held plan (the same divergence guard); each
 * row is its own transaction, so one row's failure never rolls back another.
 */
export async function applySupplierImport(
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
  const planned = await planSupplierImport(form);
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
          const vendor = await tx.vendor.create({ data: row.data });
          await writeAudit(tx, {
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "vendor",
            entityId: vendor.id,
            action: "import-create",
            diff: { name: { from: null, to: vendor.name } },
          });
          return { kind: "created" as const };
        }

        const before = await tx.vendor.findUnique({ where: { id: row.vendorId } });
        if (!before) throw new RowWriteError("that supplier no longer exists");

        const { diff, changed } = supplierChanges(before as unknown as Record<string, unknown>, row.data);

        if (Object.keys(diff).length === 0) {
          return { kind: "unchanged" as const };
        }

        // Same last-writer-wins guard the asset/employee importers use: the
        // version is read inside THIS row's own transaction, microseconds
        // before the write, so a concurrent edit landing in that gap loses
        // rather than being silently overwritten.
        const written = await tx.vendor.updateMany({
          where: { id: row.vendorId, updatedAt: before.updatedAt },
          data: changed,
        });
        if (written.count === 0) {
          throw new RowWriteError("changed since this import was checked — re-check and retry");
        }
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "vendor",
          entityId: row.vendorId,
          action: "import-update",
          diff,
        });
        return { kind: "updated" as const };
      });

      if (outcome.kind === "created") created += 1;
      else if (outcome.kind === "updated") updated += 1;
      else unchanged += 1;
    } catch (err) {
      failures.push({ row: row.row, reason: classifyRowError(err, row.kind, SUPPLIER_ROW_SUBJECT) });
    }
  }

  revalidatePath("/purchases/suppliers");
  // A dynamic-segment form revalidates every matching `/purchases/suppliers/[id]`
  // page in one call — the same I-2 lesson the employee importer's own
  // `applyEmployeeImport` applies for `/employees/[id]`, and the right shape
  // here since a single apply can touch many different supplier ids.
  revalidatePath("/purchases/suppliers/[id]", "page");
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
