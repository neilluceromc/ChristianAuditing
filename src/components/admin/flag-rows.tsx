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
import { domainValue, flagChange, flagChangeWarning } from "@/lib/admin-flags";
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
  // `pending` itself is unused: `startTransition` still batches the async
  // calls below, but per-control busy state is tracked by `acting` instead —
  // see its comment.
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the SAME composite key as `acting` (`${row.key}:save`), not by
  // `row.key` alone: today only Save ever populates this, but keying it to
  // the control rather than the row keeps the two maps consistent if a
  // second control on a row ever needs its own field error.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // A deadline, not a duration — RateLimitNotice resets its own countdown on
  // every mount, and this component remounts it (top of the list vs. inside
  // the confirm dialog). Storing "when it ends" and computing the remaining
  // seconds fresh at render, instead of a `retryAfterSec` captured once, is
  // what keeps crossing that boundary from restarting the clock (Task 3's
  // bug, in user-table.tsx:41-53 — copied here rather than re-solved).
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  // Scoped to the one control actually in flight (`${row.key}:toggle` or
  // `${row.key}:save`) — the precedent is user-table.tsx's `acting`. Without
  // this, a single shared `pending` flag puts a spinner on every row's Save
  // button while a different row's switch confirmation is still in flight.
  const [acting, setActing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])),
  );

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  // `router.refresh()` re-renders this component with new `rows` props without
  // remounting it, so the lazy initializer above only ever runs once — left
  // alone, a Save that comes back normalized (lowercased, say) would write the
  // canonical value to the database while the input kept showing whatever the
  // admin actually typed. Keyed on the values themselves, not on `rows` (a new
  // array every render), so an unrelated switch toggle's refresh — which never
  // touches `value` — doesn't stomp an edit still in progress on this field.
  //
  // This alone still misses a NORMALIZING no-op: if the stored value is
  // "example.com" and the admin types "EXAMPLE.COM", domainValue normalizes
  // to the same string, nothing is written, and this key doesn't change — so
  // the box would keep showing "EXAMPLE.COM" forever. The Save handler below
  // covers that case directly, from the same domainValue() call it uses to
  // decide whether to submit at all.
  const valuesKey = rows.map((r) => `${r.key}:${r.value ?? ""}`).join("|");
  useEffect(() => {
    setDraft(Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey]);

  // A real generic over the one shape both actions share. `changed` decides
  // the toast wording (a value Save that normalizes to what's already stored
  // writes nothing and must not claim "updated"), but `router.refresh()` runs
  // on every `ok` regardless — the no-op branch is reachable only when this
  // row's props are already stale (another admin, or another tab, changed
  // the same flag), and in that one case the refresh IS the remedy. Staying
  // silent would leave the control looking like the click did nothing,
  // forever, until a manual reload.
  function run(
    actingKey: string,
    fn: () => Promise<ActionResult<{ changed: boolean }>>,
    messages: { changed: string; unchanged: string },
    opts?: {
      onOk?: (data: { changed: boolean }) => void;
      onSettled?: () => void;
      /** Where a `validation` refusal belongs. Only Save has a field to put it in. */
      validationTarget?: "field" | "banner";
    },
  ) {
    setError(null);
    setFieldErrors((f) => ({ ...f, [actingKey]: "" }));
    setActing(actingKey);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          opts?.onOk?.(res.data);
          toast(res.data.changed ? messages.changed : messages.unchanged, "settled");
          router.refresh();
        } else if (res.kind === "rate_limited") {
          setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        } else if (res.kind === "validation" && opts?.validationTarget === "field") {
          setFieldErrors((f) => ({ ...f, [actingKey]: Object.values(res.fieldErrors ?? {})[0] ?? res.message }));
        } else {
          // forbidden, conflict, or a validation refusal with no field to
          // hang it on (setFlag's schema has none — unreachable today, but a
          // refusal that routes nowhere is a silent failure waiting for the
          // day it isn't).
          setError(res.message);
        }
      } finally {
        setActing(null);
        opts?.onSettled?.();
      }
    });
  }

  function submitToggle(row: FlagRow, next: boolean) {
    run(
      `${row.key}:toggle`,
      () => setFlag({ key: row.key, enabled: next }),
      {
        changed: `${row.label} is ${next ? "on" : "off"}`,
        unchanged: `${row.label} is already ${next ? "on" : "off"}`,
      },
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
      setRetryDeadline(null);
      setPendingToggle({ row, next, warning });
    } else {
      submitToggle(row, next);
    }
  }

  function saveValue(row: FlagRow) {
    const raw = draft[row.key] ?? "";
    // Computed client-side too, ahead of the call: the server is still the
    // authority on whether the write happens, but knowing the NORMALIZED
    // value here is what lets the success path reset the box to it even on
    // a no-op (see valuesKey's comment above for why the effect alone misses
    // that case).
    const normalized = domainValue(raw);
    run(
      `${row.key}:save`,
      () => setFlagValue({ key: row.key, value: raw }),
      { changed: `${row.label} updated`, unchanged: `${row.label} is already set to that value` },
      {
        validationTarget: "field",
        onOk: () => {
          if (normalized.ok) setDraft((d) => ({ ...d, [row.key]: normalized.value }));
        },
      },
    );
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      {retryAfterSec !== null && !pendingToggle && (
        <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={() => setRetryDeadline(null)} />
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
        const saveKey = `${row.key}:save`;
        const fieldError = fieldErrors[saveKey];

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
                  disabled={acting !== null || !verdict.allowed}
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
                    loading={acting === saveKey}
                    disabled={acting !== null && acting !== saveKey}
                    onClick={() => saveValue(row)}
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
              loading={pendingToggle ? acting === `${pendingToggle.row.key}:toggle` : false}
              onClick={() => pendingToggle && submitToggle(pendingToggle.row, pendingToggle.next)}
            >
              Turn off
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {retryAfterSec !== null && (
            <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={() => setRetryDeadline(null)} />
          )}
          {error && <Banner tone="fault" title={error} />}
          <p>{pendingToggle?.warning}</p>
        </div>
      </Dialog>
    </div>
  );
}
