"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/cn";
import type { NavSection } from "@/lib/workspaces";
import { Kbd } from "@/components/ui/kbd";
import { Icon } from "@/components/ui/icon";
import { useFocusTrap } from "@/components/ui/use-focus-trap";
import { useSearchShortcutLabel } from "./use-search-shortcut-label";
import { paletteSearch, type PaletteResults } from "@/server/palette";

const OPEN_EVENT = "br:open-palette";
const PLACEHOLDER = "Search assets, people, requests…";

/**
 * Opens the palette from anywhere on the page. `hint` replaces the input's
 * placeholder for this opening only (spec §3: "Scan a tag" opens it with
 * "Type or scan a tag"); Ctrl K / ⌘K and the Search trigger open it plain.
 */
export function openPalette(hint?: string) {
  window.dispatchEvent(new CustomEvent<{ hint?: string }>(OPEN_EVENT, { detail: { hint } }));
}

const ICON_BUTTON =
  "grid size-[34px] shrink-0 place-items-center rounded-(--radius-btn) text-fg-secondary hover:bg-surface-subtle";

/**
 * Spec §3: the search trigger shows at every width — the wide bar from `lg`
 * up, and below `lg` (sidebar hidden, phone top bar) the "Search" icon button.
 */
export function CommandPaletteTrigger() {
  const shortcut = useSearchShortcutLabel();
  return (
    <>
      <button type="button" onClick={() => openPalette()} aria-label="Search" className={cn(ICON_BUTTON, "lg:hidden")}>
        <Icon name="search" size={16} />
      </button>
      <button
        type="button"
        onClick={() => openPalette()}
        className="hidden h-[34px] w-[320px] items-center gap-2 rounded-(--radius-btn) border border-border bg-canvas px-3 text-left text-xs text-fg-muted hover:border-border-strong lg:flex"
      >
        <Icon name="search" size={14} />
        <span className="flex-1">{PLACEHOLDER}</span>
        <Kbd>{shortcut}</Kbd>
      </button>
    </>
  );
}

/** Spec §3: below `lg`, "Scan a tag" opens the palette with the hint "Type or scan a tag". */
export function ScanTagButton() {
  return (
    <button
      type="button"
      onClick={() => openPalette("Type or scan a tag")}
      aria-label="Scan a tag"
      className={cn(ICON_BUTTON, "lg:hidden")}
    >
      <Icon name="scan" size={16} />
    </button>
  );
}

const EMPTY: PaletteResults = { assets: [], people: [], requests: [], suppliers: [], stock: [] };

export function CommandPalette({ role, sections }: { role: Role; sections: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [results, setResults] = useState<PaletteResults>(EMPTY);
  const [cursor, setCursor] = useState(0);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHint(null);
    setResults(EMPTY);
    setCursor(0);
  }, []);

  const setTrapRef = useFocusTrap(open, close);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHint(null);
        setOpen(true);
      }
    }
    function onOpen(e: Event) {
      setHint((e as CustomEvent<{ hint?: string } | null>).detail?.hint ?? null);
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const actions = useMemo(
    () =>
      sections
        .flatMap((s) => s.items)
        .filter((i) => !i.roles || i.roles.includes(role))
        .filter((i) => !query || i.label.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5)
        .map((i) => ({ label: i.label, sub: "Go to", href: i.href })),
    [sections, role, query],
  );

  const groups = useMemo(
    () =>
      [
        { heading: "Assets", hits: results.assets },
        { heading: "People", hits: results.people },
        { heading: "Requests", hits: results.requests },
        { heading: "Suppliers", hits: results.suppliers },
        { heading: "Stock", hits: results.stock },
        { heading: "Actions", hits: actions },
      ].filter((g) => g.hits.length > 0),
    [results, actions],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  function onQueryChange(value: string) {
    setQuery(value);
    setCursor(0);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      startTransition(async () => {
        setResults(await paletteSearch(value));
      });
    }, 150);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && flat[cursor]) {
      e.preventDefault();
      router.push(flat[cursor].href);
      close();
    }
  }

  if (!open) return null;

  let index = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div aria-hidden onClick={close} className="absolute inset-0 bg-black/40" style={{ animation: "veil var(--dur-4) var(--ease-std)" }} />
      <div
        ref={setTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-(--radius-card) border border-border bg-surface-raised shadow-dialog"
        style={{ animation: "pop var(--dur-4) var(--ease-std)" }}
      >
        <div className="flex items-center gap-2 border-b border-border-faint px-3">
          <Icon name="search" size={15} className="text-fg-muted" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={hint ?? PLACEHOLDER}
            aria-label="Search"
            className="h-11 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1.5" role="listbox" aria-label="Results">
          {flat.length === 0 && (
            <p className="px-2.5 py-6 text-center text-xs text-fg-muted">
              {query.length < 2 ? "Type to search." : "No matches."}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.heading}>
              <h3 className="px-2.5 pb-0.5 pt-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                {g.heading}
              </h3>
              {g.hits.map((hit) => {
                index += 1;
                const active = index === cursor;
                return (
                  <button
                    key={g.heading + hit.href + hit.label}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      router.push(hit.href);
                      close();
                    }}
                    className={cn(
                      "flex w-full items-baseline justify-between gap-3 rounded-(--radius-ctl) px-2.5 py-1.5 text-left",
                      active ? "bg-accent-tint text-accent" : "text-fg-secondary hover:bg-surface-subtle",
                    )}
                  >
                    <span className="truncate font-mono text-xs">{hit.label}</span>
                    <span className="truncate text-[11px] text-fg-muted">{hit.sub}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-border-faint px-3 py-2 font-mono text-[9.5px] uppercase text-fg-muted">
          <span>↑↓ navigate</span>
          <span>⏎ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
