"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { M365_CANONICAL } from "@/lib/labels";
import { closeAccounts } from "@/server/modules/offboarding/actions";

const CUSTOM = "__custom";

/** the server bound (accountsSchema), mirrored so the field stops you first */
const MAX_STATUS = 60;

/**
 * Step 3 is where the M365 status actually moves (README 4f): the canonical
 * four plus a custom value stored as-is. A never-synced account keeps reading
 * "no sync yet" rather than a false "inactive".
 */
export function AccountsPanel({
  employeeId,
  m365Status,
}: {
  employeeId: string;
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
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await closeAccounts({ employeeId, m365Status: next });
      if (res.ok) {
        setSaved(res.data.changed ? "written" : "unchanged");
        setTimeout(() => setSaved(null), 3000);
        toast(`Account status is now ${res.data.m365Status ?? "no sync yet"}`, "settled");
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

  return (
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
            <option value="">no sync yet</option>
            {M365_CANONICAL.map((s) => (
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
          hint="Stored verbatim; unknown values render in the Neutral family."
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
  );
}
