"use client";

import { useEffect, useState } from "react";
import { spareCandidates } from "@/server/modules/employees/spare-actions";
import { SPARE_DEBOUNCE_MS, SPARE_QUERY_MAX, type SpareCandidateCounts, type SpareOption } from "@/lib/spare-candidates";

export type SpareLoad =
  | { status: "loading" }
  | { status: "ready"; items: SpareOption[]; counts: SpareCandidateCounts | null }
  | { status: "error" };

const LOADING: SpareLoad = { status: "loading" };

async function fetchSpares(employeeId: string, typeId: string | null, q: string, pickable: boolean): Promise<SpareLoad> {
  try {
    const res = await spareCandidates({
      employeeId, assetTypeId: typeId ?? undefined, q: q || undefined, pickable: pickable || undefined,
    });
    return res.ok ? { status: "ready", items: res.data.spares, counts: res.data.counts } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/**
 * Phase 39 (spec §6): one picker's spares, asked for when it opens (`openKey` turns non-null) and again, 250 ms
 * after the operator stops typing. `base` is the untyped answer — with the pool-wide counts the dialog's
 * "nothing in stock", "held or queued" and preselect read — and `shown` the answer for the text in the box
 * (`base` when it is empty). `rows` keeps the previous answer on screen while the next one loads (`busy`), so a
 * keystroke never flickers the list; it is null only before the first answer or after a failure.
 * A new `openKey` starts over; answers for an older key or older text are dropped.
 * `pickable` (Replace, Reserve): the rows leave out spares held or queued for someone else, server-side.
 */
export function useSpareCandidates(
  employeeId: string, openKey: string | null, typeId: string | null, opts?: { pickable?: boolean },
) {
  const pickable = opts?.pickable ?? false;
  const [seenKey, setSeenKey] = useState(openKey);
  const [q, setQRaw] = useState("");
  const [base, setBase] = useState<SpareLoad>(LOADING);
  const [found, setFound] = useState<{ q: string; load: SpareLoad } | null>(null);
  const [lastRows, setLastRows] = useState<SpareOption[] | null>(null);
  const [baseTry, setBaseTry] = useState(0);
  const [searchTry, setSearchTry] = useState(0);
  const term = q.trim();
  const shown: SpareLoad = !term ? base : found && found.q === term ? found.load : LOADING;
  // Another dialog, or another tile's: forget the last one's text and answers before anything renders from them.
  if (openKey !== seenKey) {
    setSeenKey(openKey);
    setQRaw("");
    setBase(LOADING);
    setFound(null);
    setLastRows(null);
  } else if (shown.status === "ready" && shown.items !== lastRows) {
    setLastRows(shown.items);
  }

  useEffect(() => {
    if (openKey === null) return;
    let live = true;
    void fetchSpares(employeeId, typeId, "", pickable).then((load) => { if (live) setBase(load); });
    return () => { live = false; };
  }, [employeeId, openKey, typeId, baseTry, pickable]);

  useEffect(() => {
    if (openKey === null || !term) return;
    let live = true;
    const timer = setTimeout(() => {
      void fetchSpares(employeeId, typeId, term, pickable).then((load) => { if (live) setFound({ q: term, load }); });
    }, SPARE_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [employeeId, openKey, typeId, term, searchTry, pickable]);

  const rows = shown.status === "ready" ? shown.items : shown.status === "loading" ? lastRows : null;
  const busy = shown.status === "loading" && lastRows !== null;
  /** The load a loading or error row speaks for: the first answer until it is in, then the search's. */
  const pending: SpareLoad = base.status !== "ready" ? base : shown;
  function retry() {
    if (base.status === "error") { setBase(LOADING); setBaseTry((n) => n + 1); }
    else { setFound(null); setSearchTry((n) => n + 1); }
  }
  const setQ = (text: string) => setQRaw(text.slice(0, SPARE_QUERY_MAX));
  return { q, setQ, base, shown, rows, busy, pending, retry };
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

/** The first field a dialog's trap would have focused, for when the field that held focus has just gone away. */
export function refocusFirstField(container: HTMLElement | null) {
  if (!container) return;
  const active = document.activeElement;
  if (active && active !== document.body && container.ownerDocument.contains(active)) return;
  const field = container.querySelector<HTMLElement>(
    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]',
  );
  field?.focus();
}
