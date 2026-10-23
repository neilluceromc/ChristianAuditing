import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { parseUsersFilter, usersListHref } from "@/lib/admin-lists";
import { ROLE_LABELS, USER_STATUS_LABEL } from "@/lib/admin-users";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ChipFilterRow } from "@/components/patterns/chip-filter-row";
import { UserTable } from "@/components/admin/user-table";
import { listUsers } from "@/server/modules/admin/queries";

export const metadata: Metadata = { title: pageTitle("Users & roles") };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireRole("admin");
  const sp = toSearchParams(await searchParams);
  // Phase 46 (spec §3.2, §4.3): `?disabled=1` lists disabled accounts, `?disabled=0` active ones. Users & access
  // (spec §4.4, Task 3): `?role`, `?status` and `?q` filter too (the nav's "Waiting for approval" is ?status=PENDING);
  // Task 4 rebuilds this page around them.
  const filter = parseUsersFilter(sp);
  const { disabled } = filter;
  const { rows, page, pageCount } = await listUsers(filter, parsePage(sp));
  const chips = [
    ...(filter.role ? [{ label: ROLE_LABELS[filter.role], removeHref: usersListHref({ ...filter, role: null }) }] : []),
    ...(filter.status ? [{ label: USER_STATUS_LABEL[filter.status], removeHref: usersListHref({ ...filter, status: null }) }] : []),
    ...(filter.q ? [{ label: `"${filter.q}"`, removeHref: usersListHref({ ...filter, q: "" }) }] : []),
    ...(disabled !== null ? [{ label: disabled ? "Disabled" : "Active", removeHref: usersListHref({ ...filter, disabled: null }) }] : []),
  ];
  const filtered = chips.length > 0;

  return (
    <>
      <PageHeader title="Users & roles" />
      <div className="flex max-w-[860px] flex-col gap-3">
        <Banner tone="neutral" title="Role decides which workspaces someone can open">
          Disabling an account keeps its history and blocks sign-in. The permanent admin cannot be
          demoted or disabled, so the system can never be locked out of itself.
        </Banner>
        {filtered && <ChipFilterRow chips={chips} clearHref={usersListHref({})} />}
        {rows.length > 0 ? (
          <>
            <UserTable rows={rows} actorId={actor.id} />
            <Pagination page={page} pageCount={pageCount} hrefFor={(p) => usersListHref(filter, p)} />
          </>
        ) : (
          <EmptyState
            title={!filtered ? "No accounts yet" : "No accounts match"}
            description={!filtered ? undefined : "Clear the filters to see every account."}
          />
        )}
      </div>
    </>
  );
}
