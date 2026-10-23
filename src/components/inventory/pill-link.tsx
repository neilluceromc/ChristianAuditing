import Link from "next/link";
import { cn } from "@/lib/cn";

/** Phase 30 (spec §6.2): the view switches are pill toggles — links, so e2e and a middle-click reach them. */
export function PillLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-(--dur-1)",
        on
          ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
          : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
      )}
    >
      {on && <span aria-hidden>✓</span>}
      {children}
    </Link>
  );
}
