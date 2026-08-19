import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { FlagRows } from "@/components/admin/flag-rows";
import { listFlags } from "@/server/modules/admin/queries";

export default async function FlagsPage() {
  await requireRole("admin");
  const rows = await listFlags();

  return (
    <>
      <PageHeader title="Feature flags" />
      <div className="flex max-w-[720px] flex-col gap-3">
        <Banner tone="neutral" title="These take effect immediately, for everyone">
          Both flags change who can get in, so they are audited like any other change. A flag marked
          UNAVAILABLE is one whose feature isn&apos;t finished — the switch stays off until it is.
        </Banner>
        <FlagRows rows={rows} />
      </div>
    </>
  );
}
