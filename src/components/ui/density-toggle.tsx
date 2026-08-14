"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-density"] });
  return () => obs.disconnect();
}
const getDensity = () => document.documentElement.dataset.density ?? "comfortable";

export function DensityToggle() {
  const density = useSyncExternalStore(subscribe, getDensity, () => "comfortable");
  const toggle = useCallback(() => {
    const next = getDensity() === "compact" ? "comfortable" : "compact";
    document.documentElement.dataset.density = next;
    document.cookie = `br.density=${next};path=/;max-age=31536000;samesite=lax`;
  }, []);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${density === "compact" ? "comfortable" : "compact"} density`}
      className="rounded-(--radius-btn) border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-subtle"
    >
      {density === "compact" ? "Comfortable" : "Compact"}
    </button>
  );
}
