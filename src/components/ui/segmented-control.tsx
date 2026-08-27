"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

export function SegmentedControl({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}) {
  const id = useId();
  // -1 = nothing chosen. The sliding indicator is then NOT rendered: parking it
  // under option 1 would make "undecided" read as "Returned", which is exactly
  // the drift the offboarding wizard exists to prevent.
  const idx = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid || undefined}
      className={cn(
        "relative inline-grid auto-cols-fr grid-flow-col rounded-(--radius-btn) border border-border-strong bg-surface-subtle p-0.5",
        className,
      )}
    >
      {idx >= 0 && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-[5px] bg-surface shadow-card"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            left: `calc(2px + (100% - 4px) / ${options.length} * ${idx})`,
            transition: "left 220ms var(--ease-seg)",
          }}
        />
      )}
      {options.map((opt) => (
        <label
          key={opt.value}
          className={cn(
            "relative z-10 cursor-pointer rounded-[5px] px-3 py-1 text-center text-xs font-medium transition-colors duration-(--dur-1)",
            // the radio is sr-only (clipped), so its focus ring must paint on the label
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
            opt.value === value ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
          )}
        >
          <input
            type="radio"
            name={id}
            value={opt.value}
            checked={opt.value === value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
