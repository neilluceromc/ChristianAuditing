"use client";

import { cloneElement, useId, useState } from "react";
import { cn } from "@/lib/cn";

type TriggerProps = {
  "aria-describedby"?: string;
  onFocus?: React.FocusEventHandler;
  onBlur?: React.FocusEventHandler;
};

/**
 * The trigger child must itself be focusable (button, link, input…) for the
 * keyboard path to work — tooltips on non-interactive elements are an axe
 * violation anyway. The child is cloned to carry aria-describedby.
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: string;
  children: React.ReactElement<TriggerProps>;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const child = cloneElement(children, {
    "aria-describedby": id,
    onFocus: (e: React.FocusEvent<Element>) => {
      children.props.onFocus?.(e);
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent<Element>) => {
      children.props.onBlur?.(e);
      setOpen(false);
    },
  });
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {child}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap",
          "rounded-[5px] px-2 py-1 text-[11px] text-white",
          open ? "opacity-100" : "opacity-0",
        )}
        style={{
          background: "var(--tooltip-bg)",
          transition: "opacity var(--dur-2) var(--ease-std)",
        }}
      >
        {content}
      </span>
    </span>
  );
}
