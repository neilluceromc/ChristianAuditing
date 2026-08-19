"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { flagChange, flagChangeWarning } from "@/lib/admin-flags";
import { setFlag, setFlagValue } from "@/server/modules/admin/flag-actions";
import type { ActionResult } from "@/server/action-result";
import type { FlagRow } from "@/server/modules/admin/queries";

/** A switch flip picked for a row whose rule returned a warning, waiting on the confirm dialog. */
interface PendingToggle {
  row: FlagRow;
  next: boolean;
  warning: string;
}

export function FlagRows({ rows }: { rows: FlagRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])),
  );
  // `router.refresh()` re-renders this component with new `rows` props without
  // remounting it, so the lazy initializer above only ever runs once — left
  // alone, a Save that comes back normalized (lowercased, say) would write the
  // canonical value to the database while the input kept showing whatever the
  // admin actually typed. Keyed on the values themselves, not on `rows` (a new
  // array every render), so an unrelated switch toggle's refresh — which never
  // touches `value` — doesn't stomp an edit still in progress on this field.
  const valuesKey = rows.map((r) => `${r.key}:${r.value ?? ""}`).join("|");
  useEffect(() => {
    setDraft(Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey]);

  // A real generic over the one shape both actions share — `changed: false`
  // isn't part of this generic (neither action reports it: a no-op returns
  // the same `ok(null)` as a real write), which is exactly why this always
  // refreshes on `ok`. The branch is reachable only when this row's props
  // are already stale (another admin, or another tab, changed the same
  // flag), and in that one case the refresh IS the remedy — staying silent
  // would leave the switch looking like the click did nothing, forever,
  // until a manual reload.
  function run(
    key: string,
    fn: () => Promise<ActionResult<null>>,
    okMsg: string,
    opts?: { onOk?: () => void; onSettled?: () => void },
  ) {
    setError(null);
    setFieldErrors((f) => ({ ...f, [key]: "" }));
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          opts?.onOk?.();
          toast(okMsg, "settled");
          router.refresh();
        } else if (res.kind === "rate_limited") {
          setRetryAfter(res.retryAfterSec ?? 60);
        } else if (res.kind === "validation") {
          // The only field on this screen is a value editor, so a validation
          // refusal belongs to whichever row's Save was clicked.
          setFieldErrors((f) => ({ ...f, [key]: Object.values(res.fieldErrors ?? {})[0] ?? res.message }));
        } else {
          // forbidden or conflict: no field to hang either on, so the banner.
          setError(res.message);
        }
      } finally {
        opts?.onSettled?.();
      }
    });
  }

  function submitToggle(row: FlagRow, next: boolean) {
    run(
      row.key,
      () => setFlag({ key: row.key, enabled: next }),
      `${row.label} is ${next ? "on" : "off"}`,
      { onOk: () => setPendingToggle(null) },
    );
  }

  function toggle(row: FlagRow, next: boolean) {
    // flagChangeWarning reads the REAL row (row.state), never a client
    // guess — see FlagRow.state's doc comment. Only the off direction ever
    // carries a warning, and only allowed_domain's off does today.
    const warning = flagChangeWarning(row.state, next);
    if (warning) {
      setError(null);
      setRetryAfter(null);
      setPendingToggle({ row, next, warning });
    } else {
      submitToggle(row, next);
    }
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      {retryAfter !== null && !pendingToggle && (
        <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />
      )}
      {error && !pendingToggle && <Banner tone="fault" title={error} />}

      {rows.map((row) => {
        // The direction THIS click would attempt. Bound to the rule the
        // action itself enforces, not to `row.unavailable` alone: an
        // `unavailable` flag must still be closeable if it's somehow already
        // on (HANDOVER §6a rule 14 — refusing the safe direction is the
        // defect this phase keeps re-shipping), and a `hasValue` flag with no
        // usable value must stay refused on the ON direction until a value
        // is saved, even though `row.unavailable` is null for it.
        const next = !row.enabled;
        const verdict = flagChange(row.state, next);
        const fieldError = fieldErrors[row.key];

        return (
          <Card key={row.key}>
            <CardBody className="flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-fg">{row.label}</span>
                    <span className="font-mono text-[10px] text-fg-faint">{row.key}</span>
                    {row.unavailable && <Pill>UNAVAILABLE</Pill>}
                  </span>
                  {/* spec.description, never FeatureFlag.description — the two
                      disagree today, and the spec's is the build-controlled
                      prose (see FLAG_SPECS's doc comments). */}
                  <span className="text-[11.5px] leading-snug text-fg-muted">{row.description}</span>
                </div>
                {/* Unlike a viewer's absent affordances, this switch is DISABLED
                    rather than hidden: the admin has permission, the feature is
                    what's missing. Hiding it would read as "this flag is gone". */}
                <Switch
                  checked={row.enabled}
                  disabled={pending || !verdict.allowed}
                  aria-label={`${row.label}${row.unavailable ? " — unavailable" : ""}`}
                  onCheckedChange={(checked) => toggle(row, checked)}
                />
              </div>

              {/* Two different sentences, and both have to be here.
                  `unavailable` is a property of the FLAG ("this feature isn't
                  finished"), so it prints whenever it's set — including when
                  the switch is live because the row is somehow already on and
                  the safe direction is permitted, which is precisely when the
                  admin most needs to know why they should close it.
                  `verdict.reason` is a property of THIS CLICK, and without it
                  a `hasValue` flag with no value renders a dead switch and no
                  explanation: `row.unavailable` is null for allowed_domain, so
                  on any deployment that bootstrapped without a domain the
                  admin would see a greyed-out "Signup domain restriction" and
                  nothing saying "set a domain first". The rule already returns
                  that sentence — HANDOVER §6a rule 10 is that the page has to
                  consume every refusal the rule can return, not just the one
                  the design card names. */}
              {row.unavailable && (
                <p className="border-l-2 border-border-strong pl-2.5 text-[11px] leading-snug text-fg-muted">
                  {row.unavailable}
                </p>
              )}

              {!verdict.allowed && !row.unavailable && (
                <p className="border-l-2 border-border-strong pl-2.5 text-[11px] leading-snug text-fg-muted">
                  {verdict.reason}
                </p>
              )}

              {row.hasValue && !row.unavailable && (
                <div className="flex flex-wrap items-end gap-2 border-t border-border-faint pt-2.5">
                  <div className="flex flex-col gap-1">
                    <Input
                      aria-label={`Value for ${row.label}`}
                      value={draft[row.key] ?? ""}
                      invalid={!!fieldError}
                      className="w-[220px] py-1.5 text-xs"
                      onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                    />
                    <FormError>{fieldError}</FormError>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pending}
                    onClick={() =>
                      run(row.key, () => setFlagValue({ key: row.key, value: draft[row.key] ?? "" }), `${row.label} updated`)
                    }
                  >
                    Save
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}

      {/* Reserved for the one direction that carries a stated consequence
          (allowed_domain, turned off): the sentence is shown BEFORE the
          click, not as a toast after — the selfRoleChangeWarning pattern. */}
      <Dialog
        open={pendingToggle !== null}
        onClose={() => setPendingToggle(null)}
        title={pendingToggle ? `Turn off ${pendingToggle.row.label}?` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingToggle(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => pendingToggle && submitToggle(pendingToggle.row, pendingToggle.next)}
            >
              Turn off
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {retryAfter !== null && (
            <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />
          )}
          {error && <Banner tone="fault" title={error} />}
          <p>{pendingToggle?.warning}</p>
        </div>
      </Dialog>
    </div>
  );
}
