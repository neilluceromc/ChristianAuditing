"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "@/components/ui/input";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";
import { matchModels, type KnownModel } from "@/lib/known-models";

/**
 * Phase 34 (spec §4.2), Phase 36: Model is one free-text field that lists the models already
 * registered in the category (name and stock count only). It never sets the type — Register
 * asks that on its own. Like the house `EntityCombobox` (ESC through the overlay stack, a click
 * outside closes), but the typed text is the value.
 */
export function ModelCombobox({
  id,
  models,
  value,
  onValue,
  placeholder,
  invalid,
  describedBy,
  inputRef,
}: {
  id: string;
  models: KnownModel[];
  value: string;
  onValue: (v: string) => void;
  placeholder: string;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  // -1 = nothing active: Enter then keeps the typed text instead of taking the first match.
  const [active, setActive] = useState(-1);

  useOverlayLayer(open, () => setOpen(false));

  const known = models.some((m) => m.model.trim().replace(/\s+/g, " ").toLowerCase() === value.trim().replace(/\s+/g, " ").toLowerCase());
  const matches = matchModels(models, value);
  const offerNew = value.trim() !== "" && !known;
  // The rows the list shows: the matches, then "+ Add" for a new model.
  const count = matches.length + (offerNew ? 1 : 0);

  function change(v: string) {
    onValue(v);
    setOpen(true);
    setActive(-1);
  }

  /** Ruling (review minor): a model that resolves to a known one takes its spelling, so case variants never pile up. */
  function canonical(v: string): string {
    const k = v.trim().replace(/\s+/g, " ");
    const hit = models.find((m) => m.model.toLowerCase() === k.toLowerCase());
    return hit ? hit.model : k;
  }

  function pick(i: number) {
    if (i < matches.length) {
      const m = matches[i];
      onValue(m.model);
    }
    // "+ Add … as a new model" keeps the text and only closes the list.
    setOpen(false);
    setActive(-1);
  }

  const optionId = (i: number) => `${listId}-o${i}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open && count > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && active < count ? optionId(active) : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          className={fieldClasses(invalid)}
          placeholder={placeholder}
          value={value}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120); // let an option's mousedown land first
            const settled = canonical(value);
            if (settled !== value) onValue(settled);
          }}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, count - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              // Never submits (the form blocks Enter in fields too); picks the active row if there is one.
              e.preventDefault();
              if (open && active >= 0 && active < count) pick(active);
              else setOpen(false);
            }
          }}
        />
        {open && count > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-40 mt-1 max-h-[260px] w-full overflow-y-auto rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop"
            style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
          >
            {matches.map((m, i) => (
              <li
                key={m.model}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                aria-label={m.model}
                aria-describedby={`${optionId(i)}-d`}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-xs",
                  i === active ? "bg-accent-tint text-fg" : "text-fg-secondary",
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{m.model}</span>
                <span id={`${optionId(i)}-d`} className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] text-fg-muted">{m.inStock > 0 ? `${m.inStock} in stock` : "none in stock"}</span>
                </span>
              </li>
            ))}
            {offerNew && (
              <li
                id={optionId(matches.length)}
                role="option"
                aria-selected={active === matches.length}
                className={cn(
                  "cursor-pointer rounded-[5px] px-2 py-1.5 text-xs font-medium",
                  active === matches.length ? "bg-accent-tint text-fg" : "text-accent",
                )}
                onMouseEnter={() => setActive(matches.length)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(matches.length);
                }}
              >
                + Add &ldquo;{value.trim()}&rdquo; as a new model
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
