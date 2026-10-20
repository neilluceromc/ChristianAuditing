"use client";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { SEARCH_DEBOUNCE_MS, createLiveSearch } from "@/lib/live-search";
import { takePageSearch } from "@/lib/search-restore";
import { cancelStuckNavWatch } from "@/lib/stuck-nav";

/** How a search was sent: `enter` for the Enter key (Inventory's scanner contract opens an exact tag only then). */
export interface SearchSubmit { enter: boolean }

/**
 * The house search (Phase 30 §3): seeded from the URL's q, Clear × clears. `className` (the box's width) and
 * `inputClassName` (the field's size) merge over the defaults; without them the output is unchanged.
 *
 * Spec §7.2 (2026-10-21): it searches as you type. `onSubmit` fires `debounceMs` (300 ms) after the last keystroke
 * or paste, at once on Enter (with `{ enter: true }`), and at once with "" for Clear ×; a single letter is enough and
 * an emptied box clears the search. Callers navigate with `router.replace` (the list navigation's `replace`), so
 * typing never floods the history.
 *
 * The field is controlled and NOT keyed on q any more: a remount on every search would drop focus and the caret
 * while the person types. Instead the controller (`createLiveSearch`) tells a new q that is the URL catching up with
 * this box's own search (kept: the person may have typed on) from one that changed elsewhere — Clear filters, Back,
 * a link — which replaces the text (the Phase 29 "Clear search left the typed text" fix, kept).
 *
 * Task 6 review I2: every keystroke cancels a pending stuck-navigation watch (`cancelStuckNavWatch`), so an older
 * live search can never reload the page over newer typing; the next search starts its own watch. If a fallback load
 * does happen while the box has focus, `stuck-nav` notes the text and caret (`rememberPageSearch`) and the reloaded
 * box takes the note once on mount (`takePageSearch`): focus, text and caret come back, and a search the reload
 * missed goes out.
 */
export function SearchBox({
  value, ariaLabel, placeholder, onSubmit, className, inputClassName, debounceMs = SEARCH_DEBOUNCE_MS,
}: {
  value: string; ariaLabel: string; placeholder: string; onSubmit: (q: string, how: SearchSubmit) => void;
  className?: string; inputClassName?: string; debounceMs?: number;
}) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // the latest onSubmit, for a timer set during an earlier render (callers pass a fresh closure every render)
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);
  const [live] = useState(() =>
    createLiveSearch({
      initial: value, debounceMs, submit: (q, how) => submitRef.current(q, how), onInput: cancelStuckNavWatch,
    }),
  );
  // a caret to put back once a restored text has rendered
  const pendingCaret = useRef<number | null>(null);
  useEffect(() => {
    const restored = takePageSearch();
    const el = inputRef.current;
    if (!restored || !el) return;
    el.focus();
    if (restored.text === el.value) {
      el.setSelectionRange(restored.caret, restored.caret);
      return;
    }
    pendingCaret.current = restored.caret;
    setText(restored.text);
    live.input(restored.text); // the reload showed the older search: the typed one goes out after the usual pause
  }, [live]);
  useEffect(() => {
    const el = inputRef.current;
    const caret = pendingCaret.current;
    if (!el || caret === null) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [text]);
  useEffect(() => {
    if (live.onValue(value)) setText(value);
  }, [live, value]);
  useEffect(() => () => live.cancel(), [live]);

  return (
    <div className={cn("relative w-[280px]", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint"><Icon name="search" size={14} /></span>
      <Input
        ref={inputRef}
        type="search"
        data-page-search
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={text}
        className={cn("pl-8 pr-7", inputClassName)}
        onChange={(e) => {
          setText(e.currentTarget.value);
          live.input(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) live.enter(e.currentTarget.value);
        }}
      />
      {(text !== "" || value !== "") && (
        <button
          type="button"
          aria-label="Clear search"
          // Fitts / WCAG 2.5.8: a 24 × 24 px target, centred, inside the input's pr-7 gutter
          className="absolute right-0.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-(--radius-ctl) text-fg-muted hover:bg-surface-subtle hover:text-fg"
          onClick={() => {
            setText("");
            live.clear();
            inputRef.current?.focus();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
