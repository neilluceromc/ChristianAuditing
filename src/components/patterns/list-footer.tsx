import { PER_PAGE_OPTIONS, rowsRange } from "@/lib/paging";
import { Pagination } from "@/components/ui/pagination";
import { NavLink } from "@/components/patterns/list-navigation";
import { PerPageSelect, RowSizeControl } from "@/components/patterns/sticky-list";

/**
 * The pagination row as a bar pinned to the bottom of the window while the list is on screen: "Rows 1–25 of
 * 900", then Row size, Rows per page and the pages. With one page the pages hide; Rows per page shows whenever
 * there are more rows than the smallest size, so a list at 100 per page with 60 rows can still go back to 25.
 *
 * Not a Client Component (no "use client"): a list page, which is a Server Component, passes `hrefFor` and
 * `perHrefFor` as functions, and React cannot send a function to a Client Component. They are called here and
 * only their strings reach the client parts (the page links and the Rows per page select).
 */
export function ListFooter({
  page,
  per,
  total,
  pageCount,
  hrefFor,
  perHrefFor,
}: {
  page: number;
  per: number;
  total: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  perHrefFor: (per: number) => string;
}) {
  const { from, to } = rowsRange(page, per, total);
  const paged = pageCount > 1;
  const perChoice = total > PER_PAGE_OPTIONS[0];
  const perHrefs: Record<number, string> = Object.fromEntries(PER_PAGE_OPTIONS.map((n) => [n, perHrefFor(n)]));
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className="sticky bottom-0 z-20 -mx-6 mt-1 flex min-h-12 flex-wrap items-center gap-x-6 gap-y-1 border-t border-border bg-canvas/95 px-6 py-2 backdrop-blur">
      <span className="text-[12.5px] tabular-nums text-fg-muted" aria-live="polite">
        {total === 0 ? (
          "No rows"
        ) : (
          <>
            Rows <span className="font-medium text-fg-secondary">{fmt(from)}–{fmt(to)}</span> of {fmt(total)}
          </>
        )}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1">
        <RowSizeControl />
        {perChoice && <PerPageSelect per={per} hrefs={perHrefs} />}
        {paged && <Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} linkComponent={NavLink} />}
      </div>
    </div>
  );
}
