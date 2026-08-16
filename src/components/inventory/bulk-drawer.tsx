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
        onDone();
        onClose();
        router.refresh();
      } else if (res.kind === "rate_limited") {
        setRetryAfter(res.retryAfterSec ?? 60);
      } else if (res.kind === "validation") {
        setFieldErrors(res.fieldErrors ?? {});
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <Drawer open={open} onClose={onClose} title="Bulk actions">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-fg-muted">
          Acting on <span className="font-medium text-fg-secondary">{scope}</span>. Each asset gets its
          own <span className="font-mono">lifecycle.change-status</span> approval — nothing changes until
          it&apos;s approved and executed.
        </p>
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
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            Request status change
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
