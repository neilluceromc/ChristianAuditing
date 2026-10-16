"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { M365_CANONICAL } from "@/lib/labels";
import { m365Live } from "@/lib/offboarding";
import { useEmployeeRunner } from "@/components/employees/use-employee-runner";
import { liveAccessFields, SETUP_LABELS, SETUP_STATE_LABELS, VPN_REMOVED, type SetupField, type SetupRecord } from "@/lib/it-setup";
import { setItSetup } from "@/server/modules/employees/setup-actions";
import { closeAccounts } from "@/server/modules/offboarding/actions";

const CUSTOM = "__custom";

/** the server bound (accountsSchema), mirrored so the field stops you first */
const MAX_STATUS = 60;

/**
 * Step 3 is where the M365 status actually moves (README 4f): the canonical
 * four plus a custom value stored as-is. A never-synced account keeps reading
 * "never had an account" rather than a false "inactive". Plan P-5: clearing a
 * LIVE status to null is a deliberate erasure, not a plain choice, so it asks
 * first — in a dialog naming the person, confirmed with a verb.
 */
export function AccountsPanel({
  employeeId,
  employeeName,
  m365Status,
}: {
  employeeId: string;
  employeeName: string;
  m365Status: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const isCustom = m365Status !== null && !(M365_CANONICAL as readonly string[]).includes(m365Status);
  const [select, setSelect] = useState(m365Status === null ? "" : isCustom ? CUSTOM : m365Status);
  const [custom, setCustom] = useState(isCustom ? m365Status : "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState<"written" | "unchanged" | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const live = m365Live(m365Status);
  // Inactive is the suggested choice once a live account is on record — the
  // whole point of this step is to get here, so it leads instead of hiding
  // fourth in the canonical list.
  const orderedCanonical = live ? ["inactive", ...M365_CANONICAL.filter((s) => s !== "inactive")] : M365_CANONICAL;

  function run(next: string, confirmClear?: boolean) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await closeAccounts({ employeeId, m365Status: next, confirmClear });
      if (res.ok) {
        setConfirmClearOpen(false);
        setSaved(res.data.changed ? "written" : "unchanged");
        setTimeout(() => setSaved(null), 3000);
        toast(`Account status is now ${res.data.m365Status ?? "never had an account"}`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      // a too-long custom value is a real refusal: without this branch the
      // operator gets "Fix the highlighted fields." with no field highlighted
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setFieldErrors({ custom: fe.m365Status ?? fe.custom ?? "" });
        // keys no field on this form claims must not dead-end silently
        const unclaimed = Object.entries(fe).filter(([k]) => k !== "m365Status" && k !== "custom");
        if (unclaimed.length > 0) setError(unclaimed.map(([, v]) => v).join(" "));
        else if (!fe.m365Status && !fe.custom) setError(res.message);
      } else setError(res.message);
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = select === CUSTOM ? custom.trim() : select;
    // An empty custom value trims to "", which the action reads as null — i.e.
    // "this person never had an account". Picking "custom…" and typing nothing
    // would therefore erase a real status by accident, with a toast that reads
    // like a success. Refuse it here, where the operator's intent actually is.
    if (select === CUSTOM && next === "") {
      setFieldErrors({ custom: "Type the status, or pick one from the list above." });
      return;
    }
    // Clearing a LIVE status to "never had an account" is an erasure, not a
    // correction — confirm it in a dialog naming the person before the server
    // ever sees confirmClear (plan P-5).
    if (select === "" && live) {
      setError(null);
      setFieldErrors({});
      setConfirmClearOpen(true);
      return;
    }
    setError(null);
    setFieldErrors({});
    run(next);
  }

  return (
    <>
      <form onSubmit={submit} className="flex max-w-[420px] flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField
          label="Microsoft 365 account status"
          hint="An offboarding can only be completed once this reads inactive (or the person never had an account)."
        >
          {(p) => (
            <Select
              id={p.id}
              aria-describedby={p["aria-describedby"]}
              value={select}
              onChange={(e) => setSelect(e.target.value)}
            >
              <option value="">Never had an account</option>
              {orderedCanonical.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value={CUSTOM}>custom…</option>
            </Select>
          )}
        </FormField>
        {select === CUSTOM && (
          <FormField
            label="Custom value"
            required
            hint="Stored exactly as typed."
            error={fieldErrors.custom}
          >
            {(p) => (
              <Input
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                maxLength={MAX_STATUS}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            )}
          </FormField>
        )}
        <div className="flex items-center gap-2">
          {/* the button holds its width across idle → spinner → ✓ Saved */}
          <Button type="submit" variant="primary" loading={pending}>
            {saved ? "✓ Saved" : "Save account status"}
          </Button>
          {saved && (
            <span className="font-mono text-[10.5px]" style={{ color: "var(--st-settled-text)" }}>
              {saved === "written" ? "audit entry written" : "already set — nothing to change"}
            </span>
          )}
        </div>
      </form>
      <Dialog
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title={`Clear ${employeeName}'s Microsoft 365 status? Only do this if they never had an account.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClearOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => run("", true)}>Clear status</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <p className="text-xs text-fg-secondary">
            The status on record is <span className="font-mono">{m365Status}</span>. Clearing it is for
            correcting a mistaken entry — not a substitute for actually deactivating the account.
          </p>
        </div>
      </Dialog>
    </>
  );
}

const ACCESS_ROWS: Array<{ field: SetupField; value: (s: SetupRecord) => string | null }> = [
  { field: "entra", value: (s) => s.entraStatus },
  { field: "autopilot", value: (s) => s.autopilotStatus },
  { field: "argus", value: (s) => s.argusStatus },
  { field: "vpn", value: (s) => s.vpn },
];

/**
 * Phase 40 (spec §7): under Microsoft 365, the four IT-access rows with their current value. A live one (Done, or
 * a named VPN) offers Mark removed, which writes Removed through setItSetup; the Finish checklist and the server
 * gate stay blocked until none is live. A viewer sees the values without the button.
 */
export function ItAccessSection({
  employeeId, setup, canRemove,
}: {
  employeeId: string;
  setup: SetupRecord;
  canRemove: boolean;
}) {
  const { pending, error, retryAfter, setRetryAfter, run } = useEmployeeRunner();
  const [busy, setBusy] = useState<SetupField | null>(null);
  const live = new Set(liveAccessFields(setup));

  function remove(field: SetupField) {
    setBusy(field);
    run(
      () => setItSetup(field === "vpn" ? { employeeId, field, value: VPN_REMOVED } : { employeeId, field, value: "REMOVED" }),
      `${SETUP_LABELS[field]} marked removed`,
      { onFail: () => setBusy(null), onOk: () => setBusy(null) },
    );
  }

  return (
    <section aria-labelledby="it-access-heading" className="flex max-w-[420px] flex-col gap-2 border-t border-line pt-3">
      <h3 id="it-access-heading" className="text-xs font-semibold text-fg">IT access</h3>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <ul className="flex flex-col gap-1.5">
        {ACCESS_ROWS.map(({ field, value }) => {
          const v = value(setup);
          const shown = v === null ? "Not recorded" : (SETUP_STATE_LABELS as Record<string, string>)[v] ?? v;
          return (
            <li key={field} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-fg-secondary">{SETUP_LABELS[field]}</span>
              <span className="flex items-center gap-2">
                <span className="text-fg">{shown}</span>
                {canRemove && live.has(field) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Mark removed: ${SETUP_LABELS[field]}`}
                    loading={pending && busy === field}
                    disabled={pending}
                    onClick={() => remove(field)}
                  >
                    Mark removed
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
