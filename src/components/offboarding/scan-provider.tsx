"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { matchScan, type ScanItem, type ScanVerdict } from "@/lib/scan";

/**
 * A USB barcode scanner is a keyboard: it types the payload fast and presses
 * Enter. So this is keystroke buffering, not hardware work.
 *
 * `nonce` increments on every accepted scan so scanning the SAME tag twice
 * re-triggers — without it, re-scanning an item after changing your mind would
 * be inert, which reads as a broken scanner.
 *
 * Nothing here writes. A scan stages a decision; Confirm files it.
 */
interface ScanState {
  tag: string | null;
  nonce: number;
}

const ScanCtx = createContext<ScanState>({ tag: null, nonce: 0 });

export function useScan(): ScanState {
  return useContext(ScanCtx);
}

/** Characters this far apart are a human typing, not a scanner. */
const BUFFER_IDLE_MS = 400;

/**
 * `items` is plain, serialisable DATA — never a function — because the
 * Server Component that renders `step === "collect"` passes this in from a
 * server context, and a Server Component can only hand a Client Component a
 * function when it is itself a `"use server"` action. The already-rendered
 * cards go through untouched as `children`.
 */
export function ScanProvider({ items, children }: { items: ScanItem[]; children: React.ReactNode }) {
  const [state, setState] = useState<ScanState>({ tag: null, nonce: 0 });
  const [verdict, setVerdict] = useState<ScanVerdict | null>(null);
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const raw = buffer.current;
    buffer.current = "";
    const v = matchScan(raw, items);
    if (v.kind === "ignored") return;
    setVerdict(v);
    if (v.kind === "match") setState((s) => ({ tag: v.tag, nonce: s.nonce + 1 }));
  }, [items]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // The bug most likely to ship here: without this guard, typing a Reason
      // is captured as a scan and the textarea's own keystrokes vanish into
      // the buffer.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;

      if (e.key === "Enter") {
        if (buffer.current !== "") { e.preventDefault(); flush(); }
        return;
      }
      if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
      buffer.current += e.key;
      if (timer.current) clearTimeout(timer.current);
      // A partial scan must not poison the next one.
      timer.current = setTimeout(() => { buffer.current = ""; }, BUFFER_IDLE_MS * 4);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  return (
    <ScanCtx.Provider value={state}>
      <div className="flex flex-col gap-4">
        <Banner tone="neutral" title="Scanning works here">
          Point a USB scanner at an asset tag and this page will jump to that item and preselect
          Returned. It does not confirm anything — you still click Confirm, so a mis-scan costs
          nothing.
        </Banner>
        {/* Rule 10: every verdict the rule can return is rendered, not just
            the happy one — "match" needs no banner of its own, it is what
            drives the highlighted card below, and "ignored" is a deliberate
            silent no-op. `aria-live` wraps ONLY this verdict slot, not the
            card list below it — a region spanning the whole collect step
            would announce far more than the one thing that just changed. */}
        <div aria-live="polite">
          {verdict?.kind === "unknown" && (
            <Banner tone="fault" title={`${verdict.value} is not one of this person's items.`}>
              Check you scanned the right sticker — this asset is not in their name.
            </Banner>
          )}
          {verdict?.kind === "already-decided" && (
            <Banner tone="attention" title={`${verdict.tag} is already decided.`}>
              Its request has been filed. Nothing further is needed for that item.
            </Banner>
          )}
          {verdict?.kind === "blocked" && (
            <Banner tone="attention" title={`${verdict.tag} is held by ${verdict.refNo}.`}>
              Resolve that request first — this item cannot be decided until it clears.
            </Banner>
          )}
        </div>
        {children}
      </div>
    </ScanCtx.Provider>
  );
}
