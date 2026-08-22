"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { BlockedCauses } from "./blocked-causes";
import {
  IMPORT_MAX_UPLOAD_BYTES, IMPORT_OPTIONS, optionLabel, uploadTooLargeRefusal, type ImportOption,
} from "@/lib/import-vocabulary";
import { splitUnknownColumns } from "@/lib/import-columns";
import { applySummary, hasDiverged } from "@/lib/import-outcome";
import type { ActionResult } from "@/server/action-result";
import { applyAssetImport, planAssetImport, type PlanResult } from "@/server/modules/import/asset-actions";

const STEPS = ["Upload", "Validate", "Results"] as const;

/** The shape `applyAssetImport` resolves to on success — not exported by the
 * server module (it inlines the object type), so derived here rather than
 * hand-retyped, which would silently drift the day a field is added there. */
type ApplyOutcome = Extract<Awaited<ReturnType<typeof applyAssetImport>>, { ok: true }>["data"];

/**
 * Task 11 round two, V-2: `plan`, `groups`, `unknownColumns` and the OPTIONS
 * that produced them are bound into one value, set atomically by a
 * successful re-plan. Before this, `options` was a separate piece of state
 * that could change (a fix ticks a box) before the re-plan it triggered had
 * come back, so the Import button's displayed count and the options it was
 * about to send could disagree — and if that re-plan was then refused (the
 * `import_plan` cap, or any other refusal), nothing rolled the live options
 * back, so the NEXT click sent options the screen never showed a verdict
 * for. There is now no live `options` state to drift: the only options this
 * component knows about are the ones riding inside the most recent
 * successful `Verdict`.
 */
type Verdict = PlanResult & { options: Record<ImportOption, boolean> };

/**
 * A small presentational stepper local to this wizard — NOT
 * `src/components/offboarding/wizard-steps.tsx`'s `WizardSteps`. That
 * component's real signature is `{ employeeId, current, unlocked }`: it
 * renders `WIZARD_STEPS` (from `src/lib/offboarding.ts`) as navigable
 * `<Link>`s built from an employee id, with a lock rule about undecided
 * items. None of that exists here — import's three steps are progress
 * indication, not navigation, and there is no employee — so this is a
 * different, simpler thing that only happens to look similar. Do not
 * "de-duplicate" the two; contorting the offboarding component to fit this
 * page (or generalising it) would edit a shipped, unrelated surface for no
 * shared behaviour.
 */
function Stepper({ current, labels }: { current: number; labels: readonly [string, string, string] }) {
  return (
    <ol aria-label="Import steps" className="flex flex-wrap items-center gap-1.5 pb-1">
      {labels.map((label, i) => {
        const isCurrent = i === current;
        const done = i < current;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="h-px w-4 bg-border-strong" />}
            <span
              aria-current={isCurrent ? "step" : undefined}
              className={
                "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2.5 py-1 text-[12px] " +
                (isCurrent
                  ? "border-accent-soft-border bg-accent-tint font-medium text-fg"
                  : done
                    ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                    : "border-border bg-surface text-fg-secondary")
              }
            >
              <span
                aria-hidden
                className={
                  "grid size-[18px] place-items-center rounded-full border font-mono text-[9.5px] " +
                  (isCurrent
                    ? "border-accent bg-accent text-accent-fg"
                    : done
                      ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                      : "border-border-strong text-fg-faint")
                }
              >
                {i + 1}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function emptyOptions(): Record<ImportOption, boolean> {
  return Object.fromEntries(IMPORT_OPTIONS.map((o) => [o, false])) as Record<ImportOption, boolean>;
}

/**
 * Task 11 round two, V-6: options only ever moved from off to on, with no
 * indication which were riding on the next write and no way to remove one
 * short of re-picking the file (which discards the whole verdict). Shown on
 * both the pending-plan panel and the applied-outcome panel, each passing
 * the options bound to ITS OWN verdict — never a shared "current" state — so
 * the applied panel keeps showing what was true of the write that already
 * happened even after a fix produces a newer pending plan.
 */
function OptionChips({
  opts,
  busy,
  onRemove,
}: {
  opts: readonly ImportOption[];
  busy: boolean;
  /**
   * Omitted for a HISTORICAL verdict — the outcome panel's chips, once a
   * newer pending plan already exists below them — so a click here can't be
   * misread as editing options that belong to the wrong plan. Present, the
   * chip is a real "×" affordance; absent, it is a plain, read-only record
   * of what that particular write actually used.
   */
  onRemove?: (option: ImportOption) => void;
}) {
  if (opts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-fg-muted">Applied to this plan:</span>
      {opts.map((o) =>
        onRemove ? (
          <button
            key={o}
            type="button"
            disabled={busy}
            onClick={() => onRemove(o)}
            className="inline-flex items-center gap-1 rounded-(--radius-ctl) border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-secondary hover:bg-surface-subtle disabled:opacity-50"
          >
            {optionLabel(o)}
            <span aria-hidden className="text-fg-faint">
              ×
            </span>
            <span className="sr-only">Remove</span>
          </button>
        ) : (
          <span
            key={o}
            className="inline-flex items-center rounded-(--radius-ctl) border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-secondary"
          >
            {optionLabel(o)}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * The same ActionResult ladder as every other screen (`endpoint-editor.tsx`'s
 * `useRunner`), with the two details that module's comment calls out: a
 * per-CONTROL `acting` key (a shared `pending` would spin every fix button at
 * once) and the rate limit stored as a DEADLINE, so a second refusal restarts
 * the countdown even when it computes the same number of seconds.
 *
 * Task 11 round two, V-3: the rate-limit refusal's own `message` is captured
 * alongside the deadline and threaded to `RateLimitNotice` — both
 * `planAssetImport` and `applyAssetImport` already build the true sentence
 * (the real cap, and a true claim about what was or wasn't written) via
 * `rateLimited(..., message)`; before this it was read off `res` and then
 * discarded, so the screen fell back to `RateLimitNotice`'s hardcoded
 * default, which names the wrong cap and a promise about a `<form>` this
 * page doesn't have.
 *
 * V-4: `run` now has a `catch` — before this, a thrown promise (a 6MB upload
 * rejecting at the framework's 4MB body limit, a dropped connection mid-
 * apply) produced no banner, no toast, nothing: `finally` alone re-enabled
 * the button and the operator was left looking at a page that did nothing.
 * The caller supplies the sentence for its own case, because "the dry run
 * failed" and "the write may have partially happened" are not the same
 * claim and only the caller knows which one this is.
 *
 * `isPending` from `useTransition` is exposed too and folded into `busy`
 * alongside `acting`: `setActing` flips synchronously inside the click
 * handler (before the awaited call starts), which already disables controls
 * from the first click, but W-8 asks for the transition's own pending flag
 * as the belt to that suspenders — Apply is the ~15-second operation this
 * matters for, since a concurrent double-click plans CREATE for the same
 * tags twice and the loser gets a classified P2002.
 */
function useRunner() {
  const [isPending, startTransition] = useTransition();
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  function run<T>(
    key: string,
    fn: () => Promise<ActionResult<T>>,
    onOk: (data: T) => void,
    onThrow: string,
  ) {
    setError(null);
    setRetryDeadline(null);
    setRetryMessage(null);
    setActing(key);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) onOk(res.data);
        else if (res.kind === "rate_limited") {
          setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
          setRetryMessage(res.message);
        }
        // Every other refusal is a conflict carrying a whole sentence — the
        // missing-column list, the row-cap message, the unreadable-file line.
        else setError(res.message);
      } catch {
        setError(onThrow);
      } finally {
        setActing(null);
      }
    });
  }

  return {
    busy: isPending || acting !== null,
    acting,
    error,
    setError,
    retryAfterSec,
    retryMessage,
    clearRetry: () => setRetryDeadline(null),
    run,
  };
}

export function ImportWizard() {
  const router = useRouter();
  const toast = useToast();
  const { busy, acting, error, setError, retryAfterSec, retryMessage, clearRetry, run } = useRunner();
  const [file, setFile] = useState<File | null>(null);
  // Bumped whenever the picked file needs to visually clear: `setFile(null)`
  // does not clear an `<input type="file">` — the filename stays on screen —
  // so this remounts the input instead.
  const [fileInputKey, setFileInputKey] = useState(0);
  const [result, setResult] = useState<Verdict | null>(null);
  const [applyOutcome, setApplyOutcome] = useState<ApplyOutcome | null>(null);
  // Task 11 round two minor: the specific `Verdict` that was ACTUALLY sent to
  // `applyAssetImport` — kept distinct from `result`, which can move on to a
  // fresher re-plan afterwards (a fix applied from the divergence groups
  // below). Comparing `result !== appliedForPlan` by reference is what tells
  // the render below whether there is a NEW plan still waiting on an Import
  // click, without a second boolean to keep in sync by hand.
  const [appliedForPlan, setAppliedForPlan] = useState<Verdict | null>(null);

  const step = applyOutcome || result ? 2 : file ? 1 : 0;
  const stepLabels: readonly [string, string, string] = [
    STEPS[0],
    STEPS[1],
    // Task 11 round two minor: the stepper used to say "Results" the moment
    // a dry run existed, which is a PREVIEW of what would happen, not a
    // record of what did. It only earns "Results" once something has
    // actually been written.
    applyOutcome ? "Results" : "Preview",
  ];

  // True once a successful re-plan exists that has not itself been the
  // target of an Apply click yet — the normal pre-apply state, and also what
  // reappears after a fix is applied from the divergence groups below,
  // without touching `applyOutcome` (Task 11 round two minor: that fix used
  // to re-plan by clearing `applyOutcome`, destroying the only on-screen
  // record of the write that had just happened, failures list included).
  const planPendingApply = result !== null && result !== appliedForPlan;

  // Task 11 round two, V-1: compared against the plan that was ACTUALLY
  // applied (`appliedForPlan`), never the live `result` — which may already
  // have moved on to a newer re-plan from a divergence fix below. See
  // `hasDiverged` (`src/lib/import-outcome.ts`) for why this specific sum,
  // and not `created + updated`, is the honest comparison.
  const diverged =
    !!applyOutcome && !!appliedForPlan && hasDiverged(appliedForPlan.plan.counts, applyOutcome);

  function body(f: File, opts: Record<ImportOption, boolean>): FormData {
    const form = new FormData();
    form.set("file", f);
    for (const [k, v] of Object.entries(opts)) if (v) form.set(k, "1");
    return form;
  }

  function validate(f: File, opts: Record<ImportOption, boolean>) {
    // V-4: a client-side ceiling check against the same number
    // `next.config.ts`'s `bodySizeLimit` enforces, so a file over it gets a
    // named refusal before ever reaching the network — not a silent promise
    // rejection with no `catch` to turn it into a banner.
    if (f.size > IMPORT_MAX_UPLOAD_BYTES) {
      setError(uploadTooLargeRefusal(f.size));
      return;
    }
    run(
      "validate",
      () => planAssetImport(body(f, opts)),
      (data) => setResult({ ...data, options: opts }),
      "Something went wrong checking that file. Nothing was imported — try again.",
    );
  }

  function startOver() {
    // The wizard's own restart affordance for a `reupload`-kind fix, and also
    // what "pick a new file" does: a new file invalidates the old verdict,
    // every option chosen for it, and any prior apply outcome — carrying any
    // of those forward would show one file's counts, or one run's results,
    // against another file's rows.
    setResult(null);
    setApplyOutcome(null);
    setAppliedForPlan(null);
    setFile(null);
    setFileInputKey((k) => k + 1);
  }

  // Shared by both places a fix can be applied — the pre-apply verdict
  // panel, and the divergence groups on the outcome panel below. Both read
  // the SAME `result.options` as the base (Task 11 round two, V-2): by the
  // time the outcome panel exists, `result` and `appliedForPlan` are the
  // same object, so there is nothing to reconcile between the two call
  // sites.
  function applyFix(option: ImportOption) {
    if (!file) return;
    validate(file, { ...(result?.options ?? emptyOptions()), [option]: true });
  }

  function removeOption(option: ImportOption) {
    if (!file || !result) return;
    validate(file, { ...result.options, [option]: false });
  }

  const { known: knownUnimported, unknown: genuinelyUnknown } = result
    ? splitUnknownColumns(result.unknownColumns)
    : { known: [], unknown: [] };

  const totalRows = result
    ? result.plan.counts.create + result.plan.counts.update + result.plan.counts.blocked
    : 0;
  const appliedOptions = result ? IMPORT_OPTIONS.filter((o) => result.options[o]) : [];

  return (
    <div className="flex flex-col gap-4">
      <Stepper current={step} labels={stepLabels} />

      {retryAfterSec !== null && (
        <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} message={retryMessage ?? undefined} />
      )}
      {error && <Banner tone="fault" title={error} />}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="import-file" className="text-[12px] font-medium text-fg-secondary">
          Spreadsheet (.xlsx)
        </label>
        <input
          key={fileInputKey}
          id="import-file"
          type="file"
          accept=".xlsx"
          disabled={busy}
          className="text-[12px] text-fg-secondary"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setResult(null);
            setApplyOutcome(null);
            setAppliedForPlan(null);
            setFile(picked);
          }}
        />
      </div>

      {file && !applyOutcome && (
        <span>
          <Button variant="primary" loading={acting === "validate"} disabled={busy} onClick={() => validate(file, result?.options ?? emptyOptions())}>
            {result ? "Validate again" : "Validate"}
          </Button>
        </span>
      )}

      {result && planPendingApply && (
        <div className="flex flex-col gap-3">
          {totalRows === 0 ? (
            // Task 11 round two, V-5: a header-only sheet (or one whose rows
            // are all blank) used to render a full, confident-looking green
            // bar — `(0/0)*100` is `NaN`, and every browser discards a `NaN%`
            // width, leaving the accent div at full width by default. An
            // explicit branch, not just the ProgressBar guard, because "0
            // rows" deserves its own sentence, not a 0/0 bar with no Import
            // button and no explanation.
            <Banner tone="attention" title="Nothing to import">
              This sheet has no rows to import — check it isn&apos;t just a header row, or that every row
              isn&apos;t blank. Nothing was read as data, and nothing was written.
            </Banner>
          ) : (
            <>
              {/* The whole verdict at once — a proportional bar, not a
                  climbing counter. The brief is explicit about that. */}
              <div className="flex flex-col gap-1.5">
                <ProgressBar
                  value={result.plan.counts.create + result.plan.counts.update}
                  max={totalRows}
                  label="Rows that would import"
                />
                <span className="font-mono text-[11px] text-fg-muted">
                  {result.plan.counts.create} new · {result.plan.counts.update} updates ·{" "}
                  {result.plan.counts.blocked} blocked
                </span>
              </div>

              <OptionChips opts={appliedOptions} busy={busy} onRemove={removeOption} />

              {genuinelyUnknown.length > 0 && (
                <p className="text-[11.5px] text-fg-muted">
                  Unrecognised {genuinelyUnknown.length === 1 ? "column" : "columns"} — check for a typo in
                  the header: <span className="font-mono">{genuinelyUnknown.join(", ")}</span>
                </p>
              )}
              {knownUnimported.length > 0 && (
                <p className="text-[11.5px] text-fg-muted">
                  Not imported: <span className="font-mono">{knownUnimported.join(", ")}</span> — part of
                  this app&apos;s own export, not an import field.
                </p>
              )}

              <BlockedCauses groups={result.groups} busy={busy} onApplyOption={applyFix} onReupload={startOver} />

              {/* Absent, not disabled, when there is nothing to do — the
                  same rule the read-only surfaces follow. */}
              {result.plan.counts.create + result.plan.counts.update > 0 && (
                <div className="flex flex-col gap-1.5">
                  {/* Set BEFORE the wait, not explained after it: Apply is
                      measured at ~15s for 2,000 rows even before counting
                      the upload, the parse, and the fact that
                      applyAssetImport plans the whole file twice. */}
                  <p className="text-[11px] text-fg-muted">
                    A full file can take up to 15 seconds — this re-checks everything before writing, one
                    row at a time. The button disables the moment you click it; wait for it rather than
                    clicking again.
                  </p>
                  <span>
                    <Button
                      variant="primary"
                      loading={acting === "apply"}
                      disabled={busy}
                      onClick={() => {
                        if (!file || !result) return;
                        const verdict = result;
                        run(
                          "apply",
                          () => applyAssetImport(body(file, verdict.options)),
                          (data) => {
                            const { message, tone } = applySummary(data);
                            toast(message, tone);
                            setApplyOutcome(data);
                            setAppliedForPlan(verdict);
                            router.refresh();
                          },
                          "Something went wrong sending the import — this import may have partially " +
                            "completed. Check /inventory/activity before retrying, rather than clicking " +
                            "Import again right away.",
                        );
                      }}
                    >
                      Import {result.plan.counts.create + result.plan.counts.update} rows
                    </Button>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {applyOutcome && appliedForPlan && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <ProgressBar
              value={applyOutcome.created + applyOutcome.updated + applyOutcome.unchanged}
              max={
                applyOutcome.created + applyOutcome.updated + applyOutcome.unchanged +
                applyOutcome.skipped + applyOutcome.failed
              }
              label="Rows written or already matching"
            />
            <span className="font-mono text-[11px] text-fg-muted">
              {applyOutcome.created} new · {applyOutcome.updated} updated · {applyOutcome.unchanged} already
              matched · {applyOutcome.skipped} blocked · {applyOutcome.failed} failed
            </span>
          </div>

          <OptionChips
            opts={IMPORT_OPTIONS.filter((o) => appliedForPlan.options[o])}
            busy={busy}
            onRemove={planPendingApply ? undefined : removeOption}
          />

          {applyOutcome.failures.length > 0 && (
            <div className="flex flex-col gap-1 rounded-(--radius-card) border border-border bg-surface px-3 py-2.5">
              <span className="text-[12px] font-medium text-fg">Rows that failed to write</span>
              {applyOutcome.failures.map((f) => (
                <span key={f.row} className="font-mono text-[11px] text-fg-muted">
                  row {f.row}: {f.reason}
                </span>
              ))}
            </div>
          )}

          {diverged && (
            <Banner tone="attention" title="The outcome differs from what Validate showed">
              Something changed between Validate and Import — a category renamed, a record edited — so
              Apply re-checked the whole file and some rows resolved differently.
              {/* Task 11 round two, V-1: do not promise groups "below" when
                  there aren't any — a divergence with no currently-blocked
                  rows (e.g. a row that WAS blocked now resolves instead) has
                  nothing for BlockedCauses to render. */}
              {applyOutcome.groups.length > 0
                ? " What actually happened is grouped below, the same way Validate grouped its own verdict."
                : " None of the rows that differ are blocked right now — check the counts above, and " +
                  "/inventory/activity for exactly what changed."}
            </Banner>
          )}
          {diverged && (
            <BlockedCauses groups={applyOutcome.groups} busy={busy} onApplyOption={applyFix} onReupload={startOver} />
          )}

          <span>
            <Button variant="secondary" onClick={startOver}>
              Start new import
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
