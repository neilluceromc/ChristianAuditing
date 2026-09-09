"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { setRequestSupplier } from "@/server/modules/purchases/supplier-actions";

export interface SupplierOption {
  id: string;
  name: string;
  archived: boolean;
}

/** Spec §5.2: the request's Supplier card — a read-only current value, plus a picker for whoever may set it. */
export function SupplierPicker({
  requestId,
  current,
  options,
  canSet,
}: {
  requestId: string;
  current: { id: string; name: string; archived: boolean } | null;
  options: SupplierOption[];
  canSet: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // Keeps the Select in step with the server-confirmed value after a save
  // (router.refresh() re-fetches `current` without remounting this component).
  useEffect(() => {
    setValue(current?.id ?? "");
  }, [current?.id]);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setRequestSupplier({ id: requestId, vendorId: value || null });
      if (res.ok) {
        toast("Supplier saved", "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <p className="text-sm text-fg">
        {current ? (
          <span className="inline-flex items-center gap-2">
            <Link href={`/purchases/suppliers/${current.id}`} className="font-medium text-accent hover:underline">
              {current.name}
            </Link>
            {current.archived && <Pill>ARCHIVED</Pill>}
          </span>
        ) : (
          <span className="text-fg-muted">Not set</span>
        )}
      </p>

      {canSet && (
        <div className="flex items-center gap-2">
          <Select
            aria-label="Supplier"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="max-w-[260px]"
          >
            <option value="">No supplier</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.archived ? " (archived)" : ""}
              </option>
            ))}
          </Select>
          <Button size="sm" loading={pending} onClick={save}>Save supplier</Button>
        </div>
      )}
    </div>
  );
}
