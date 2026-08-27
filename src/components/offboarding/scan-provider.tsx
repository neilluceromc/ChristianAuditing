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

const ScanCtx = createContext<ScanState | null>(null);

/** Mirrors `useToast`'s convention: a consumer outside the provider must fail loudly, not silently never respond to a scan. */
export function useScan(): ScanState {
  const ctx = useContext(ScanCtx);
  if (!ctx) throw new Error("useScan must be used inside <ScanProvider>");
  return ctx;
}

/**
 * How long the buffer waits after the last keystroke before giving up on a
 * scan in progress and clearing it — a stray partial buffer must not poison
 * whatever gets typed next. This is NOT what tells a scan apart from a human
 * typing (nothing here does that distinction; matchScan runs on whatever is
 * in the buffer when Enter arrives, scanner or not — deliberately, since that
 * is what keeps the e2e spec able to drive this with a plain keyboard).
 */
const BUFFER_CLEAR_MS = 1600;

/**
 * `items` is plain, serialisable DATA — never a function — because the
 * Server Component that renders `step === "collect"` passes this in from a
 * server context, and a Server Component can only hand a Client Component a
 * function when it is itself a `"use server"` action. The already-rendered
 * cards go through untouched as `children`.
 *
 * `canDecide` gates the whole apparatus, not just the banner text: when the
 * viewer can't decide items (a `viewer` role, or an employee who isn't
 * OFFBOARDING), no `ItemDecision` renders at all, so nothing on the page
 * would ever react to a scan — inviting one anyway is a promise the page
 * can't keep. Held-but-nothing-to-scan (an empty `items`) is folded into the
 * same gate: "Scanning works here" above an empty-holdings screen is the
 * same false invitation.
 */
export function ScanProvider({
  items,
  canDecide,
  children,
}: {
  items: ScanItem[];
  canDecide: boolean;
  children: React.ReactNode;
}) {
  const active = canDecide && items.length > 0;
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
    if (!active) return; // nothing on this page can respond to a scan — see the gate above
    function onKeyDown(e: KeyboardEvent) {
      // The bug most likely to ship here: without a guard, typing a Reason is
      // captured as a scan and the textarea's own keystrokes vanish into the
      // buffer. But the guard must bail ONLY on elements that consume TEXT —
      // a mis-drawn version of this same guard (bailing on every <input>,
      // including a SegmentedControl's `sr-only` radio) killed the scanner
      // stone dead the moment an outcome was picked by hand, since clicking
      // a radio leaves focus sitting on it: every keystroke after that,
      // including a whole barcode, was silently dropped with no banner and
      // no verdict. Radios/checkboxes/buttons don't consume character input,
      // so they must fall through and keep buffering.
      if (e.target && (e.target as HTMLElement).isContentEditable) return;
      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag === "TEXTAREA" || targetTag === "SELECT") return;
      if (targetTag === "INPUT") {
        const type = (e.target as HTMLInputElement).type;
        if (type !== "radio" && type !== "checkbox" && type !== "button" && type !== "submit" && type !== "reset") {
          return;
        }
      }

      if (e.key === "Enter") {
        if (buffer.current !== "") { e.preventDefault(); flush(); }
        return;
      }
      if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
      buffer.current += e.key;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { buffer.current = ""; }, BUFFER_CLEAR_MS);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timer.current) clearTimeout(timer.current);
      buffer.current = ""; // a re-render mid-scan must not leave a partial buffer with no timer left to clear it
    };
  }, [flush, active]);

  return (
    <ScanCtx.Provider value={state}>
      <div className="flex flex-col gap-4">
        {active && (
          <>
            <Banner tone="neutral" title="Scanning works here">
              Point a USB scanner at an asset tag and this page will jump to that item and preselect
              Returned. It does not confirm anything — you still click Confirm, so a mis-scan costs
              nothing.
            </Banner>
            {/* Rule 10: every verdict the rule can return is rendered, not
                just the happy one. "ignored" is a deliberate silent no-op.
                `aria-live` wraps ONLY this slot, not the card list below it —
                a region spanning the whole collect step would announce far
                more than the one thing that just changed. A plain `<p>` for
                "match" rather than a `Banner`: `Banner` itself carries
                `role="alert"`/`role="status"`, so nesting one in here would
                stack a second live-region role on top of this div's own. */}
            <div aria-live="polite">
              {verdict?.kind === "match" && (
                <p className="text-xs text-fg-secondary">
                  {verdict.tag} — Returned preselected. Confirm to file it.
                </p>
              )}
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
          </>
        )}
        {children}
      </div>
    </ScanCtx.Provider>
  );
}
