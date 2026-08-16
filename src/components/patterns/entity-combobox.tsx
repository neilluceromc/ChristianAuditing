"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "@/components/ui/input";

export interface ComboOption {
  value: string;
  label: string;
  sub?: string;
  note?: string; // e.g. "reserved for K. Uy" — shown, not disabling
}

export function EntityCombobox({
  options,
  value,
  onChange,
  placeholder,
  id,
  invalid,
  "aria-describedby": describedBy,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  "aria-describedby"?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const shown = query
    ? options.filter((o) => (o.label + " " + (o.sub ?? "")).toLowerCase().includes(query.toLowerCase()))
    : options;

  function pick(option: ComboOption | null) {
    onChange(option?.value ?? null);
    setQuery("");
    setOpen(false);
  }

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
        value={open ? query : (selected ? `${selected.label}${selected.sub ? ` · ${selected.sub}` : ""}` : "")}
        onFocus={() => { setOpen(true); setActive(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)} // let option mousedown land first
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); if (!e.target.value) onChange(null); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); }
          else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
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
          {shown.map((option, i) => (
            <li
              key={option.value}
              id={`${listId}-${option.value}`}
              role="option"
              aria-selected={option.value === value}
              className={cn(
                "cursor-pointer rounded-[5px] px-2 py-1.5 text-xs",
                i === active ? "bg-accent-tint text-fg" : "text-fg-secondary",
              )}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(option); }}
            >
              <span className="font-medium">{option.label}</span>
              {option.sub && <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{option.sub}</span>}
              {option.note && <span className="ml-1.5 text-[10px] text-fg-muted">{option.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
