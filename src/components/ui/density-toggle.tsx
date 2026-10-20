"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseDensity, topbarNext, type Density } from "@/lib/density";
import { saveUiPref } from "@/server/ui-prefs";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-density"] });
  return () => obs.disconnect();
}
const getDensity = (): Density => parseDensity(document.documentElement.dataset.density);

/**
 * The one way density changes: the html attribute (live), the br.density cookie (the next server render), and the
 * person's saved prefs (Phase 47 spec §5.4: it follows them, not the browser).
 */
export function setDensity(d: Density) {
  document.documentElement.dataset.density = d;
  document.cookie = `br.density=${d};path=/;max-age=31536000;samesite=lax`;
  void saveUiPref({ density: d }).catch(() => {});
}

/** The live row size (html data-density), re-rendering on every change; comfortable on the server. */
export function useDensity(): Density {
  return useSyncExternalStore(subscribe, getDensity, (): Density => "comfortable");
}

export function DensityToggle() {
  const density = useDensity();
  const toggle = useCallback(() => {
    setDensity(topbarNext(getDensity()));
  }, []);
  // The label names what the button switches to; with Dense on that is Comfortable.
  const next = topbarNext(density);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} density`}
      className="rounded-(--radius-btn) border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-subtle"
    >
      {next === "compact" ? "Compact" : "Comfortable"}
    </button>
  );
}
