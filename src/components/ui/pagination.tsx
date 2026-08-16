import Link from "next/link";
import { cn } from "@/lib/cn";

export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const item = (p: number, label?: string, disabled?: boolean) => (
    <Link
      key={label ?? p}
      href={hrefFor(p)}
      aria-disabled={disabled || undefined}
      aria-current={!label && p === page ? "page" : undefined}
      className={cn(
        "inline-flex min-w-7 items-center justify-center rounded-(--radius-ctl) border px-1.5 py-1 font-mono text-[11px]",
        disabled && "pointer-events-none opacity-45",
        !label && p === page
          ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
          : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
      )}
    >
      {label ?? p}
    </Link>
  );
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1,
  );
  const withGaps: Array<number | "gap"> = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) withGaps.push("gap");
    withGaps.push(p);
  });
  return (
    <nav aria-label="Pagination" className="flex items-center gap-1">
      {item(page - 1, "‹", page === 1)}
      {withGaps.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 font-mono text-[11px] text-fg-muted">…</span>
        ) : (
          item(p)
        ),
      )}
      {item(page + 1, "›", page === pageCount)}
    </nav>
  );
}
