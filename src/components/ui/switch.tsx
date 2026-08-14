"use client";

import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  id?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-[18px] w-[32px] rounded-full border transition-colors duration-(--dur-1)",
        "disabled:pointer-events-none disabled:opacity-55",
        checked ? "border-accent bg-accent" : "border-border-strong bg-border-faint",
      )}
    >
      <span
        className="absolute top-[1px] size-[14px] rounded-full bg-white shadow-sm"
        style={{
          left: checked ? "15px" : "1px",
          transition: "left 180ms var(--ease-spring)",
        }}
      />
    </button>
  );
}
