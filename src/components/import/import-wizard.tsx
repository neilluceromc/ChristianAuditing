"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { BlockedCauses } from "./blocked-causes";
import { IMPORT_OPTIONS, type ImportOption } from "@/lib/import-vocabulary";
import type { ActionResult } from "@/server/action-result";
import { applyAssetImport, planAssetImport, type PlanResult } from "@/server/modules/import/asset-actions";

const STEPS = ["Upload", "Validate", "Results"] as const;

/** The shape `applyAssetImport` resolves to on success — not exported by the
 * server module (it inlines the object type), so derived here rather than
 * hand-retyped, which would silently drift the day a field is added there. */
type ApplyOutcome = Extract<Awaited<ReturnType<typeof applyAssetImport>>, { ok: true }>["data"];

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
function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label="Import steps" className="flex flex-wrap items-center gap-1.5 pb-1">
      {STEPS.map((label, i) => {
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

/**
 * `ASSET_EXPORT_COLUMNS` (`src/lib/export-columns.ts`) writes an "RMA ref"
 * column that `ASSET_IMPORT_HEADERS` deliberately has no field for — a
 * genuine round trip of our own export therefore ALWAYS carries it. Naming
 * it identically to a truly misspelled header would train the operator to
 * stop reading the one line that exists to catch a real typo, so it gets its
 * own, calmer wording instead of folding into "unrecognised columns".
 */
const KNOWN_UNIMPORTED_COLUMNS = ["RMA ref"];

function emptyOptions(): Record<ImportOption, boolean> {
  return Object.fromEntries(IMPORT_OPTIONS.map((o) => [o, false])) as Record<ImportOption, boolean>;
}

function applySummary(data: ApplyOutcome): { message: string; tone: "settled" | "fault" } {
  const parts: string[] = [];
  if (data.created > 0) parts.push(`${data.created} new`);
  if (data.updated > 0) parts.push(`${data.updated} updated`);
  let message: string;
  if (parts.length > 0) {
    message = `Imported ${parts.join(" and ")}`;
    // The happy path's headline: re-uploading an unedited export is the
    // workflow this feature exists for, and every one of its rows is an
    // update that changes nothing. Folding that into silence here would make
    // the one message that mattered disappear the moment there's also real
    // work to report.
    if (data.unchanged > 0) message += ` · ${data.unchanged} already matched`;
  } else if (data.unchanged > 0) {
    // Not "Imported 0 new and 0 updated" — that reads as a failure when the
    // import did exactly the right thing.
    message = `${data.unchanged} row${data.unchanged === 1 ? "" : "s"} already matched — nothing needed changing`;
  } else {
    message = "Nothing was imported";
  }
  if (data.failed > 0) message += ` — ${data.failed} failed, refresh and re-check`;
  return { message, tone: data.failed > 0 ? "fault" : "settled" };
}

/**
 * The same ActionResult ladder as every other screen (`endpoint-editor.tsx`'s
 * `useRunner`), with the two details that module's comment calls out: a
 * per-CONTROL `acting` key (a shared `pending` would spin every fix button at
 * once) and the rate limit stored as a DEADLINE, so a second refusal restarts
 * the countdown even when it computes the same number of seconds.
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

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  function run<T>(key: string, fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void) {
    setError(null);
    setRetryDeadline(null);
    setActing(key);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) onOk(res.data);
        else if (res.kind === "rate_limited") setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        // Every other refusal is a conflict carrying a whole sentence — the
        // missing-column list, the row-cap message, the unreadable-file line.
        else setError(res.message);
      } finally {
        setActing(null);
      }
    });
  }

  return {
    busy: isPending || acting !== null,
    acting,
    error,
    retryAfterSec,
    clearRetry: () => setRetryDeadline(null),
    run,
  };
}

export function ImportWizard() {
  const router = useRouter();
  const toast = useToast();
  const { busy, acting, error, retryAfterSec, clearRetry, run } = useRunner();
  const [file, setFile] = useState<File | null>(null);
  // Bumped whenever the picked file needs to visually clear: `setFile(null)`
  // does not clear an `<input type="file">` — the filename stays on screen —
  // so this remounts the input instead.
  const [fileInputKey, setFileInputKey] = useState(0);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [applyOutcome, setApplyOutcome] = useState<ApplyOutcome | null>(null);
  // Held here so a fix can re-plan the SAME file without a second upload.
  const [options, setOptions] = useState<Record<ImportOption, boolean>>(emptyOptions);

  const step = applyOutcome || result ? 2 : file ? 1 : 0;

  function body(f: File, opts: Record<ImportOption, boolean>): FormData {
    const form = new FormData();
    form.set("file", f);
    for (const [k, v] of Object.entries(opts)) if (v) form.set(k, "1");
    return form;
  }

  function validate(f: File, opts: Record<ImportOption, boolean>) {
    setApplyOutcome(null);
    run("validate", () => planAssetImport(body(f, opts)), setResult);
  }

  function startOver() {
    // The wizard's own restart affordance for a `reupload`-kind fix, and also
    // what "pick a new file" does: a new file invalidates the old verdict,
    // every option chosen for it, and any prior apply outcome — carrying any
    // of those forward would show one file's counts, or one run's results,
    // against another file's rows.
    setResult(null);
    setApplyOutcome(null);
    setOptions(emptyOptions());
    setFile(null);
    setFileInputKey((k) => k + 1);
  }

  const knownUnimported = result
    ? result.unknownColumns.filter((c) => KNOWN_UNIMPORTED_COLUMNS.includes(c))
    : [];
  const genuinelyUnknown = result
    ? result.unknownColumns.filter((c) => !KNOWN_UNIMPORTED_COLUMNS.includes(c))
    : [];

  // The world can move between Validate and Apply (Task 10's accepted
  // divergence: an admin renames a category and all 200 rows block). Counts
  // alone can't say why, so the re-plan's own groups are shown whenever the
  // write's outcome didn't match the verdict the operator approved.
  const diverged =
    !!applyOutcome &&
    !!result &&
    (applyOutcome.created + applyOutcome.updated !== result.plan.counts.create + result.plan.counts.update ||
      applyOutcome.skipped !== result.plan.counts.blocked);

  return (
    <div className="flex flex-col gap-4">
      <Stepper current={step} />

      {retryAfterSec !== null && <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />}
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
            setOptions(emptyOptions());
            setFile(picked);
          }}
        />
      </div>

      {file && !applyOutcome && (
        <span>
          <Button variant="primary" loading={acting === "validate"} disabled={busy} onClick={() => validate(file, options)}>
            {result ? "Validate again" : "Validate"}
          </Button>
        </span>
      )}

      {result && !applyOutcome && (
        <div className="flex flex-col gap-3">
          {/* The whole verdict at once — a proportional bar, not a climbing
              counter. The brief is explicit about that. */}
          <div className="flex flex-col gap-1.5">
            <ProgressBar
              value={result.plan.counts.create + result.plan.counts.update}
              max={result.plan.counts.create + result.plan.counts.update + result.plan.counts.blocked}
              label="Rows that would import"
            />
            <span className="font-mono text-[11px] text-fg-muted">
              {result.plan.counts.create} new · {result.plan.counts.update} updates ·{" "}
              {result.plan.counts.blocked} blocked
            </span>
          </div>

          {genuinelyUnknown.length > 0 && (
            <p className="text-[11.5px] text-fg-muted">
              Unrecognised {genuinelyUnknown.length === 1 ? "column" : "columns"} — check for a typo in the
              header: <span className="font-mono">{genuinelyUnknown.join(", ")}</span>
            </p>
          )}
          {knownUnimported.length > 0 && (
            <p className="text-[11.5px] text-fg-muted">
              Not imported: <span className="font-mono">{knownUnimported.join(", ")}</span> — part of this
              app&apos;s own export, not an import field.
            </p>
          )}

          <BlockedCauses
            groups={result.groups}
            busy={busy}
            onApplyOption={(option) => {
              // A fix RE-PLANS. It never writes, so the operator sees the new
              // verdict before committing to it.
              if (!file) return;
              const next = { ...options, [option]: true };
              setOptions(next);
              validate(file, next);
            }}
            onReupload={startOver}
          />

          {/* Absent, not disabled, when there is nothing to do — the same rule
              the read-only surfaces follow. */}
          {result.plan.counts.create + result.plan.counts.update > 0 && (
            <div className="flex flex-col gap-1.5">
              {/* Set BEFORE the wait, not explained after it: Apply is
                  measured at ~15s for 2,000 rows even before counting the
                  upload, the parse, and the fact that applyAssetImport plans
                  the whole file twice. */}
              <p className="text-[11px] text-fg-muted">
                A full file can take up to 15 seconds — this re-checks everything before writing, one row
                at a time. The button disables the moment you click it; wait for it rather than clicking
                again.
              </p>
              <span>
                <Button
                  variant="primary"
                  loading={acting === "apply"}
                  disabled={busy}
                  onClick={() => {
                    if (!file) return;
                    run("apply", () => applyAssetImport(body(file, options)), (data) => {
                      const { message, tone } = applySummary(data);
                      toast(message, tone);
                      setApplyOutcome(data);
                      router.refresh();
                    });
                  }}
                >
                  Import {result.plan.counts.create + result.plan.counts.update} rows
                </Button>
              </span>
            </div>
          )}
        </div>
      )}

      {applyOutcome && (
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
              Apply re-checked the whole file and some rows resolved differently. What actually happened
              is grouped below, the same way Validate grouped its own verdict.
            </Banner>
          )}
          {diverged && (
            <BlockedCauses
              groups={applyOutcome.groups}
              busy={busy}
              onApplyOption={(option) => {
                // The file is still held (apply never clears it — only
                // Start new import does), so a fix here re-plans the SAME
                // file for a follow-up pass over whatever just blocked,
                // exactly like a fix during Validate.
                const next = { ...options, [option]: true };
                setOptions(next);
                if (file) validate(file, next);
              }}
              onReupload={startOver}
            />
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
