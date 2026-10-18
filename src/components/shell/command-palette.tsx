"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/cn";
import { navDestinations } from "@/lib/shell";
import type { VisibleSection } from "@/lib/workspaces";
import { createSequence, rateLimitMessage } from "@/lib/palette";
import { paletteShortcutOpens } from "@/lib/shortcuts";
import { Kbd } from "@/components/ui/kbd";
import { Icon } from "@/components/ui/icon";
import { useFocusTrap } from "@/components/ui/use-focus-trap";
import { useSearchShortcutLabel } from "./use-search-shortcut-label";
import { paletteSearch, type PaletteHit, type PaletteResults } from "@/server/palette";

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
const DEBOUNCE_MS = 150;

interface Group {
  heading: string;
  hits: PaletteHit[];
  /** codes (tags, refs, stock codes) read in mono; names — people, suppliers, pages — in the normal font (spec §4) */
  mono: boolean;
}

export function CommandPalette({ role, sections }: { role: Role; sections: VisibleSection[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [results, setResults] = useState<PaletteResults>(EMPTY);
  /** the trimmed query `results` answer — when it differs from the input, a search is still in flight */
  const [resultsFor, setResultsFor] = useState("");
  const [cursor, setCursor] = useState(0);
  /** seconds left on a rate-limit refusal (live countdown), and the figure it started from (announced once) */
  const [retryLeft, setRetryLeft] = useState<number | null>(null);
  const [retryFrom, setRetryFrom] = useState<number | null>(null);
  /** the last search threw (network, server error) */
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-option-${i}`;

  const seq = useRef(createSequence());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: string; ticket: number } | null>(null);
  /** Enter was pressed before the results for the typed text arrived (a scanner types the tag and Enter at once) */
  const enterPending = useRef(false);
  const queryRef = useRef("");

  const cancelSearch = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = null;
    pending.current = null;
  }, []);

  const runSearch = useCallback(async (value: string, ticket: number) => {
    pending.current = null;
    let res: PaletteResults;
    try {
      res = await paletteSearch(value);
    } catch {
      // Settle on the failure, so Enter and the empty line never wait on an answer that is not coming.
      if (seq.current.isCurrent(ticket)) {
        enterPending.current = false;
        setResults(EMPTY);
        setResultsFor(value.trim());
        setFailed(true);
      }
      return;
    }
    // Review focus #4: a response for an older query never replaces a newer one.
    if (!seq.current.isCurrent(ticket)) return;
    setFailed(false);
    setResults(res);
    setResultsFor(value.trim());
    setRetryLeft(res.rateLimited?.retryAfterSec ?? null);
    setRetryFrom(res.rateLimited?.retryAfterSec ?? null);
  }, []);

  const search = useCallback(
    (value: string, delay: number) => {
      cancelSearch();
      const ticket = seq.current.next();
      setFailed(false);
      if (value.trim().length < 2) {
        setResults(EMPTY);
        setResultsFor(value.trim());
        setRetryLeft(null);
        setRetryFrom(null);
        return;
      }
      pending.current = { value, ticket };
      debounce.current = setTimeout(() => void runSearch(value, ticket), delay);
    },
    [cancelSearch, runSearch],
  );

  const close = useCallback(() => {
    cancelSearch();
    seq.current.next(); // retire anything still in flight
    enterPending.current = false;
    queryRef.current = "";
    setOpen(false);
    setQuery("");
    setHint(null);
    setResults(EMPTY);
    setResultsFor("");
    setCursor(0);
    setRetryLeft(null);
    setRetryFrom(null);
    setFailed(false);
  }, [cancelSearch]);

  useEffect(() => cancelSearch, [cancelSearch]);

  const setTrapRef = useFocusTrap(open, close);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Final review M1: never under an open Dialog or Drawer — they portal above the palette, which would
      // open unseen and take the focus. The palette's own aria-modal (already open) does not count.
      const opens = paletteShortcutOpens({
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        otherModalOpen: document.querySelector('[aria-modal="true"]:not([data-command-palette])') !== null,
      });
      if (opens) {
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

  // The countdown; at zero the refused search runs again by itself.
  useEffect(() => {
    if (retryLeft === null) return;
    if (retryLeft <= 0) {
      setRetryLeft(null);
      setRetryFrom(null);
      search(queryRef.current, 0);
      return;
    }
    const t = setTimeout(() => setRetryLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [retryLeft, search]);

  // Spec §4.6: links and views alike, role-filtered and de-duplicated by href, so "Asset types" still finds its page.
  const destinations = useMemo(() => navDestinations(sections, role), [sections, role]);
  const actions = useMemo(
    () =>
      destinations
        .filter((d) => !query || d.label.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5)
        .map((d) => ({ label: d.label, sub: "Go to", href: d.href })),
    [destinations, query],
  );

  const groups = useMemo<Group[]>(
    () =>
      [
        { heading: "Assets", hits: results.assets, mono: true },
        { heading: "People", hits: results.people, mono: false },
        { heading: "Requests", hits: results.requests, mono: true },
        { heading: "Suppliers", hits: results.suppliers, mono: false },
        { heading: "Stock", hits: results.stock, mono: true },
        { heading: "Actions", hits: actions, mono: false },
      ].filter((g) => g.hits.length > 0),
    [results, actions],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const active = flat.length > 0 ? Math.min(cursor, flat.length - 1) : -1;
  const settled = query.trim().length < 2 || resultsFor === query.trim();

  const go = useCallback(
    (hit: PaletteHit) => {
      router.push(hit.href);
      close();
    },
    [router, close],
  );

  // Enter pressed early opens the first result once the answer for the typed text is in.
  useEffect(() => {
    if (!enterPending.current || !settled) return;
    enterPending.current = false;
    if (results.rateLimited) return;
    if (flat[0]) go(flat[0]);
  }, [settled, flat, results, go]);

  useEffect(() => {
    if (active >= 0) document.getElementById(`${listboxId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listboxId]);

  function onQueryChange(value: string) {
    queryRef.current = value;
    setQuery(value);
    setCursor(0);
    enterPending.current = false;
    search(value, DEBOUNCE_MS);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(Math.max(0, Math.min(active + 1, flat.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(Math.max(0, active - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // A row the user arrowed to is a choice; otherwise wait for the typed text's own results
      // rather than open whatever an older query left on screen.
      if (!settled && active <= 0) {
        enterPending.current = true;
        const p = pending.current;
        if (p) {
          cancelSearch();
          void runSearch(p.value, p.ticket);
        }
        return;
      }
      if (active >= 0) go(flat[active]);
    }
  }

  if (!open) return null;

  const expanded = flat.length > 0;
  let index = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div aria-hidden onClick={close} className="absolute inset-0 bg-black/40" style={{ animation: "veil var(--dur-4) var(--ease-std)" }} />
      <div
        ref={setTrapRef}
        role="dialog"
        aria-modal="true"
        data-command-palette=""
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
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-11 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        {/* A press anywhere in the list (an option, a heading, the padding) keeps focus — and the combobox — in the input. */}
        <div className="max-h-[320px] overflow-y-auto p-1.5" onMouseDown={(e) => e.preventDefault()}>
          {retryLeft !== null && (
            <p className="px-2.5 py-6 text-center text-xs text-fg-muted">{rateLimitMessage(Math.max(retryLeft, 1))}</p>
          )}
          {retryLeft === null && failed && settled && (
            <p className="px-2.5 py-6 text-center text-xs text-fg-muted">Search failed — try again.</p>
          )}
          {retryLeft === null && !(failed && settled) && !expanded && (
            <p className="px-2.5 py-6 text-center text-xs text-fg-muted">
              {query.trim().length < 2 ? "Type to search." : "No matches."}
            </p>
          )}
          {/* Hidden (out of the accessibility tree) while it has no options: an empty listbox is invalid. */}
          <div role="listbox" id={listboxId} aria-label="Results" hidden={!expanded}>
            {groups.map((g) => {
              const headingId = `${listboxId}-${g.heading}`;
              return (
                <div key={g.heading} role="group" aria-labelledby={headingId}>
                  <div
                    id={headingId}
                    className="px-2.5 pb-0.5 pt-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-fg-muted"
                  >
                    {g.heading}
                  </div>
                  {g.hits.map((hit) => {
                    index += 1;
                    const i = index;
                    const isActive = i === active;
                    return (
                      <div
                        key={g.heading + hit.href + hit.label}
                        id={optionId(i)}
                        role="option"
                        aria-selected={isActive}
                        onMouseMove={() => {
                          if (i !== active) setCursor(i);
                        }}
                        onClick={() => go(hit)}
                        className={cn(
                          "flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-(--radius-ctl) px-2.5 py-1.5 text-left",
                          isActive ? "bg-accent-tint text-accent" : "text-fg-secondary",
                        )}
                      >
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className={cn("truncate", g.mono ? "font-mono text-xs" : "text-[13px]")}>{hit.label}</span>
                          {hit.hint && (
                            <>
                              {" "}
                              <span className="truncate text-[11px] text-fg-muted">{hit.hint}</span>
                            </>
                          )}
                        </span>{" "}
                        <span className="shrink-0 truncate text-[11px] text-fg-muted">{hit.sub}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        {/* Announced once when a search is refused; the visible line above counts down silently. */}
        <div role="status" className="sr-only">
          {retryFrom !== null ? rateLimitMessage(retryFrom) : ""}
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
