"use server";

import { revalidatePath } from "next/cache";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { prisma } from "@/server/db/client";
import { writeAudit } from "@/server/audit";
import { type AuditDiff } from "@/lib/audit-diff";
import { employeeDiff } from "@/lib/employee-diff";
import { classifyRowError, RowWriteError, type RowErrorSubject } from "@/lib/row-error";
import { readGrid } from "@/server/import/read-sheet";
import { matchHeaders } from "@/lib/import-assets";
import {
  EMPLOYEE_IMPORT_HEADERS, planEmployeeRows, type EmployeePlan, type EmployeeImportOptions,
} from "@/lib/import-employees";
import { groupByCause, optionsFromForm, type CauseGroup } from "@/lib/import-vocabulary";
import { resolveEmployeeRefs } from "./resolve";
import { conflict, forbidden, ok, rateLimited, type ActionResult } from "@/server/action-result";

export interface EmployeePlanResult {
  plan: EmployeePlan;
  groups: CauseGroup[];
  unknownColumns: string[];
}

/**
 * E-9, one layer over the shared vocabulary: the P2002/P2003 wording
 * `classifyRowError` defaults to is asset-shaped ("a tag or serial",
 * "a category, type or vendor") — both false on an employee row, where the
 * unique column is `employeeNo` and the FK that can vanish mid-import is
 * `departmentId`.
 */
const EMPLOYEE_ROW_SUBJECT: RowErrorSubject = {
  unique: "an employee number already on file",
  fk: "a department that no longer exists",
};

/**
 * Stage two of three — the employee importer's own `planAssetImport`.
 * WRITES NOTHING (scope decision 3, unchanged): no transaction, no insert,
 * no persisted plan. Role floor and rate-limit kind mirror the asset
 * importer exactly (`actionRole("admin", "it_staff")`, `import_plan`) —
 * both are already entity-agnostic (`RATE_LIMITS.import_plan`'s own comment
 * never mentions assets specifically), so sharing them is reuse, not a
 * coincidence.
 */
export async function planEmployeeImport(form: FormData): Promise<ActionResult<EmployeePlanResult>> {
  const actor = await actionRole("admin", "it_staff");
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

  const headers = matchHeaders(read.header, EMPLOYEE_IMPORT_HEADERS);
  if (headers.missing.length) {
    return conflict(
      `That sheet is missing ${headers.missing.length === 1 ? "a column" : "columns"}: ` +
        `${headers.missing.join(", ")}. Nothing was imported.`,
    );
  }

  // This importer's own row rule only ever reads ONE of the six shared
  // options — see `EmployeeImportOptions`'s own comment (`import-
  // employees.ts`) for why the narrower slice, rather than the full
  // `Record<ImportOption, boolean>`, is what `planEmployeeRows` takes.
  const options: EmployeeImportOptions = { keepCurrentEmployment: optionsFromForm(form).keepCurrentEmployment };

  const refs = await resolveEmployeeRefs();
  const plan = planEmployeeRows(headers, read.rows, refs, options);
  const blocked = plan.rows.flatMap((r) => (r.kind === "blocked" ? [r] : []));
  return ok({ plan, groups: groupByCause(blocked), unknownColumns: headers.unknown });
}

/**
 * Stage three — the employee importer's own `applyAssetImport`. Re-plans
 * from the FILE, not the browser's held plan (scope decision 8's guard);
 * partial by construction (scope decision 4); each row is its own
 * transaction. The counts returned are always the RE-PLAN's own, so a
 * divergence between Validate and Apply is reported, not papered over — the
 * same `groups` ride-along I-3 (Task 10 round two) added for assets.
 */
export async function applyEmployeeImport(
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
  const planned = await planEmployeeImport(form);
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
  const actor = await actionRole("admin", "it_staff");
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
          const employee = await tx.employee.create({ data: row.data });
          // Scope decision 15: this importer is the only surface that can
          // create an employee already OFFBOARDING/OFFBOARDED — the
          // employee analogue of A-5 (asset import's own status-on-create
          // recording). Named here so the diff can answer "how did this
          // person arrive already mid-offboarding, with no wizard run?" —
          // and `activity.ts`'s `import-create` case surfaces it the same
          // way it already does for a non-SPARE asset.
          const diff: AuditDiff = {
            employeeNo: { from: null, to: employee.employeeNo },
            name: { from: null, to: employee.name },
            employment: { from: null, to: employee.employment },
          };
          if (employee.offboardingAt) diff.offboardingAt = { from: null, to: employee.offboardingAt };
          await writeAudit(tx, {
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "employee",
            entityId: employee.id,
            action: "import-create",
            diff,
          });
          return { kind: "created" as const };
        }

        const before = await tx.employee.findUnique({ where: { id: row.employeeId } });
        if (!before) throw new RowWriteError("that employee no longer exists");

        // `employeeDiff` (`src/lib/employee-diff.ts`) owns the day-precision
        // comparison for `joinedAt` and returns `changed` — `row.data`
        // filtered down to exactly the keys that actually differ — the
        // same C-1 shape `assetDiff` established for assets, shared rather
        // than reinvented.
        const { diff, changed } = employeeDiff(
          before as unknown as Record<string, unknown>,
          row.data as unknown as Record<string, unknown>,
        );

        if (Object.keys(diff).length === 0) {
          return { kind: "unchanged" as const };
        }

        // Same last-writer-wins guard `applyAssetImport` uses: the version
        // is read inside THIS row's own transaction, microseconds before
        // the write, so a concurrent edit landing in that gap loses rather
        // than being silently overwritten.
        const written = await tx.employee.updateMany({
          where: { id: row.employeeId, updatedAt: before.updatedAt },
          data: changed,
        });
        if (written.count === 0) {
          throw new RowWriteError("changed since this import was checked — re-check and retry");
        }
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "employee",
          entityId: row.employeeId,
          action: "import-update",
          diff,
        });
        return { kind: "updated" as const };
      });

      if (outcome.kind === "created") created += 1;
      else if (outcome.kind === "updated") updated += 1;
      else unchanged += 1;
    } catch (err) {
      failures.push({ row: row.row, reason: classifyRowError(err, row.kind, EMPLOYEE_ROW_SUBJECT) });
    }
  }

  revalidatePath("/employees");
  revalidatePath("/employees/activity");
  revalidatePath("/audit");
  // The same I-2 lesson: the first thing anyone does after an import is open
  // one row to check it landed. Next 15's dynamic-segment form revalidates
  // every matching page in one call.
  revalidatePath("/employees/[id]", "page");
  revalidatePath("/employees/[id]/timeline", "page");
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
