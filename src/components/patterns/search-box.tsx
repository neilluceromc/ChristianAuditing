"use client";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

/**
 * The house search (Phase 30 §3): keyed on the URL's q, Enter submits, Clear × clears. `className` (the box's width)
 * and `inputClassName` (the field's size) merge over the defaults; without them the output is unchanged.
 */
export function SearchBox({ value, ariaLabel, placeholder, onSubmit, className, inputClassName }: {
  value: string; ariaLabel: string; placeholder: string; onSubmit: (q: string) => void;
  className?: string; inputClassName?: string;
}) {
  return (
    <div className={cn("relative w-[280px]", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint"><Icon name="search" size={14} /></span>
      <Input
        // Keyed on the URL's q: a search change is a soft navigation, and an uncontrolled
        // input ignores a new defaultValue once typed in.
        key={value}
        type="search"
        data-page-search
        aria-label={ariaLabel}
        placeholder={placeholder}
        defaultValue={value}
        className={cn("pl-8 pr-7", inputClassName)}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(e.currentTarget.value); }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          // Fitts / WCAG 2.5.8: a 24 × 24 px target, centred, inside the input's pr-7 gutter
          className="absolute right-0.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-(--radius-ctl) text-fg-muted hover:bg-surface-subtle hover:text-fg"
          onClick={() => onSubmit("")}
        >
          ×
        </button>
      )}
    </div>
  );
}
