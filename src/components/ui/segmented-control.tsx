"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

export function SegmentedControl({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  className?: string;
}) {
  const id = useId();
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-grid auto-cols-fr grid-flow-col rounded-(--radius-btn) border border-border-strong bg-surface-subtle p-0.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 rounded-[5px] bg-surface shadow-card"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          left: `calc(2px + (100% - 4px) / ${options.length} * ${idx})`,
          transition: "left 220ms var(--ease-seg)",
        }}
      />
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
