"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { checkSameSupplierName } from "@/server/modules/suppliers/actions";

/**
 * Phase 23 (spec §8): the supplier form's live duplicate-name nudge —
 * debounced (400 ms) so every keystroke does not fire a request, and never a
 * write (`checkSameSupplierName` is read-only). Mirrors
 * `src/components/employees/same-name-check.tsx` minus the confirm checkbox:
 * this is a plain "someone already has this name" pointer to the existing
 * record, not a gate the caller has to confirm past.
 */
export function SupplierSameName({
  name,
  excludeId,
}: {
  name: string;
  excludeId?: string;
}) {
  const [match, setMatch] = useState<{ id: string; name: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const latestRef = useRef({ name, excludeId });
  latestRef.current = { name, excludeId };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!name.trim()) {
      setMatch(null);
      return;
    }
    timer.current = setTimeout(() => {
      void checkSameSupplierName({ name, excludeId }).then((res) => {
        if (!mountedRef.current) return;
        const stale = latestRef.current.name !== name || latestRef.current.excludeId !== excludeId;
        if (stale || !res.ok) return;
        setMatch(res.data.match);
      });
    }, 400);
  }, [name, excludeId]);

  if (!match) return null;

  return (
    <Banner tone="attention" title={`A supplier named "${match.name}" already exists`}>
      <Link href={`/purchases/suppliers/${match.id}`} className="underline">Open it</Link>
    </Banner>
  );
}
