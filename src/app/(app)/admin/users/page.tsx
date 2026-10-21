import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { parseUsersDisabled, usersHref } from "@/lib/admin-lists";
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
  // Phase 46 (spec §3.2, §4.3): `?disabled=1` lists disabled accounts, `?disabled=0` active ones.
  const disabled = parseUsersDisabled(sp.get("disabled"));
  const { rows, page, pageCount } = await listUsers(parsePage(sp), disabled);

  return (
    <>
      <PageHeader title="Users & roles" />
      <div className="flex max-w-[860px] flex-col gap-3">
        <Banner tone="neutral" title="Role decides which workspaces someone can open">
          Disabling an account keeps its history and blocks sign-in. The permanent admin cannot be
          demoted or disabled, so the system can never be locked out of itself.
        </Banner>
        {disabled !== null && (
          <ChipFilterRow
            chips={[{ label: disabled ? "Disabled" : "Active", removeHref: usersHref(null) }]}
            clearHref={usersHref(null)}
          />
        )}
        {rows.length > 0 ? (
          <>
            <UserTable rows={rows} actorId={actor.id} />
            <Pagination page={page} pageCount={pageCount} hrefFor={(p) => usersHref(disabled, p)} />
          </>
        ) : (
          <EmptyState
            title={disabled === null ? "No accounts yet" : disabled ? "No disabled accounts" : "No active accounts"}
            description={disabled === null ? undefined : "Every account is in the other list."}
          />
        )}
      </div>
    </>
  );
}
