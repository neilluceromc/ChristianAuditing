"use client";

import { Fragment, useId, useRef, useState } from "react";
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
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  "aria-describedby"?: string;
  recent?: string[];
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ESC goes through the overlay stack — a local keydown handler would never
  // see it once this combobox sits inside a Dialog/Drawer (the stack listens
  // at document in the capture phase and stops propagation). Registering a
  // layer means ESC dismisses the dropdown first, then the dialog.
  useOverlayLayer(open, () => setOpen(false));

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = query
    ? options.filter((o) => (o.label + " " + (o.sub ?? "")).toLowerCase().includes(query.toLowerCase()))
    : options;
  const recentShown = query ? [] : recentOptions(options, recent ?? []);
  const recentSet = new Set(recentShown.map((o) => o.value));
  const rest = query ? filtered : options.filter((o) => !recentSet.has(o.value));
  const shown = [...recentShown, ...rest];

  function pick(option: ComboOption | null) {
    onChange(option?.value ?? null);
    setQuery("");
    setOpen(false);
  }

  // Phase 24 (final review I-2, ruling R3): the heading row is role="presentation" — outside the
  // accessibility tree — so options under a grouped heading point at it with aria-describedby and
  // aria-activedescendant users still hear "Same type" / "Other spares". The synthetic Recent/All
  // headings are not described: the recent-enabled callers announce exactly as before.
  let groupHeadingId: string | undefined;
  const rows = shown.map((option, i) => {
    const heading = headingBefore(shown, i, recentShown.length);
    const headingId = `${listId}-h${i}`;
    if (heading !== null) groupHeadingId = heading === option.group ? headingId : undefined;
    return { option, heading, headingId, describedBy: option.group !== undefined ? groupHeadingId : undefined };
  });

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].value}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={fieldClasses(invalid)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={open ? query : (selected ? `${selected.label}${selected.sub ? ` · ${selected.sub}` : ""}` : "")}
        onFocus={() => { setOpen(true); setActive(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // let option mousedown land first
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); if (!e.target.value) onChange(null); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); }

        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-[220px] w-full overflow-y-auto rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop"
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          {shown.length === 0 && <li className="px-2 py-1.5 text-xs text-fg-muted">No matches.</li>}
          {rows.map(({ option, heading, headingId, describedBy }, i) => (
            <Fragment key={option.value}>
              {heading && (
                <li id={headingId} role="presentation" className="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-[0.06em] text-fg-faint">{heading}</li>
              )}
              <li
                id={`${listId}-${option.value}`}
                role="option"
                aria-selected={option.value === value}
                aria-describedby={describedBy}
                className={cn(
                  "cursor-pointer rounded-[5px] px-2 py-1.5 text-xs",
                  i === active ? "bg-accent-tint text-fg" : "text-fg-secondary",
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(option); }}
              >
                <span className="font-medium">{option.label}</span>
                {option.sub && <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{option.sub}</span>}
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
