"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StatusDot } from "./status";

type Tone = "settled" | "fault" | "neutral";

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

/** How long a toast stays; one with an action stays longer so its button can be reached. */
const TOAST_MS = 4000;
const ACTION_TOAST_MS = 8000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback<Push>((message, tone = "neutral", action) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone, action }]);
    timers.current.set(id, setTimeout(() => dismiss(id), action ? ACTION_TOAST_MS : TOAST_MS));
  }, [dismiss]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Live region stays mounted so insertions announce; it must never block clicks. */}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "fault" ? "alert" : undefined}
            className="pointer-events-auto flex items-center gap-2 rounded-(--radius-card) border border-border bg-surface-raised px-3.5 py-2.5 text-xs text-fg shadow-toast"
            style={{ animation: "toastIn var(--dur-3) var(--ease-std)" }}
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
                    dismiss(t.id);
                    t.action!.onAction();
                  }}
                >
                  {t.action.label}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
