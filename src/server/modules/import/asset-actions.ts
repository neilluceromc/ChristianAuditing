"use server";

import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { readGrid } from "@/server/import/read-sheet";
import { cellText, matchHeaders, planAssetRows, type AssetPlan, type ImportOptions } from "@/lib/import-assets";
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
    return rateLimited(
      rate.retryAfterSec,
      "You've checked 60 files this minute — the cap. Each check writes nothing, but you'll need to " +
        "choose your file again once the limit frees up.",
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
