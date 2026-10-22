"use client";

import { Fragment, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "@/components/ui/input";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";
import { recentOptions } from "@/lib/recent-picks";
import { headingBefore } from "@/lib/combo-groups";

export interface ComboOption {
  value: string;
  label: string;
  sub?: string;
  group?: string; // Phase 24: heading label; consecutive rows sharing a group sit under one heading
  /** A leading badge — initials, a category mark. */
  icon?: ReactNode;
  /** A small trailing chip, such as "New". */
  tag?: string;
}

const LIST_CLASS = "absolute z-40 mt-1 max-h-[220px] w-full overflow-y-auto rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop";
const FOOTED_CLASS = "absolute z-40 mt-1 w-full overflow-hidden rounded-(--radius-btn) border border-border bg-surface-raised shadow-pop";
const POPUP_ANIMATION = { animation: "fade var(--dur-2) var(--ease-std)" };

/**
 * The input's aria-describedby (final review I2): the caller's own ids, plus the popup's empty words while the list is
 * open and shows nothing, so "No matches." / "Searching…" is read with the field as well as announced.
 */
export function comboDescribedBy(describedBy: string | undefined, listId: string, state: { open: boolean; empty: boolean }) {
  const ids = [describedBy, state.open && state.empty ? `${listId}-empty` : undefined].filter(Boolean).join(" ");
  return ids || undefined;
}

/**
 * The open dropdown: the listbox and, when `footer` yields something, an action area under it. Presentational
 * (no state, no hooks) so its markup can be rendered open in a node test. Without a footer the markup is the
 * original `<ul>`; with one, the `<ul>` sits in a wrapper beside the footer — buttons never live inside a listbox.
 */
export function ComboPopup({
  listId,
  shown,
  recentCount,
  active,
  value,
  busy,
  emptyText,
  groupHint,
  query,
  footer,
  close,
  onActive,
  onPick,
}: {
  listId: string;
  shown: ComboOption[];
  recentCount: number;
  active: number;
  value: string | null;
  busy?: boolean;
  emptyText?: string;
  groupHint?: Record<string, string>;
  query: string;
  footer?: (query: string, close: () => void) => ReactNode;
  close: () => void;
  onActive: (i: number) => void;
  onPick: (option: ComboOption) => void;
}) {
  // Phase 24 (final review I-2, ruling R3): the heading row is role="presentation" — outside the
  // accessibility tree — so options under a grouped heading point at it with aria-describedby and
  // aria-activedescendant users still hear "Same type" / "Other spares". The synthetic Recent/All
  // headings are not described: the recent-enabled callers announce exactly as before.
  let groupHeadingId: string | undefined;
  const rows = shown.map((option, i) => {
    const heading = headingBefore(shown, i, recentCount);
    const headingId = `${listId}-h${i}`;
    if (heading !== null) groupHeadingId = heading === option.group ? headingId : undefined;
    return { option, heading, headingId, describedBy: option.group !== undefined ? groupHeadingId : undefined };
  });
  const footerNode = footer?.(query, close) ?? null;
  const hasFooter = footerNode !== null && footerNode !== false;

  const items = (
    <>
      {rows.map(({ option, heading, headingId, describedBy }, i) => {
        // The group's hint, right of its heading — only a real group heading, never the synthetic Recent/All.
        const hint = heading !== null && heading === option.group ? groupHint?.[heading] : undefined;
        return (
          // "" is the clear sentinel (receive-form's "No vendor") — give it a real id and key
          <Fragment key={option.value || "none"}>
            {heading && (
              <li
                id={headingId}
                role="presentation"
                className={cn("px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-[0.06em] text-fg-faint", hint && "flex items-baseline justify-between gap-2")}
              >
                {hint ? (
                  <>
                    <span>{heading}</span>
                    <span className="normal-case tracking-normal">{hint}</span>
                  </>
                ) : (
                  heading
                )}
              </li>
            )}
            <li
              id={`${listId}-${option.value || "none"}`}
              role="option"
              aria-selected={option.value === value}
              aria-describedby={describedBy}
              className={cn(
                "cursor-pointer rounded-[5px] px-2 py-1.5 text-xs",
                (option.icon || option.tag) && "flex items-center",
                i === active ? "bg-accent-tint text-fg" : "text-fg-secondary",
              )}
              onMouseEnter={() => onActive(i)}
              onMouseDown={(e) => { e.preventDefault(); onPick(option); }}
            >
              {option.icon && <span className="mr-2 inline-flex shrink-0 items-center justify-center">{option.icon}</span>}
              <span className="font-medium">{option.label}</span>
              {option.sub && <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{option.sub}</span>}
              {option.tag && <span className="ml-auto shrink-0 rounded-full bg-accent-tint px-1.5 py-px text-[10px] font-medium text-fg-secondary">{option.tag}</span>}
            </li>
          </Fragment>
        );
      })}
    </>
  );

  // Nothing matches: the words sit beside the (empty) listbox, never in it — a listbox owns only options (axe
  // aria-required-children / listitem were critical and serious with them as a row of it). Final review I2: they are a
  // polite status the input points at (comboDescribedBy), and the same node stays while the list is open and empty, so
  // "Searching…" turning into "No matches." or "Couldn't search" is announced. A list with options is unchanged.
  const empty = shown.length === 0
    ? <p id={`${listId}-empty`} role="status" className="px-2 py-1.5 text-xs text-fg-muted">{emptyText ?? "No matches."}</p>
    : null;

  if (!hasFooter && empty) {
    return (
      <div className={LIST_CLASS} style={POPUP_ANIMATION}>
        <ul id={listId} role="listbox" aria-busy={busy || undefined} />
        {empty}
      </div>
    );
  }
  if (!hasFooter) {
    return (
      <ul id={listId} role="listbox" aria-busy={busy || undefined} className={LIST_CLASS} style={POPUP_ANIMATION}>
        {items}
      </ul>
    );
  }
  return (
    <div
      className={FOOTED_CLASS}
      style={POPUP_ANIMATION}
      // A click on the footer must not pull focus off the input (that would blur it and close the list before the click lands).
      onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault(); }}
    >
      {/* tabIndex -1: a scrollable list is a Tab stop in some browsers — Tab from the input goes straight to the footer. */}
      <ul id={listId} role="listbox" tabIndex={-1} aria-busy={busy || undefined} className={cn("max-h-[220px] overflow-y-auto", !empty && "p-1")}>
        {items}
      </ul>
      {empty && <div className="p-1">{empty}</div>}
      <div className="border-t border-border p-1">{footerNode}</div>
    </div>
  );
}

export function EntityCombobox({
  options,
  value,
  onChange,
  placeholder,
  id,
  invalid,
  "aria-describedby": describedBy,
  recent,
  autoFocus,
  valueOption,
  onQuery,
  serverFiltered,
  emptyText,
  busy,
  maxLength,
  groupHint,
  footer,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null, option?: ComboOption) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  "aria-describedby"?: string;
  recent?: string[];
  autoFocus?: boolean;
  /** Phase 36: the chosen row when it is not (or no longer) in `options` — display only, never listed. */
  valueOption?: ComboOption | null;
  /** Phase 36: told the typed text on every change ("" when cleared) — a server-searched caller swaps `options` in response. */
  onQuery?: (query: string) => void;
  /** Phase 36: `options` already match the typed text (the server filtered them) — skip the local filter. */
  serverFiltered?: boolean;
  /** Phase 36: the text shown when no row is listed; the default is "No matches." */
  emptyText?: string;
  /** Phase 39: a server answer for the typed text is on its way — the rows shown are the previous answer's. */
  busy?: boolean;
  /** Phase 39: the longest text the field takes. */
  maxLength?: number;
  /** A right-aligned note on a group's heading, keyed by the group label ("→ IT checks"). */
  groupHint?: Record<string, string>;
  /** An action area under the list ("Create “X” as…"): given the typed text and a function that closes the list and returns focus to the field. Reachable by Tab from the field while the list is open. */
  footer?: (query: string, close: () => void) => ReactNode;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Closing from inside the footer would otherwise drop focus on <body> when the footer unmounts.
  function closeAndRefocus() {
    setOpen(false);
    setQuery("");
    onQuery?.("");
    inputRef.current?.focus();
  }

  // ESC goes through the overlay stack — a local keydown handler would never
  // see it once this combobox sits inside a Dialog/Drawer (the stack listens
  // at document in the capture phase and stops propagation). Registering a
  // layer means ESC dismisses the dropdown first, then the dialog. From the footer it also returns focus to the field.
  useOverlayLayer(open, () => {
    setOpen(false);
    if (rootRef.current?.contains(document.activeElement) && document.activeElement !== inputRef.current) inputRef.current?.focus();
  });

  const selected = options.find((o) => o.value === value) ?? (value !== null && valueOption?.value === value ? valueOption : null);
  const filtered = query && !serverFiltered
    ? options.filter((o) => (o.label + " " + (o.sub ?? "")).toLowerCase().includes(query.toLowerCase()))
    : options;
  const recentShown = query ? [] : recentOptions(options, recent ?? []);
  const recentSet = new Set(recentShown.map((o) => o.value));
  const rest = query ? filtered : options.filter((o) => !recentSet.has(o.value));
  const shown = [...recentShown, ...rest];

  function pick(option: ComboOption | null) {
    onChange(option?.value ?? null, option ?? undefined);
    setQuery("");
    onQuery?.("");
    setOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      // Focus leaving the footer (not into the field) closes the list, as leaving the field does.
      onBlur={(e) => {
        if (e.target === inputRef.current || rootRef.current?.contains(e.relatedTarget as Node | null)) return;
        setTimeout(() => setOpen(false), 120);
      }}
    >
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].value || "none"}` : undefined}
        aria-describedby={comboDescribedBy(describedBy, listId, { open, empty: shown.length === 0 })}
        aria-invalid={invalid || undefined}
        className={fieldClasses(invalid)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        value={open ? query : (selected ? `${selected.label}${selected.sub ? ` · ${selected.sub}` : ""}` : "")}
        // Phase 27 (spec §5.5): focus alone never opens the list — a click, typing or ArrowDown does, so an autoFocus field no longer pops a listbox on page load.
        onFocus={() => setActive(0)}
        onClick={() => setOpen(true)}
        onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setTimeout(() => setOpen(false), 120); }} // let option mousedown land first; focus moving into the footer keeps the list open
        onChange={(e) => { setQuery(e.target.value); onQuery?.(e.target.value); setOpen(true); setActive(0); if (!e.target.value) onChange(null); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); }

        }}
      />
      {open && (
        <ComboPopup
          listId={listId}
          shown={shown}
          recentCount={recentShown.length}
          active={active}
          value={value}
          busy={busy}
          emptyText={emptyText}
          groupHint={groupHint}
          query={query}
          footer={footer}
          close={closeAndRefocus}
          onActive={setActive}
          onPick={pick}
        />
      )}
    </div>
  );
}
