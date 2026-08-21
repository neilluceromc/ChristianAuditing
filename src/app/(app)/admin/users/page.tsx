import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { UserTable } from "@/components/admin/user-table";
import { listUsers } from "@/server/modules/admin/queries";

export default async function UsersPage() {
  const actor = await requireRole("admin");
  const rows = await listUsers();

  return (
    <>
      <PageHeader title="Users & roles" />
      <div className="flex max-w-[860px] flex-col gap-3">
        <Banner tone="neutral" title="Role decides which workspace someone lands in">
          Disabling an account keeps its history and blocks sign-in. The permanent admin cannot be
          demoted or disabled, so the system can never be locked out of itself.
        </Banner>
        <UserTable rows={rows} actorId={actor.id} />
      </div>
    </>
  );
}
