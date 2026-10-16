"use client";

import { useEffect, useState } from "react";
import { spareCandidates } from "@/server/modules/employees/spare-actions";
import { SPARE_DEBOUNCE_MS, type SpareOption } from "@/lib/spare-candidates";

export type SpareLoad =
  | { status: "loading" }
  | { status: "ready"; items: SpareOption[] }
  | { status: "error" };

const LOADING: SpareLoad = { status: "loading" };

async function fetchSpares(employeeId: string, typeId: string | null, q: string): Promise<SpareLoad> {
  try {
    const res = await spareCandidates({ employeeId, assetTypeId: typeId ?? undefined, q: q || undefined });
    return res.ok ? { status: "ready", items: res.data } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/**
 * Phase 39 (spec §6): one picker's spares, asked for when it opens (`openKey` turns non-null) and again, 250 ms
 * after the operator stops typing. `base` is the untyped answer — what the dialog's "nothing in stock" and
 * "held or queued" lines are about — and `shown` the answer for the text in the box (`base` when it is empty).
 * A new `openKey` starts over; answers for an older key or older text are dropped.
 */
export function useSpareCandidates(employeeId: string, openKey: string | null, typeId: string | null) {
  const [seenKey, setSeenKey] = useState(openKey);
  const [q, setQ] = useState("");
  const [base, setBase] = useState<SpareLoad>(LOADING);
  const [found, setFound] = useState<{ q: string; load: SpareLoad } | null>(null);
  const [baseTry, setBaseTry] = useState(0);
  const [searchTry, setSearchTry] = useState(0);
  // Another dialog, or another tile's: forget the last one's text and answers before anything renders from them.
  if (openKey !== seenKey) {
    setSeenKey(openKey);
    setQ("");
    setBase(LOADING);
    setFound(null);
  }
  const term = q.trim();

  useEffect(() => {
    if (openKey === null) return;
    let live = true;
    void fetchSpares(employeeId, typeId, "").then((load) => { if (live) setBase(load); });
    return () => { live = false; };
  }, [employeeId, openKey, typeId, baseTry]);

  useEffect(() => {
    if (openKey === null || !term) return;
    let live = true;
    const timer = setTimeout(() => {
      void fetchSpares(employeeId, typeId, term).then((load) => { if (live) setFound({ q: term, load }); });
    }, SPARE_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [employeeId, openKey, typeId, term, searchTry]);

  const shown: SpareLoad = !term ? base : found && found.q === term ? found.load : LOADING;
  function retry() {
    if (base.status === "error") { setBase(LOADING); setBaseTry((n) => n + 1); }
    else { setFound(null); setSearchTry((n) => n + 1); }
  }
  return { q, setQ, term, base, shown, retry };
}

/** The picker's loading row, or its error row with a retry — never both, and nothing once the spares are in. */
export function SpareLoadRow({ load, onRetry }: { load: SpareLoad; onRetry: () => void }) {
  if (load.status === "loading") return <p role="status" className="text-xs text-fg-muted">Loading spares…</p>;
  if (load.status === "error") {
    return (
      <p role="alert" className="text-xs" style={{ color: "var(--error-text)" }}>
        Couldn&apos;t load the spares.{" "}
        <button type="button" className="font-medium underline" onClick={onRetry}>Try again</button>
      </p>
    );
  }
  return null;
}
