import Link from "next/link";
import { cn } from "@/lib/cn";

/** The props Pagination hands each page link — `next/link`'s by default. */
export type PaginationLinkProps = {
  href: string;
  className?: string;
  children?: React.ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page";
};

export function Pagination({
  page,
  pageCount,
  hrefFor,
  linkComponent: PageLink = Link,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  /** renders each page link; the inventory list passes its `NavLink` so a page change marks it busy */
  linkComponent?: React.ComponentType<PaginationLinkProps>;
}) {
  if (pageCount <= 1) return null;
  const box = "inline-flex min-w-7 items-center justify-center rounded-(--radius-ctl) border px-1.5 py-1 font-mono text-[11px]";
  const item = (p: number, label?: string, disabled?: boolean, name?: string) =>
    // Phase 31: a disabled arrow is not a link at all. It used to be one styled
    // `pointer-events-none`, which stopped the mouse but not the keyboard —
    // Tab + Enter on page 1's ‹ went to `page=0` (and › past the last page).
    disabled ? (
      <span key={label} role="link" aria-disabled="true" aria-label={name} className={cn(box, "border-border bg-surface text-fg-secondary opacity-45")}>
        {label}
      </span>
    ) : (
      <PageLink
        key={label ?? p}
        href={hrefFor(p)}
        aria-label={name}
        aria-current={!label && p === page ? "page" : undefined}
        className={cn(
          box,
          !label && p === page
            ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
            : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
        )}
      >
        {label ?? p}
      </PageLink>
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
      {item(page - 1, "‹", page === 1, "Previous page")}
      {withGaps.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 font-mono text-[11px] text-fg-muted">…</span>
        ) : (
          item(p)
        ),
      )}
      {item(page + 1, "›", page === pageCount, "Next page")}
    </nav>
  );
}
