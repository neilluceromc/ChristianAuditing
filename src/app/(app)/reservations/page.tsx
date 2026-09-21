import { requireUser } from "@/server/auth/guards";
import { isDirectLifecycle } from "@/lib/asset-class";
import { clearFilters, parseListState, serializeListState, toggleSort, toSearchParams, type ListState } from "@/lib/url-state";
import { HOLDS_LIST_CONFIG } from "@/lib/holds";
import { localDateISO } from "@/lib/format";
import {
  RESERVATION_TABS, listReservations, parseReservationTab, type ReservationTab,
} from "@/server/modules/reservations/queries";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { Tabs } from "@/components/ui/tabs";
import { HoldsTable } from "@/components/reservations/holds-table";
import { HoldsToolbar } from "@/components/reservations/holds-toolbar";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = toSearchParams(await searchParams);
  const tab = parseReservationTab(sp.get("state"));
  const state = parseListState(sp, HOLDS_LIST_CONFIG);
  const { rows, counts, total, page, pageCount, facets } = await listReservations(tab, state);
  const today = localDateISO(new Date());
  const canRelease = isDirectLifecycle(user.role, "IT");

  const href = (s: ListState, t: ReservationTab = tab) => {
    const qs = serializeListState(s, HOLDS_LIST_CONFIG);
    return "/reservations" + (qs ? `${qs}&state=${t}` : `?state=${t}`);
  };
  const hasFilters = state.q !== "" || Object.keys(state.filters).length > 0;
  const sortHrefs: Record<string, string> = Object.fromEntries(
    HOLDS_LIST_CONFIG.sortable.map((key) => [key, href({ ...state, sort: toggleSort(state.sort, key), page: 1 })]),
  );

  return (
    <>
      <PageHeader
        title="Reservations"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      <div className="flex flex-col gap-3">
        <Banner tone="neutral" title="A hold never changes an asset's status">
          Reserved stock still reads <span className="font-mono">SPARE</span> in inventory, marked{" "}
          <span className="font-mono">HOLD</span> — pretending it is gone creates phantom spares. Holds
          are placed from the asset record or the person&apos;s profile and released there or here.
        </Banner>

        <Tabs
          label="Reservation states"
          items={RESERVATION_TABS.map((t) => ({
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                <span className="font-mono text-[10px] text-fg-muted">{counts[t.id]}</span>
              </span>
            ),
            href: href({ ...state, page: 1 }, t.id),
            active: t.id === tab,
          }))}
          className="pb-1"
        />

        <HoldsToolbar tab={tab} state={state} total={total} facets={facets} />

        {rows.length > 0 ? (
          <>
            <HoldsTable rows={rows} state={state} sortHrefs={sortHrefs} today={today} canRelease={canRelease} />
            <Pagination page={page} pageCount={pageCount} hrefFor={(p) => href({ ...state, page: p })} />
          </>
        ) : hasFilters ? (
          <EmptyState
            title="Your filters matched nothing"
            actions={<ButtonLink href={href(clearFilters(state))}>Clear filters</ButtonLink>}
          />
        ) : (
          <EmptyState
            title={tab === "ACTIVE" ? "No active holds" : "Nothing in this tab"}
            description={
              tab === "ACTIVE"
                ? "Reserve a spare from its record or from a person's profile."
                : "Holds land here once they are fulfilled, released or expired."
            }
          />
        )}
      </div>
    </>
  );
}
