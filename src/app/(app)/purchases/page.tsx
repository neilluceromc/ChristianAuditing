import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { PURCHASE_TABS, parsePurchaseState } from "@/lib/purchases-list";
import { listPurchases, stateCounts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { PurchasesTable } from "@/components/purchases/purchases-table";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = toSearchParams(await searchParams);
  const state = parsePurchaseState(params.get("state"));
  const q = (params.get("q") ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const [{ rows, total, page: current, pageCount }, counts] = await Promise.all([
    listPurchases(state, q, page),
    stateCounts(),
  ]);

  const canCreate = user.role === "purchasing_staff" || user.role === "admin";
  const filtered = Boolean(state || q);
  const hrefFor = (p: number) => {
    const next = new URLSearchParams();
    if (state) next.set("state", state);
    if (q) next.set("q", q);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <>
      <PageHeader
        title="Purchase requests"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={canCreate ? <ButtonLink href="/purchases/new" variant="primary">New request</ButtonLink> : undefined}
      />
      <div className="flex flex-col gap-3">
        <Tabs
          items={PURCHASE_TABS.map((t) => ({
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                <span className="font-mono text-[10px] text-fg-faint">{counts[t.id] ?? 0}</span>
              </span>
            ),
            href: q ? `${t.href}${t.href.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : t.href,
            active: t.id === (state ?? "ALL"),
          }))}
        />

        <form method="get" className="flex items-center gap-2">
          {state && <input type="hidden" name="state" value={state} />}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search PR number or line description…"
            aria-label="Search purchase requests"
            className="max-w-[320px]"
          />
          <Button type="submit" size="sm">Search</Button>
          <span className="ml-auto font-mono text-[10.5px] text-fg-muted">
            {total} request{total === 1 ? "" : "s"}
          </span>
        </form>

        {rows.length > 0 ? (
          <>
            <PurchasesTable rows={rows} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {current} of {pageCount}</span>
              <Pagination page={current} pageCount={pageCount} hrefFor={hrefFor} />
            </div>
          </>
        ) : filtered ? (
          <EmptyState
            title="No request matches this filter"
            description={
              state && q
                ? `Filtered to ${state} and searching "${q}".`
                : state
                  ? `Filtered to ${state}.`
                  : `Searching "${q}".`
            }
            actions={<ButtonLink href="/purchases">Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState
            title="No purchase requests yet"
            description="A request starts as a draft, goes to IT for specs, then to finance for the money."
            actions={canCreate ? <ButtonLink href="/purchases/new" variant="primary">New request</ButtonLink> : undefined}
          />
        )}
      </div>
    </>
  );
}
