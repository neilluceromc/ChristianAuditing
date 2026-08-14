"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";

export function Tooltip({
  content,
  children,
  className,
}: {
  content: string;
  children: React.ReactElement<{ "aria-describedby"?: string; onFocus?: () => void; onBlur?: () => void }>;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap",
          "rounded-[5px] px-2 py-1 text-[11px] text-white",
          open ? "opacity-100" : "opacity-0",
        )}
        style={{
          background: "#101828",
          transition: "opacity var(--dur-2) var(--ease-std)",
        }}
      >
        {content}
      </span>
    </span>
  );
}
