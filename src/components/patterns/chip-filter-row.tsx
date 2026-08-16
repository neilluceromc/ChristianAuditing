import Link from "next/link";

export interface FilterChip {
  label: string;
  removeHref: string;
}

export function ChipFilterRow({ chips, clearHref }: { chips: FilterChip[]; clearHref: string }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-2">
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.removeHref}
          className="inline-flex items-center gap-1 rounded-(--radius-ctl) border border-accent-soft-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-accent-soft-text hover:opacity-80"
        >
          {chip.label}
          <span aria-hidden>✕</span>
          <span className="sr-only"> — remove filter</span>
        </Link>
      ))}
      <Link href={clearHref} className="px-1 text-[11px] text-fg-muted underline-offset-2 hover:underline">
        Clear filters
      </Link>
    </div>
  );
}
