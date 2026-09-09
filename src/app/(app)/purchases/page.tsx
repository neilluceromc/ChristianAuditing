import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { toSearchParams } from "@/lib/url-state";
import { PURCHASE_TABS, parsePurchaseState } from "@/lib/purchases-list";
import { parsePage } from "@/lib/paging";
import { listPurchases, stateCounts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ChipFilterRow } from "@/components/patterns/chip-filter-row";
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
  const department = params.get("department") || null;
  const supplier = params.get("supplier") || null;
  const page = parsePage(params);

  const [{ rows, total, page: current, pageCount }, counts, departments, supplierRow] = await Promise.all([
    listPurchases(state, q, page, department, supplier),
    stateCounts(),
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    supplier ? prisma.vendor.findUnique({ where: { id: supplier }, select: { name: true } }) : Promise.resolve(null),
  ]);

  const canCreate = user.role === "purchasing_staff" || user.role === "admin";
  const filtered = Boolean(state || q || department || supplier);

  // Carries the free-text search and both filters onto any URLSearchParams —
  // shared by hrefFor (pagination) and the state tabs below, so a filtered
  // view survives navigating either one.
  const carry = (qs: URLSearchParams) => {
    if (q) qs.set("q", q);
    if (department) qs.set("department", department);
    if (supplier) qs.set("supplier", supplier);
    return qs;
  };
  const hrefFor = (p: number) => {
    const next = carry(new URLSearchParams());
    if (state) next.set("state", state);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };
  const hrefWithout = (key: string) => {
    const next = carry(new URLSearchParams());
    if (state) next.set("state", state);
    next.delete(key);
    const qs = next.toString();
    return qs ? `?${qs}` : "/purchases";
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
          items={PURCHASE_TABS.map((t) => {
            const next = carry(new URLSearchParams());
            if (t.id !== "ALL") next.set("state", t.id);
            const qs = next.toString();
            return {
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {t.label}
                  <span className="font-mono text-[10px] text-fg-faint">{counts[t.id] ?? 0}</span>
                </span>
              ),
              href: qs ? `/purchases?${qs}` : "/purchases",
              active: t.id === (state ?? "ALL"),
            };
          })}
        />

        <form method="get" className="flex flex-wrap items-center gap-2">
          {state && <input type="hidden" name="state" value={state} />}
          {supplier && <input type="hidden" name="supplier" value={supplier} />}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search PR number or line description…"
            aria-label="Search purchase requests"
            className="max-w-[320px]"
          />
          <Select
            name="department"
            aria-label="Requesting department"
            defaultValue={department ?? ""}
            className="max-w-[200px]"
          >
            <option value="">All departments</option>
            <option value="none">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Button type="submit" size="sm">Search</Button>
          <span className="ml-auto font-mono text-[10.5px] text-fg-muted">
            {total} request{total === 1 ? "" : "s"}
          </span>
        </form>

        {supplier && supplierRow && (
          <ChipFilterRow
            chips={[{ label: `Supplier: ${supplierRow.name}`, removeHref: hrefWithout("supplier") }]}
            clearHref="/purchases"
          />
        )}

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
            description={(() => {
              const parts: string[] = [];
              if (state) parts.push(`state ${state}`);
              if (department === "none") parts.push("no department");
              else if (department) parts.push(`department "${departments.find((d) => d.id === department)?.name ?? department}"`);
              if (supplier && supplierRow) parts.push(`supplier "${supplierRow.name}"`);
              if (q) parts.push(`searching "${q}"`);
              return parts.length ? `Filtered to ${parts.join(", ")}.` : "Try clearing the filters.";
            })()}
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
