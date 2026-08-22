"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { prisma } from "@/server/db/client";
import { writeAudit } from "@/server/audit";
import { diffOf, type AuditDiff } from "@/lib/audit-diff";
import { readGrid } from "@/server/import/read-sheet";
import {
  cellText, matchHeaders, planAssetRows, type AssetPlan, type AssetUpdatePatch, type ImportOptions,
} from "@/lib/import-assets";
import { groupByCause, IMPORT_OPTIONS, type CauseGroup } from "@/lib/import-vocabulary";
import { resolveAssetRefs } from "./resolve";
import { conflict, forbidden, ok, rateLimited, type ActionResult } from "@/server/action-result";

export interface PlanResult {
  plan: AssetPlan;
  groups: CauseGroup[];
  unknownColumns: string[];
}

/**
 * Folds over `IMPORT_OPTIONS` rather than hand-listing the five keys: a
 * hand-written literal silently reads a forgotten key as `false`, and the
 * failure is invisible to the operator — the row just stays blocked and they
 * assume their file is still wrong. Folding means a sixth option added to
 * `IMPORT_OPTIONS` is read here automatically.
 */
function optionsFrom(form: FormData): ImportOptions {
  const out = {} as ImportOptions;
  for (const key of IMPORT_OPTIONS) out[key] = form.get(key) === "1";
  return out;
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
  const plan = planAssetRows(headers, read.rows, refs, optionsFrom(form));
  const blocked = plan.rows.flatMap((r) => (r.kind === "blocked" ? [r] : []));
  return ok({ plan, groups: groupByCause(blocked), unknownColumns: headers.unknown });
}

/**
 * A-4: `AssetUpdatePatch.cost` is a decimal STRING by deliberate design (the
 * string is what reaches Prisma, so no float ever touches the write — see
 * that type's own comment), but `diffOf`'s `normalize()` only unwraps a
 * `Prisma.Decimal` via `toNumber()` and leaves a string alone. Compared
 * as-is, the stored `before.cost` normalises to `51000.5` while the patch
 * holds `"51000.50"` — same value, and `same()` calls them different on
 * EVERY update row that carries a cost, which is the exact "phantom audit
 * entry on every first edit" defect an earlier phase's review already
 * caught, arriving by a new road. This builds a COMPARISON-ONLY copy with
 * `cost` coerced to a `Number` — `diffOf` already reduces the stored Decimal
 * to a number, so this is consistent with that, not a reintroduction of
 * float money. `row.data` itself — what actually gets written — is never
 * touched.
 */
function patchForDiff(data: AssetUpdatePatch): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  if (out.cost !== undefined && out.cost !== null) {
    out.cost = Number(out.cost as string);
  }
  return out;
}

/** A row-local failure with an operator-facing reason, never a raw Prisma error. */
class RowWriteError extends Error {}

/**
 * A-6: the operator gets a number that adds up and a reason to act on, never
 * a raw Prisma error string (§6a rule 59 — never quote one at an operator).
 */
function classifyRowError(err: unknown): string {
  if (err instanceof RowWriteError) return err.message;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return "would duplicate a tag or serial already on file";
    if (err.code === "P2003") return "names a category, type or vendor that no longer exists";
  }
  return "could not be written — re-check this row and retry";
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
 * was holding — so a divergence is reported, not silently papered over.
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
  }>
> {
  const planned = await planAssetImport(form);
  if (!planned.ok) return planned;
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

  const { plan } = planned.data;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const failures: { row: number; reason: string }[] = [];

  for (const row of plan.rows) {
    if (row.kind === "blocked") continue;
    try {
      await prisma.$transaction(async (tx) => {
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
          created += 1;
          return;
        }

        const before = await tx.asset.findUnique({ where: { id: row.assetId } });
        if (!before) throw new RowWriteError("that asset no longer exists");

        // Found running Test 1 of this task's own verification against real
        // (seeded/e2e) data, not named in the banner: `updateAsset` already
        // carries the fix for this ("The form round-trips dates at DAY
        // precision while seed/legacy rows carry time-of-day. Compare at day
        // precision — otherwise every first edit of an old row writes
        // phantom purchasedAt/warrantyUntil audit entries") — this path
        // imports the same defect by a THIRD road (A-4's cost string being
        // the second): `parseDateCell` always hands back UTC midnight
        // (Task 8's pinned convention), but a seed/legacy `purchasedAt` or
        // `warrantyUntil` can carry a real time-of-day. Diffed as-is, an
        // unedited round trip of such a row normalises `before` to
        // `…T07:59:47.133Z` and the patch to `…T00:00:00.000Z` — same
        // calendar day, `same()` calls it a change — which is exactly the
        // "happy path is made entirely of unchanged rows" case A-3 exists to
        // protect. Truncated for the COMPARISON only, exactly as
        // `updateAsset` does; `row.data.purchasedAt`/`warrantyUntil` — what
        // actually gets WRITTEN — are untouched.
        const toDay = (dt: Date | null) => (dt ? new Date(`${dt.toISOString().slice(0, 10)}T00:00:00Z`) : null);
        const beforeForDiff = {
          ...before,
          purchasedAt: toDay(before.purchasedAt),
          warrantyUntil: toDay(before.warrantyUntil),
        };

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
        const diff = diffOf(beforeForDiff as unknown as Record<string, unknown>, patchForDiff(row.data));
        if (Object.keys(diff).length === 0) {
          unchanged += 1;
          return;
        }

        // Guarded on `updatedAt`, which `@updatedAt` always moves — so an
        // edit landing between the read just above and this write, inside
        // this same transaction, loses rather than being silently
        // overwritten (§6a rules 21, 29, 30).
        const written = await tx.asset.updateMany({
          where: { id: row.assetId, updatedAt: before.updatedAt },
          data: row.data,
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
        updated += 1;
      });
    } catch (err) {
      // A-6: the sheet row number (carried on the verdict) and a classified,
      // actionable reason — never swallowed into a total that doesn't add up.
      failures.push({ row: row.row, reason: classifyRowError(err) });
    }
  }

  revalidatePath("/inventory");
  // `/inventory/activity` is its own route — `revalidatePath("/inventory")`
  // does not cover it, and it's exactly where these new entries are meant
  // to show up.
  revalidatePath("/inventory/activity");
  revalidatePath("/audit");
  return ok({
    created,
    updated,
    unchanged,
    skipped: plan.counts.blocked,
    failed: failures.length,
    failures,
  });
}
