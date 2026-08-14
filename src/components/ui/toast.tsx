"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { StatusDot } from "./status";

interface ToastItem {
  id: number;
  message: string;
  tone: "settled" | "fault" | "neutral";
}

const ToastContext = createContext<(message: string, tone?: ToastItem["tone"]) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastItem["tone"] = "neutral") => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-(--radius-card) border border-border bg-surface-raised px-3.5 py-2.5 text-xs text-fg shadow-toast"
            style={{ animation: "toastIn var(--dur-3) var(--ease-std)" }}
          >
            <StatusDot value={t.tone === "settled" ? "EXECUTED" : t.tone === "fault" ? "REJECTED" : "SPARE"} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
