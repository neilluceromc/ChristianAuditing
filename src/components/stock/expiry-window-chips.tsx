import Link from "next/link";
import { cn } from "@/lib/cn";
import { EXPIRY_WINDOWS } from "@/lib/stock-allocation";

/**
 * Spec §6.3: `7 days · 30 days · 90 days`, mirrors `repair-chips.tsx`'s chip
 * markup/classes. `hrefFor` is built by the page, which is the only place
 * that knows the other query params (`category`) worth carrying along —
 * same reasoning as `RepairChips`'s own `href` prop.
 */
export function ExpiryWindowChips({
  active,
  hrefFor,
}: {
  active: number;
  hrefFor: (days: number) => string;
}) {
  const chipClass = (on: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
      on
        ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
        : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
    );

  return (
    <div role="group" aria-label="Expiry window" className="flex flex-wrap items-center gap-1.5">
      {EXPIRY_WINDOWS.map((days) => (
        <Link
          key={days}
          href={hrefFor(days)}
          aria-current={days === active ? "true" : undefined}
          className={chipClass(days === active)}
        >
          {days} days
        </Link>
      ))}
    </div>
  );
}
