"use client";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { categoryIcon } from "@/lib/register-catalog";
import type { CatalogCategory } from "@/server/modules/inventory/register-queries";

/**
 * Phase 34 (spec §4.1): one card per registrable category — a pressed button,
 * not a select, so the whole catalogue is visible at once. Tab order walks the
 * grid; arrow keys are not needed for buttons.
 */
export function CategoryCards({
  catalog,
  value,
  onChange,
  invalid,
  error,
}: {
  catalog: CatalogCategory[];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  /** The refusal under the cards, linked to each card by aria-describedby. */
  error?: string;
}) {
  const errorId = "register-category-error";
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="sec mb-3">
        What<span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>
      </legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5">
        {catalog.map((c) => {
          const on = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              aria-describedby={invalid && error ? errorId : undefined}
              data-category-card=""
              onClick={() => onChange(c.id)}
              className={cn(
                "flex min-h-[62px] min-w-0 items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors duration-(--dur-1)",
                on
                  ? "border-accent bg-accent-soft"
                  : invalid
                    ? "border-[var(--error-text)] bg-surface hover:border-border-strong"
                    : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <span
                className={cn(
                  "grid size-[34px] shrink-0 place-items-center rounded-[8px]",
                  on ? "bg-accent text-accent-fg" : "border border-border bg-surface-subtle text-fg-secondary",
                )}
              >
                <Icon name={categoryIcon(c.name)} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium text-fg">{c.name}</span>
                {/* The space keeps the accessible name "Laptop 12 in stock", not "Laptop12 in stock". */}
                {" "}
                <span className="text-[11.5px] text-fg-muted">{c.inStock > 0 ? `${c.inStock} in stock` : "None yet"}</span>
              </span>
            </button>
          );
        })}
      </div>
      {invalid && error && (
        <p id={errorId} role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{error}</p>
      )}
    </fieldset>
  );
}
