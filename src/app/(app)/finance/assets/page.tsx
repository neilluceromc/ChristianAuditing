import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import Link from "next/link";
import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { ASSET_CLASSES, CLASS_LABEL, parseCls, statusesFor } from "@/lib/asset-class";
import { parsePage } from "@/lib/paging";
import { lifeLabel } from "@/lib/depreciation-input";
import { REG_LABEL_FINANCE, parseFin } from "@/lib/registration";
import { financeAssets, parseAssetStatus } from "@/server/modules/finance/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ButtonLink } from "@/components/ui/button-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FinChips } from "@/components/finance/fin-chips";
import { AssetRowMenu } from "@/components/finance/asset-row-menu";
import { cn } from "@/lib/cn";
import { fmtMoneyExact } from "@/lib/format";

function categoryText(life: number | null, pct: number | null): string {
  if (life === null) return "Category: no policy";
  return `Category: ${lifeLabel(life)}, ${pct ?? 0}% salvage`;
}

export const metadata: Metadata = { title: pageTitle("Assets") };

export default async function FinanceAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "finance_staff");
  const params = toSearchParams(await searchParams);
  const cls = parseCls(params.get("cls")) ?? "IT";
  const status = parseAssetStatus(params.get("status"), cls);
  const fin = parseFin(params.get("fin"));
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const page = parsePage(params);
  const { rows, page: current, pageCount, chips, totals } = await financeAssets({ cls, status, fin, q, page });

  const baseQuery = (p: number) => {
    const next = new URLSearchParams();
    if (cls === "PURCHASING") next.set("cls", "PURCHASING");
    if (status) next.set("status", status);
    if (fin) next.set("fin", fin);
    if (q) next.set("q", q);
    if (p > 1) next.set("page", String(p));
    return next.toString();
  };
  const hrefFor = (p: number) => {
    const qs = baseQuery(p);
    return qs ? `?${qs}` : "?";
  };
  const exportQs = new URLSearchParams();
  if (cls === "PURCHASING") exportQs.set("cls", "PURCHASING");
  if (status) exportQs.set("status", status);
  if (fin) exportQs.set("fin", fin);
  if (q) exportQs.set("q", q);
  const statusHref = (s: string | null) => {
    const next = new URLSearchParams();
    if (cls === "PURCHASING") next.set("cls", "PURCHASING");
    if (s) next.set("status", s);
    if (fin) next.set("fin", fin);
    if (q) next.set("q", q);
    const qs = next.toString();
    return qs ? `/finance/assets?${qs}` : "/finance/assets";
  };
  const clearHref = cls === "PURCHASING" ? "/finance/assets?cls=PURCHASING" : "/finance/assets";

  return (
    <>
      <PageHeader title="Assets" actions={<ButtonLink native href={`/finance/assets/export?${exportQs.toString()}`}>Export</ButtonLink>} />
      <div className="flex flex-col gap-3">
        <nav aria-label="Asset class" className="flex gap-1 border-b border-border">
          {ASSET_CLASSES.map((c) => (
            <Link
              key={c}
              // The active tab's href is the CURRENT URL, so re-clicking it is a no-op; the inactive tab resets filters on purpose (D-16).
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

        <form method="get" className="flex flex-wrap items-center gap-2">
          {cls === "PURCHASING" && <input type="hidden" name="cls" value="PURCHASING" />}
          {status && <input type="hidden" name="status" value={status} />}
          {fin && <input type="hidden" name="fin" value={fin} />}
          <Input
            name="q"
            data-page-search
            defaultValue={q}
            placeholder="Tag, model, serial or holder"
            aria-label="Search assets"
            className="max-w-[320px]"
          />
          <Button type="submit" size="sm">Search</Button>
        </form>

        <FinChips chips={chips} current={fin} cls={cls} q={q} status={status} />

        <nav aria-label="Asset status" className="flex flex-wrap items-center gap-1.5">
          <Link
            href={statusHref(null)}
            aria-current={status ? undefined : "page"}
            className={cn(
              "rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
              status ? "border-border bg-surface text-fg-secondary hover:bg-surface-subtle" : "border-accent-soft-border bg-accent-soft text-accent-soft-text",
            )}
          >
            Any status
          </Link>
          {statusesFor(cls).map((s) => (
            <Link
              key={s}
              href={statusHref(s)}
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
        </nav>

        {rows.length > 0 ? (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th width={128}>Tag</Th>
                  <Th>Model</Th>
                  <Th width={96}>Category</Th>
                  <Th width={104}>Status</Th>
                  <Th width={132}>Finance</Th>
                  <Th width={116} align="right">Cost</Th>
                  <Th width={132} align="right">Depreciation to date</Th>
                  <Th width={150} align="right">Book value</Th>
                  <Th width={40} aria-label="Row actions" />
                </Tr>
              </THead>
              <TBody>
                {rows.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Link href={`/finance/assets/${a.id}`} className="font-mono text-xs font-medium text-accent hover:underline">
                          {a.tag}
                        </Link>
                        {a.custom && <Pill>custom</Pill>}
                      </div>
                    </Td>
                    <Td>
                      <div className="text-fg">{a.model}</div>
                      {a.holder && <div className="text-xs text-fg-muted">{a.holder}</div>}
                    </Td>
                    <Td mono>{a.category}</Td>
                    <Td><StatusPill value={a.status} /></Td>
                    <Td>
                      {a.reg === "registered" && a.notCapitalised ? (
                        <span className="text-xs text-fg-secondary">Not capitalised</span>
                      ) : (
                        <StatusPill ns="registration" value={a.reg} label={REG_LABEL_FINANCE[a.reg]} />
                      )}
                    </Td>
                    <Td align="right" mono>{a.costC === null ? "—" : fmtMoneyExact(a.costC / 100)}</Td>
                    <Td align="right" mono>{a.result ? fmtMoneyExact(a.result.accumulated / 100) : "—"}</Td>
                    <Td align="right" mono>
                      <div>{a.result ? fmtMoneyExact(a.result.bookValue / 100) : "—"}</div>
                      {a.note && <div className="font-sans text-[11px] text-fg-muted">{a.note}</div>}
                    </Td>
                    <Td>
                      {a.result && a.costC !== null && (
                        <AssetRowMenu
                          id={a.id}
                          tag={a.tag}
                          costC={a.costC}
                          startMonth={a.startMonth}
                          custom={a.custom}
                          lifeMonths={a.lifeMonths}
                          salvageC={a.salvageC}
                          note={a.overrideNote}
                          categoryText={categoryText(a.categoryLife, a.categorySalvagePercent)}
                          categoryLife={a.categoryLife}
                          categorySalvagePercent={a.categorySalvagePercent}
                        />
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {current} of {pageCount}</span>
              <Pagination page={current} pageCount={pageCount} hrefFor={hrefFor} />
            </div>
          </>
        ) : q || status || fin ? (
          <EmptyState
            title="No asset matches"
            description="Try a different search or chip."
            actions={<ButtonLink href={clearHref}>Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState title={`No ${CLASS_LABEL[cls]} asset is registered yet`} description="Assets appear here as soon as they are added." />
        )}

        <p className="font-mono text-[11px] text-fg-muted">
          {totals.count} asset{totals.count === 1 ? "" : "s"} · {totals.costed} with a cost · {totals.cost} at cost · {totals.depreciation} depreciation · {totals.book} book value
          <span className="ml-3">As of today ({totals.asOfLabel} counted)</span>
        </p>
      </div>
    </>
  );
}
