"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ASSET_STATUSES } from "@/lib/inventory-list";
import { bulkRequestStatusChange } from "@/server/modules/inventory/actions";

export function BulkDrawer({
  open,
  onClose,
  selectedIds,
  allMatching,
  filtersQS,
  total,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  allMatching: boolean;
  filtersQS: string; // serialized current list state, no leading "?"
  total: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [to, setTo] = useState<string>("SPARE");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const scope = allMatching ? `all ${total} matching assets` : `${selectedIds.length} selected asset${selectedIds.length === 1 ? "" : "s"}`;

  function submit() {
    setError(null);
    setFieldErrors({});
    setRetryAfter(null);
    startTransition(async () => {
      const res = await bulkRequestStatusChange({
        ids: allMatching ? undefined : selectedIds,
        filters: allMatching ? filtersQS : undefined,
        to,
        reason,
      });
      if (res.ok) {
        toast(
          `${res.data.created} approval${res.data.created === 1 ? "" : "s"} created` +
            (res.data.skipped ? ` · ${res.data.skipped} skipped (already there or already requested)` : ""),
          "settled",
        );
        setReason(""); // a fresh batch never inherits the last batch's reason
        onDone();
        handleClose();
        router.refresh();
      } else if (res.kind === "rate_limited") {
        setRetryAfter(res.retryAfterSec ?? 60);
      } else if (res.kind === "validation") {
        setFieldErrors(res.fieldErrors ?? {});
        // Field errors no FormField below claims (ids/filters/_form) must not
        // dead-end silently — surface them in the banner.
        const unclaimed = res.fieldErrors?.ids ?? res.fieldErrors?.filters ?? res.fieldErrors?._form;
        if (unclaimed) setError(unclaimed);
      } else {
        setError(res.message);
      }
    });
  }

  function handleClose() {
    setError(null);
    setFieldErrors({});
    setRetryAfter(null);
    onClose();
  }

  return (
    <Drawer open={open} onClose={handleClose} title="Bulk actions">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-fg-muted">
          Acting on <span className="font-medium text-fg-secondary">{scope}</span>. Each asset gets its
          own <span className="font-mono">lifecycle.change-status</span> approval — nothing changes until
          it&apos;s approved and executed.
        </p>
        <a
          href={allMatching || selectedIds.length === 0
            ? `/inventory/export${filtersQS ? `?${filtersQS}` : ""}`
            : `/inventory/export?ids=${selectedIds.join(",")}`}
          className="text-xs text-accent hover:underline"
        >
          Export this selection as a spreadsheet
        </a>
        {/* Labels come from an explicit selection only: "all matching" would
            make one click a 17-sheet print job, and labelling a whole filtered
            fleet is not a real intent. `selectedIds.length > 0` is
            belt-and-braces rather than a live branch today — the drawer only
            opens via "Bulk actions…" in inventory-table.tsx, which itself
            requires selected.size > 0, so this component can't currently be
            rendered with an empty, non-allMatching selection. Kept anyway so
            the link stays ABSENT, not disabled, if that caller ever changes —
            the house rule for affordances that cannot act. */}
        {!allMatching && selectedIds.length > 0 && (
          <a
            href={`/inventory/labels?ids=${selectedIds.join(",")}`}
            className="text-xs text-accent hover:underline"
          >
            Print labels for {selectedIds.length} selected
          </a>
        )}
        {/* The branch that actually matters: "all matching" has no id list to
            build a ?ids= from, and printing a whole filtered fleet was never
            a real intent (see above) — so under this state the affordance is
            silently absent rather than merely disabled. That silence needs a
            sentence, the same way every other unreachable-affordance case in
            this app gets one, because the alternative is an operator staring
            at a drawer with no explanation for why Print labels isn't there. */}
        {allMatching && <p className="text-xs text-fg-faint">Labels need an explicit selection.</p>}
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="Target status" required error={fieldErrors.to}>
          {(props) => (
            <Select
              id={props.id}
              aria-describedby={props["aria-describedby"]}
              invalid={props.invalid}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Reason" required error={fieldErrors.reason} hint="Goes into every approval's payload.">
          {(props) => (
            <Textarea
              id={props.id}
              aria-describedby={props["aria-describedby"]}
              invalid={props.invalid}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            Request status change
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
