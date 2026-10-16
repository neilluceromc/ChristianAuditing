import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { assetTagFor } from "@/server/page-titles";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { pagedSnapshot } from "@/server/paged";
import { historyEntries } from "@/lib/history";
import { resolveHistoryNames } from "@/server/modules/inventory/history-names";
import { fmtDate } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { LOG_PAGE_SIZE, parsePage } from "@/lib/paging";
import { Table, TBody, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { HistoryEntryRows } from "@/components/inventory/history-entry-rows";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("History", await assetTagFor(id)) };
}

export default async function AssetHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = toSearchParams(await searchParams);
  const asset = await getVisibleAsset(id, user.role);
  if (!asset) notFound();
  const where = { entityType: "asset", entityId: id };
  const { rows: entries, ...pg } = await pagedSnapshot(
    LOG_PAGE_SIZE,
    parsePage(sp),
    (tx) => tx.auditEntry.count({ where }),
    (tx, pg) =>
      tx.auditEntry.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pg.skip,
        take: pg.take,
      }),
  );
  const groups = historyEntries(entries, await resolveHistoryNames(entries));

  if (groups.length === 0) {
    return <EmptyState title="No changes recorded" description="Every field change lands here, one row per field." />;
  }

  return (
    <>
      <Table>
        <THead>
          <Tr>
            <Th width={130}>When</Th>
            <Th width={140}>Actor</Th>
            <Th width={130}>Action</Th>
            <Th width={120}>Field</Th>
            <Th>Change</Th>
          </Tr>
        </THead>
        <TBody>
          {groups.map((g) => (
            <HistoryEntryRows
              key={g.key}
              when={fmtDate(g.at)}
              actor={g.actor}
              action={g.action}
              fields={g.fields.map((f) => ({ key: f.key, field: f.field, from: f.from, to: f.to }))}
            />
          ))}
        </TBody>
      </Table>
      <div className="flex items-center justify-between pt-2">
        <span className="font-mono text-[11px] text-fg-muted">page {pg.page} of {pg.pageCount} · {pg.total} entries</span>
        <Pagination page={pg.page} pageCount={pg.pageCount} hrefFor={(p) => (p > 1 ? `?page=${p}` : "?")} />
      </div>
    </>
  );
}
