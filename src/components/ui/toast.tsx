"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPausableTimer, firstUsable, toastLifetime, type PausableTimer, type ToastTone } from "@/lib/toast-timing";
import { StatusDot } from "./status";

type Tone = ToastTone;

/** One button inside the toast (the worklist's Undo); pressing it runs the action and closes the toast. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
  action?: ToastAction;
}

type Push = (message: string, tone?: Tone, action?: ToastAction) => void;

const ToastContext = createContext<Push | null>(null);

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}

let nextId = 1;

const TONE_LABEL: Record<Tone, string> = { settled: "Success: ", fault: "Error: ", neutral: "" };
const TONE_STATUS: Record<Tone, string> = { settled: "EXECUTED", fault: "REJECTED", neutral: "SPARE" };

/**
 * One toast. The countdown (src/lib/toast-timing.ts) pauses while the pointer is over it or focus is inside it,
 * so a button (Undo, Dismiss) is never taken away mid-reach; an error has no countdown and stays until dismissed.
 */
function ToastCard({ toast: t, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const timer = useRef<PausableTimer | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);

  useEffect(() => {
    const ms = toastLifetime(t.tone, Boolean(t.action));
    if (ms === null) return;
    const timerNow = createPausableTimer(ms, () => onDismiss(t.id));
    timer.current = timerNow;
    return () => {
      timerNow.cancel();
      timer.current = null;
    };
  }, [t.id, t.tone, t.action, onDismiss]);

  const sync = () => (hovered.current || focused.current ? timer.current?.pause() : timer.current?.resume());

  return (
    <div
      data-toast-id={t.id}
      role={t.tone === "fault" ? "alert" : undefined}
      className="pointer-events-auto flex items-center gap-2 rounded-(--radius-card) border border-border bg-surface-raised px-3.5 py-2.5 text-xs text-fg shadow-toast"
      style={{ animation: "toastIn var(--dur-3) var(--ease-std)" }}
      onMouseEnter={() => { hovered.current = true; sync(); }}
      onMouseLeave={() => { hovered.current = false; sync(); }}
      onFocus={() => { focused.current = true; sync(); }}
      onBlur={(e) => {
        // focus moving between the toast's own buttons is still "inside"
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focused.current = false;
        sync();
      }}
    >
      <StatusDot value={TONE_STATUS[t.tone]} />
      <span className="sr-only">{TONE_LABEL[t.tone]}</span>
      {t.message}
      {t.action && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => {
              onDismiss(t.id);
              t.action!.onAction();
            }}
          >
            {t.action.label}
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="-mr-1.5 ml-1 rounded-[4px] p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg"
        onClick={() => onDismiss(t.id)}
      >
        {/* an svg, not a "×" character, so the toast's text stays its message */}
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
          <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
        </svg>
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const region = useRef<HTMLDivElement>(null);
  /** the element that had focus just before it entered the toasts, so a dismissal can hand focus back to it */
  const opener = useRef<HTMLElement | null>(null);

  const dismiss = useCallback((id: number) => {
    // If the toast going away holds focus, move it first — to the next toast's Dismiss, else where it came from,
    // else the page's main region — so it is never dropped on the body. (Auto-expiry only reaches here unfocused.)
    const root = region.current;
    const card = root?.querySelector<HTMLElement>(`[data-toast-id="${id}"]`);
    if (root && card && card.contains(document.activeElement)) {
      const others = Array.from(root.querySelectorAll<HTMLElement>("[data-toast-id]")).filter((c) => c !== card);
      const after = others.find((c) => card.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) ?? others[others.length - 1];
      const target = firstUsable<HTMLElement>(
        [
          after?.querySelector<HTMLElement>('button[aria-label="Dismiss"]'),
          opener.current,
          document.getElementById("main"),
        ],
        (el) =>
          el.isConnected && !card.contains(el) && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
      );
      target?.focus();
    }
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback<Push>((message, tone = "neutral", action) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone, action }]);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Live region stays mounted so insertions announce; it must never block clicks. */}
      <div
        ref={region}
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2"
        onFocus={(e) => {
          // focus coming in from outside the toasts: remember where from. Coming from nowhere (the window, the
          // address bar) clears it, so a dismissal never hands focus back to an opener from an earlier visit.
          const from = e.relatedTarget;
          if (from === null) opener.current = null;
          else if (from instanceof HTMLElement && !e.currentTarget.contains(from)) opener.current = from;
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
