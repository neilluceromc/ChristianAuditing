"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const getTheme = () => document.documentElement.dataset.theme ?? "light";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light");
  const toggle = useCallback(() => {
    const next = getTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `br.theme=${next};path=/;max-age=31536000;samesite=lax`;
  }, []);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="rounded-(--radius-btn) border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-subtle"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
