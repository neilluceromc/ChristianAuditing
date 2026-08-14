"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export interface TabItem {
  label: React.ReactNode;
  href: string;
  active: boolean;
}

export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <nav className={cn("flex gap-1 border-b border-border", className)}>
      {items.map((item, i) => (
        <Link
          key={i}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "relative px-3 py-2 text-[12.5px] font-medium transition-colors duration-(--dur-1)",
            item.active ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
          )}
        >
          {item.label}
          {item.active && (
            <span
              aria-hidden
              className="absolute inset-x-2 bottom-0 h-[2px] bg-accent"
              style={{ animation: "grow var(--dur-3) var(--ease-std)" }}
            />
          )}
        </Link>
      ))}
    </nav>
  );
}
