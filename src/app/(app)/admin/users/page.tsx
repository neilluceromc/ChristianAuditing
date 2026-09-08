import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { Pagination } from "@/components/ui/pagination";
import { UserTable } from "@/components/admin/user-table";
import { listUsers } from "@/server/modules/admin/queries";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireRole("admin");
  const sp = toSearchParams(await searchParams);
  const { rows, page, pageCount } = await listUsers(parsePage(sp));

  return (
    <>
      <PageHeader title="Users & roles" />
      <div className="flex max-w-[860px] flex-col gap-3">
        <Banner tone="neutral" title="Role decides which workspace someone lands in">
          Disabling an account keeps its history and blocks sign-in. The permanent admin cannot be
          demoted or disabled, so the system can never be locked out of itself.
        </Banner>
        <UserTable rows={rows} actorId={actor.id} />
        <Pagination
          page={page}
          pageCount={pageCount}
          hrefFor={(p) => (p > 1 ? `/admin/users?page=${p}` : "/admin/users")}
        />
      </div>
    </>
  );
}
