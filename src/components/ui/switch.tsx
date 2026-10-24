"use client";

import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  /** e.g. the reason a disabled switch can't be changed (Users & access, Task 4) */
  "aria-describedby"?: string;
  id?: string;
  className?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      aria-describedby={aria["aria-describedby"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-[18px] w-[32px] rounded-full border transition-colors duration-(--dur-1)",
        "disabled:pointer-events-none disabled:opacity-55",
        checked ? "border-accent bg-accent" : "border-border-strong bg-border-faint",
        className,
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
