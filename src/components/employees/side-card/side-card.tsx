"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  SIDE_TABS, pickSideTab, readStoredTab, sideBadges, tabAfterKey, writeStoredTab, type SideBadge, type SideTab,
} from "@/lib/side-card";

const LABELS: Record<SideTab, string> = { notes: "Notes", setup: "IT setup", form: "Form", transfers: "Transfers" };

/** `window.localStorage` itself throws when site data is blocked — that is just "no memory". */
function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function Badge({ badge }: { badge: SideBadge }) {
  return badge.tone === "warning" ? (
    <span
      className="rounded-full border px-1.5 py-px text-[10.5px] font-medium leading-tight"
      style={{ background: "var(--st-attention-bg)", color: "var(--st-attention-text)", borderColor: "var(--st-attention-border)" }}
    >
      {badge.text}
    </span>
  ) : (
    <span className="rounded-full bg-border-faint px-1.5 py-px font-mono text-[10.5px] leading-tight text-fg-muted">
      {badge.text}
    </span>
  );
}

/**
 * Phase 39 (spec §2.1): the profile's right column as one card with four tabs — Notes · IT setup · Form ·
 * Transfers. The tab row is a labelled tablist with roving focus (←/→ wrap, Home/End jump; moving selects).
 * The server and the first client paint always show Notes, so hydration matches; after mount `?side=` (else the
 * remembered tab, `br.profile-side-tab`) takes over. Every panel stays mounted (`hidden` when not chosen), so a
 * half-typed note or an "Other…" VPN name survives a tab switch. No fixed height: each tab is short by design.
 */
export function SideCard({
  counts, panels,
}: {
  counts: Parameters<typeof sideBadges>[0];
  panels: Record<SideTab, React.ReactNode>;
}) {
  const [tab, setTab] = useState<SideTab>("notes");
  const tabRefs = useRef<Partial<Record<SideTab, HTMLButtonElement | null>>>({});
  const badges = sideBadges(counts);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTab(pickSideTab(params.get("side"), readStoredTab(store()), params.get("notes")));
  }, []);

  function choose(next: SideTab) {
    setTab(next);
    writeStoredTab(store(), next);
    // A link's ?side= would otherwise win over this choice on the next reload.
    const url = new URL(window.location.href);
    if (url.searchParams.has("side") && url.searchParams.get("side") !== next) {
      url.searchParams.set("side", next);
      window.history.replaceState(null, "", url);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = tabAfterKey(tab, e.key);
    if (!next) return;
    e.preventDefault();
    choose(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="rounded-(--radius-card) border border-border bg-surface shadow-card">
      <div
        role="tablist"
        aria-label="About this person"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-x-0.5 border-b border-border-faint px-2"
      >
        {SIDE_TABS.map((t) => {
          const selected = t === tab;
          const badge = badges[t];
          return (
            <button
              key={t}
              ref={(el) => { tabRefs.current[t] = el; }}
              type="button"
              role="tab"
              id={`side-tab-${t}`}
              aria-selected={selected}
              aria-controls={`side-panel-${t}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(t)}
              className={cn(
                "relative inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-[12.5px] font-medium transition-colors duration-(--dur-1)",
                selected ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              <span>{LABELS[t]}</span>{" "}
              {badge && <Badge badge={badge} />}
              {selected && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] bg-accent" />}
            </button>
          );
        })}
      </div>
      {SIDE_TABS.map((t) => (
        <div
          key={t}
          id={`side-panel-${t}`}
          role="tabpanel"
          aria-labelledby={`side-tab-${t}`}
          tabIndex={0}
          hidden={t !== tab}
          className="px-4 py-3"
        >
          {panels[t]}
        </div>
      ))}
    </div>
  );
}
