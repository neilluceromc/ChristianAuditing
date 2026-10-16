import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { pagedSnapshot } from "@/server/paged";
import { fmtDate, localDateISO } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { DEFAULT_STATUS, isDirectLifecycle } from "@/lib/asset-class";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldPill } from "@/components/ui/hold-pill";
import { Pagination } from "@/components/ui/pagination";
import { ReleaseHoldButton } from "@/components/inventory/release-hold-button";

/** Phase 39 (spec §5): resolved holds are paged, 20 to a page. */
const PAST_PAGE_SIZE = 20;

type HoldRow = Prisma.ReservationGetPayload<{ include: { employee: true } }>;

function HoldsTable({
  holds, today, canRelease, tag,
}: { holds: HoldRow[]; today: string; canRelease: boolean; tag: string }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th width={19} aria-label="State colour" />
          <Th width={104}>State</Th>
          <Th>For</Th>
          <Th>Reason</Th>
          <Th width={110}>Expires</Th>
          <Th width={110}>Resolved</Th>
          <Th width={96}><span className="sr-only">Actions</span></Th>
        </Tr>
      </THead>
      <TBody>
        {holds.map((r) => (
          <Tr key={r.id}>
            <Td className="pr-0"><StatusDot value={r.state} /></Td>
            <Td mono className="text-[10.5px]">{r.state}</Td>
            <Td>
              <a href={`/employees/${r.employee.id}`} className="text-accent hover:underline">
                {r.employee.name} · {r.employee.employeeNo}
              </a>
            </Td>
            <Td>{r.reason ?? "—"}</Td>
            <Td mono>
              {r.state === "ACTIVE" && r.expiresAt ? <HoldPill expiresAt={r.expiresAt} today={today} withDate /> : fmtDate(r.expiresAt)}
            </Td>
            <Td mono>{fmtDate(r.resolvedAt)}</Td>
            <Td>
              {r.state === "ACTIVE" && canRelease ? <ReleaseHoldButton reservationId={r.id} tag={tag} size="sm" /> : null}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

export default async function AssetReservationsPage({
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
  const showPast = sp.get("past") === "1";
  const pastWhere = { assetId: id, state: { not: "ACTIVE" as const } };
  const [active, past] = await Promise.all([
    prisma.reservation.findMany({
      where: { assetId: id, state: "ACTIVE" },
      include: { employee: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    // The count is always read (the link says how many); the rows only when the past is open.
    pagedSnapshot(
      PAST_PAGE_SIZE,
      showPast ? parsePage(sp) : 1,
      (tx) => tx.reservation.count({ where: pastWhere }),
      (tx, pg) =>
        showPast
          ? tx.reservation.findMany({
              where: pastWhere,
              include: { employee: true },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              skip: pg.skip,
              take: pg.take,
            })
          : Promise.resolve([] as HoldRow[]),
    ),
  ]);
  const today = localDateISO(new Date());
  const canRelease = isDirectLifecycle(user.role, asset.cls);

  if (active.length === 0 && past.total === 0) {
    return (
      <EmptyState
        title="No holds on this asset"
        description={`Reserved stock still reads ${DEFAULT_STATUS[asset.cls]} in inventory — holds only appear here and on the reservations list.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {active.length > 0 ? (
        <HoldsTable holds={active} today={today} canRelease={canRelease} tag={asset.tag} />
      ) : (
        <p className="text-xs text-fg-muted">No active holds.</p>
      )}
      {past.total > 0 && (
        showPast ? (
          <section aria-label="Past holds" className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[12.5px] font-semibold text-fg">Past holds ({past.total})</h3>
              <Link href="?" className="text-xs text-accent hover:underline">Hide past holds</Link>
            </div>
            <HoldsTable holds={past.rows} today={today} canRelease={canRelease} tag={asset.tag} />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[11px] text-fg-muted">page {past.page} of {past.pageCount} · {past.total} past holds</span>
              <Pagination page={past.page} pageCount={past.pageCount} hrefFor={(p) => (p > 1 ? `?past=1&page=${p}` : "?past=1")} />
            </div>
          </section>
        ) : (
          <div>
            <Link href="?past=1" className="text-xs font-medium text-accent hover:underline">
              Show past holds ({past.total})
            </Link>
          </div>
        )
      )}
    </div>
  );
}
