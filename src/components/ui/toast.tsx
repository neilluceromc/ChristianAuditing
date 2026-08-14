"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StatusDot } from "./status";

type Tone = "settled" | "fault" | "neutral";

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return push;
}

let nextId = 1;

const TONE_LABEL: Record<Tone, string> = { settled: "Success: ", fault: "Error: ", neutral: "" };
const TONE_STATUS: Record<Tone, string> = { settled: "EXECUTED", fault: "REJECTED", neutral: "SPARE" };

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

  const push = useCallback((message: string, tone: Tone = "neutral") => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone }]);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 4000),
    );
  }, []);

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
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
