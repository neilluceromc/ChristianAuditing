import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { ASSET_STATUSES } from "@/lib/inventory-list";
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
  const status = parseAssetStatus(params.get("status"));
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const { rows, total, page: current, pageCount, totalCost } = await financeAssets(status, page);

  const hrefFor = (p: number) => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <>
      <PageHeader title="Capitalized assets" />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href="/finance/assets"
            aria-current={status ? undefined : "page"}
            className={cn(
              "rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
              status ? "border-border bg-surface text-fg-secondary hover:bg-surface-subtle" : "border-accent-soft-border bg-accent-soft text-accent-soft-text",
            )}
          >
            All
          </Link>
          {ASSET_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/finance/assets?status=${s}`}
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
            title={`No capitalized asset reads ${status}`}
            description="Only assets with an acquisition cost appear here."
            actions={<ButtonLink href="/finance/assets">Clear filter</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="Nothing has been capitalized yet"
            description="An asset appears here once it carries an acquisition cost."
          />
        )}
      </div>
    </>
  );
}
