import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { ASSET_CLASSES, CLASS_LABEL, parseCls, statusesFor } from "@/lib/asset-class";
import { parsePage } from "@/lib/paging";
import { financeAssets, parseAssetStatus } from "@/server/modules/finance/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ButtonLink } from "@/components/ui/button-link";
import { cn } from "@/lib/cn";

export default async function FinanceAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = toSearchParams(await searchParams);
  const cls = parseCls(params.get("cls")) ?? "IT";
  const status = parseAssetStatus(params.get("status"), cls);
  const page = parsePage(params);
  const { rows, total, page: current, pageCount, totalCost } = await financeAssets(status, page, cls);

  const hrefFor = (p: number) => {
    const next = new URLSearchParams();
    if (cls === "PURCHASING") next.set("cls", "PURCHASING");
    if (status) next.set("status", status);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <>
      <PageHeader title="Capitalized assets" />
      <div className="flex flex-col gap-3">
        <nav aria-label="Asset class" className="flex gap-1 border-b border-border">
          {ASSET_CLASSES.map((c) => (
            <Link
              key={c}
              // The active tab's href is the CURRENT URL (hrefFor already
              // closes over this page's cls/status), so clicking it is a
              // no-op — a class switch (the inactive tab, still bare) resets
              // filters on purpose, but re-clicking the tab you're already on
              // must not (D-16).
              href={c === cls ? hrefFor(current) : c === "PURCHASING" ? "/finance/assets?cls=PURCHASING" : "/finance/assets"}
              aria-current={c === cls ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium",
                c === cls ? "border-accent text-fg" : "border-transparent text-fg-secondary hover:text-fg",
              )}
            >
              {CLASS_LABEL[c]}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={cls === "PURCHASING" ? "/finance/assets?cls=PURCHASING" : "/finance/assets"}
            aria-current={status ? undefined : "page"}
            className={cn(
              "rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
              status ? "border-border bg-surface text-fg-secondary hover:bg-surface-subtle" : "border-accent-soft-border bg-accent-soft text-accent-soft-text",
            )}
          >
            All
          </Link>
          {statusesFor(cls).map((s) => (
            <Link
              key={s}
              href={`/finance/assets?${cls === "PURCHASING" ? "cls=PURCHASING&" : ""}status=${s}`}
              aria-current={status === s ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                status === s ? "border-accent-soft-border bg-accent-soft text-accent-soft-text" : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
              )}
            >
              <StatusDot value={s} />
              {s}
            </Link>
          ))}
          <span className="ml-auto font-mono text-[11px] text-fg-muted">
            {total} asset{total === 1 ? "" : "s"} · {totalCost} at cost
          </span>
        </div>

        {rows.length > 0 ? (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th width={26} />
                  <Th width={112}>Tag</Th>
                  <Th>Model</Th>
                  <Th width={96}>Category</Th>
                  <Th width={124} align="right">Cost</Th>
                  <Th width={104}>Purchased</Th>
                  <Th width={150}>Provenance</Th>
                  <Th width={64}>Age</Th>
                  <Th width={104}>Warranty</Th>
                  <Th width={150}>Held by</Th>
                  <Th width={104}>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((a) => (
                  <Tr key={a.id}>
                    <Td><StatusDot value={a.status} /></Td>
                    <Td>
                      <Link href={`/inventory/${a.id}`} className="font-mono text-xs font-medium text-accent hover:underline">
                        {a.tag}
                      </Link>
                    </Td>
                    <Td className="text-fg">{a.model}</Td>
                    <Td mono>{a.category}</Td>
                    <Td align="right" mono>{a.cost}</Td>
                    <Td mono>{a.purchased}</Td>
                    <Td>{a.provenance}</Td>
                    <Td mono>{a.age}</Td>
                    <Td mono>{a.warranty}</Td>
                    <Td>{a.assignee ?? "—"}</Td>
                    <Td><StatusPill value={a.status} /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {current} of {pageCount}</span>
              <Pagination page={current} pageCount={pageCount} hrefFor={hrefFor} />
            </div>
          </>
        ) : status ? (
          <EmptyState
            title={`No capitalized ${CLASS_LABEL[cls]} asset reads ${status}`}
            description="Only assets with an acquisition cost appear here."
            actions={<ButtonLink href={cls === "PURCHASING" ? "/finance/assets?cls=PURCHASING" : "/finance/assets"}>Clear filter</ButtonLink>}
          />
        ) : (
          <EmptyState
            title={`No ${CLASS_LABEL[cls]} asset has been capitalized yet`}
            description="An asset appears here once it carries an acquisition cost."
          />
        )}
      </div>
    </>
  );
}
