"use server";

import { revalidatePath } from "next/cache";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { prisma } from "@/server/db/client";
import { writeAudit } from "@/server/audit";
import { type AuditDiff } from "@/lib/audit-diff";
import { assetDiff } from "@/lib/asset-diff";
import { classifyRowError, RowWriteError } from "@/lib/row-error";
import { readGrid } from "@/server/import/read-sheet";
import {
  cellText, matchHeaders, planAssetRows, type AssetPlan,
} from "@/lib/import-assets";
import { groupByCause, optionsFromForm, type CauseGroup } from "@/lib/import-vocabulary";
import { resolveAssetRefs } from "./resolve";
import { conflict, forbidden, ok, rateLimited, type ActionResult } from "@/server/action-result";

export interface PlanResult {
  plan: AssetPlan;
  groups: CauseGroup[];
  unknownColumns: string[];
}

/**
 * Stage two of three, and it WRITES NOTHING (scope decision 3): no
 * transaction is opened, no row is inserted, no plan is persisted. The whole
 * verdict is computed and handed back to the browser — this dry run IS the
 * apply's input, which is what makes the operator's verdict and the write
 * unable to disagree. T10 re-validates every row it is given, so a tampered
 * plan cannot make it write something this dry run refused (scope decision
 * 8).
 *
 * `actionRole("admin", "it_staff")` matches every sibling inventory action
 * (`createAsset`, `updateAsset`, the bulk actions) — `actionRole(...roles)`
 * is a SET, not a floor, so `actionRole("it_staff")` alone would refuse
 * `admin`, the role that runs this app.
 *
 * `checkRate(actor.id, "import_plan")` (R-2, round 2): this READ-ONLY stage
 * gets its own kind, not the write's `import` (10/min) — a dry run costs
 * ~15ms of queries and writes nothing, so it doesn't need the budget that
 * bounds a call writing 2,000 assets plus 2,000 audit rows, and sharing it
 * could strand an operator holding a fully-planned import they can't yet
 * apply. The refusal message is also overridden: the default sentence
 * hardcodes "60 changes" (wrong number here even before this fix — the old
 * shared cap was 10) and "this form still holds your input" (a `<input
 * type="file">` is never repopulated by any browser) — neither half of the
 * default sentence survives on this path.
 */
export async function planAssetImport(form: FormData): Promise<ActionResult<PlanResult>> {
  const actor = await actionRole("admin", "it_staff");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id, "import_plan");
  if (!rate.allowed) {
    // The cap is INTERPOLATED, never retyped. The defect this override exists
    // to fix was a hardcoded "60 changes" in the shared default that had
    // stopped being true; writing 60 here by hand reproduces it one layer over,
    // and tuning `import_plan` would make this sentence lie (§6a rules 16, 26).
    // Note what this does NOT promise: nothing about the file still being
    // selected. Whether the wizard survives a refusal with its file intact is
    // T11's to guarantee, and a claim here would be a promise about a UI that
    // does not exist yet.
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

  const headers = matchHeaders(read.header);
  if (headers.missing.length) {
    // Refuse before planning, all missing columns named at once — otherwise
    // a sheet with no Category column produces one identical block per row
    // instead of one refusal.
    return conflict(
      `That sheet is missing ${headers.missing.length === 1 ? "a column" : "columns"}: ` +
        `${headers.missing.join(", ")}. Nothing was imported.`,
    );
  }

  const tagAt = headers.map.get("tag")!;
  const serialAt = headers.map.get("serial");
  const tags = read.rows.map((r) => cellText(r[tagAt])).filter(Boolean);
  const serials = serialAt === undefined ? [] : read.rows.map((r) => cellText(r[serialAt])).filter(Boolean);

  const refs = await resolveAssetRefs(tags, serials);
  const plan = planAssetRows(headers, read.rows, refs, optionsFromForm(form));
  const blocked = plan.rows.flatMap((r) => (r.kind === "blocked" ? [r] : []));
  return ok({ plan, groups: groupByCause(blocked), unknownColumns: headers.unknown });
}

/**
 * Stage three. Takes the FILE again — not the plan the browser is holding —
 * and re-plans before writing (scope decision 8's guard): the browser's plan
 * is what the operator SAW; this is what gets written, and the two agree
 * because the same pure function produced both. Nothing from the payload
 * except the two boolean-shaped option flags reaches the database, so a
 * tampered plan cannot widen what this writes.
 *
 * Partial by construction (scope decision 4): blocked rows are skipped, and
 * each applied row is its OWN transaction, so its write and its audit entry
 * land together or not at all, and one bad row does not roll back the other
 * 1,999.
 *
 * An accepted divergence (recorded, not fixed): re-planning at apply time
 * means the world can move between Validate and Apply — someone creates the
 * missing category, edits an asset — so the write can legitimately differ
 * from the verdict the operator approved a moment earlier. The counts this
 * returns are always the RE-PLAN's own — never an echo of what the browser
 * was holding — so a divergence is reported, not silently papered over. I-3
 * (Task 10 round two): counts alone still can't explain a mass-block
 * divergence (e.g. every row blocking because a category vanished between
 * Validate and Apply, with no way to learn why) — `groups`, the SAME
 * `CauseGroup[]` this re-plan computed for the dry run, rides along too.
 */
export async function applyAssetImport(
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
  const planned = await planAssetImport(form);
  if (!planned.ok) {
    // M-4 (Task 10 round two): forwarding `planned` verbatim would hand the
    // operator the DRY RUN's own refusal — "checking a file only reads it"
    // — on the APPLY button, whenever `import_plan` (60/min) is what's
    // exhausted. This re-plan spends that same kind, so the refusal is
    // real; the sentence just needs to say so on the button that was
    // actually clicked, not repeat the Check button's wording. Every other
    // refusal from `planAssetImport` (no file, missing columns, ...) is
    // unaffected by apply-time state and is left exactly as `planAssetImport`
    // phrased it.
    if (planned.kind === "rate_limited") {
      return rateLimited(
        planned.retryAfterSec ?? 0,
        `You've checked ${RATE_LIMITS.import_plan.limit} files this minute — the cap. Applying re-checks ` +
          "the file first, so nothing from it has been written; wait a moment and try Apply again.",
      );
    }
    return planned;
  }
  // `planAssetImport` already gated the role — re-reading the actor here
  // rather than trusting a role captured a moment ago keeps this call's own
  // permission check live, and `actionRole("admin", "it_staff")` matches
  // every sibling inventory write (`createAsset`, `updateAsset`):
  // `actionRole(...roles)` is a SET membership test, not a floor, so
  // `actionRole("it_staff")` alone would lock out the role that runs this
  // app (A-2).
  const actor = await actionRole("admin", "it_staff");
  if (!actor) return forbidden();
  // A-1: `planAssetImport` spends `import_plan` (60/min, read-only) — the
  // brief's own `import` (10/min) kind was being spent by NOTHING, so the
  // stage that writes up to 2,000 assets plus 2,000 audit rows was bounded
  // only by the dry run's generous cap. Checked AFTER the re-plan succeeds
  // and BEFORE the first write, so a refusal here is truthfully "the file
  // was read again, but nothing from it was written" — never "60 changes",
  // the shared default's wrong number on this path.
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
      // I-1 (Task 10 round two): the outcome is RETURNED from the callback
      // and counted only once `$transaction` has resolved — i.e. after the
      // COMMIT actually succeeded. Incrementing a counter inside the
      // callback (the pre-fix shape) counts a row whose commit then fails
      // (P2028 timeout, pool hiccup, connection reset) as BOTH that outcome
      // AND a failure below, so created+updated+unchanged+skipped+failed
      // can exceed the row count — the exact "number that does not add up"
      // A-6 exists to prevent, arriving through a narrower door.
      // `createAsset` (`inventory/actions.ts`) shows the pattern: return the
      // outcome, switch on it after it resolves.
      const outcome = await prisma.$transaction(async (tx) => {
        if (row.kind === "create") {
          const asset = await tx.asset.create({ data: row.data });
          // A-5: `createAsset` can hardcode tag/model/status as a from-null
          // because `creationPlan` guarantees SPARE-only direct creation.
          // Import cannot: scope decision 13 lets an import create an asset
          // already DEPLOYED to a holder, the one surface in this app that
          // can, and an audit trail that omits it cannot answer "how did
          // this asset reach DEPLOYED with no approval?" — the question
          // that decision guarantees someone will eventually ask.
          const diff: AuditDiff = {
            tag: { from: null, to: asset.tag },
            model: { from: null, to: asset.model },
            status: { from: null, to: asset.status },
          };
          if (asset.assigneeId) diff.assigneeId = { from: null, to: asset.assigneeId };
          await writeAudit(tx, {
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "asset",
            entityId: asset.id,
            action: "import-create",
            diff,
          });
          return { kind: "created" as const };
        }

        const before = await tx.asset.findUnique({ where: { id: row.assetId } });
        if (!before) throw new RowWriteError("that asset no longer exists");

        // C-1 (Task 10 round two) + A-3/A-4: `assetDiff` (`src/lib/asset-diff.ts`)
        // owns the day-precision and cost-string comparison normalisations
        // AND returns `changed` — `row.data` filtered down to exactly the
        // keys that actually differ. The pre-fix code took only HALF of
        // `updateAsset`'s two-clause comment ("compare at day precision, AND
        // write ONLY the changed fields") — it compared correctly but then
        // wrote `row.data`, the WHOLE patch, so an edited re-import of a
        // time-of-day row (every seeded asset carries one) silently
        // truncated the untouched sibling date column to midnight with no
        // audit entry, into a table a DB trigger makes append-only.
        const { diff, changed } = assetDiff(
          before as unknown as Record<string, unknown>,
          row.data as unknown as Record<string, unknown>,
        );

        // A-3: the diff is computed FIRST, against what this row would
        // actually write — not discovered after the fact by re-reading the
        // row post-write. A clean re-upload's patch matches the stored row
        // exactly, `diff` comes back empty, and NOTHING is written: no
        // `updateMany`, no bumped `updatedAt`, no audit row. Skipping this
        // would mean `updatedAt` — which drives "recently changed" reads —
        // silently floats every asset in a re-uploaded file to the top,
        // with an empty diff and so no trail explaining why (the exact
        // defect this task exists to close). Counted separately as
        // `unchanged`: "nothing needed doing" is a real, common verdict the
        // operator should see, not work.
        if (Object.keys(diff).length === 0) {
          return { kind: "unchanged" as const };
        }

        // Guarded on `updatedAt`, which `@updatedAt` always moves — this is
        // LAST-WRITER-WINS with the diff computed at write time, not the
        // optimistic-concurrency contract (§6a rules 21/29/30) that name a
        // client-supplied version token: the version is read inside this
        // same row's own transaction, microseconds before the write, so an
        // edit landing in that gap loses rather than being silently
        // overwritten — a real guard, just not that particular contract.
        const written = await tx.asset.updateMany({
          where: { id: row.assetId, updatedAt: before.updatedAt },
          data: changed,
        });
        if (written.count === 0) {
          throw new RowWriteError("changed since this import was checked — re-check and retry");
        }
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "asset",
          entityId: row.assetId,
          action: "import-update",
          diff,
        });
        return { kind: "updated" as const };
      });

      if (outcome.kind === "created") created += 1;
      else if (outcome.kind === "updated") updated += 1;
      else unchanged += 1;
    } catch (err) {
      // A-6: the sheet row number (carried on the verdict) and a classified,
      // actionable reason — never swallowed into a total that doesn't add up.
      // I-4: `row.kind` ("create" | "update" here — "blocked" rows already
      // `continue`d above) tells `classifyRowError` whether a P2002 on this
      // row could be a concurrent double-click racing itself (only possible
      // on create — both calls plan CREATE for the same tag) so it can name
      // that possibility instead of asserting the wrong cause.
      failures.push({ row: row.row, reason: classifyRowError(err, row.kind) });
    }
  }

  revalidatePath("/inventory");
  // `/inventory/activity` is its own route — `revalidatePath("/inventory")`
  // does not cover it, and it's exactly where these new entries are meant
  // to show up.
  revalidatePath("/inventory/activity");
  revalidatePath("/audit");
  // I-2: the first thing anyone does after an import is open one row to
  // check it landed — exactly `/inventory/[id]` and its `/history` tab,
  // neither revalidated before (unlike `updateAsset` and
  // `completeOffboarding`, which do this per asset). Per-asset
  // `revalidatePath` calls are wrong at up to 2,000 rows; Next 15's
  // dynamic-segment form revalidates every matching page in one call.
  revalidatePath("/inventory/[id]", "page");
  revalidatePath("/inventory/[id]/history", "page");
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
