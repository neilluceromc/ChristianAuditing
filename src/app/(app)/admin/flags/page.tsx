import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { ChipFilterRow } from "@/components/patterns/chip-filter-row";
import { FlagRows } from "@/components/admin/flag-rows";
import { toSearchParams } from "@/lib/url-state";
import { filterFlags, flagsHref, parseFlagsState } from "@/lib/admin-lists";
import { listFlags } from "@/server/modules/admin/queries";

export const metadata: Metadata = { title: pageTitle("Feature flags") };

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin");
  // Phase 46 (spec §4.3): `?state=unavailable` keeps only the flags whose UNAVAILABLE pill shows.
  const state = parseFlagsState(toSearchParams(await searchParams).get("state"));
  const rows = filterFlags(await listFlags(), state);

  return (
    <>
      <PageHeader title="Feature flags" />
      <div className="flex max-w-[720px] flex-col gap-3">
        <Banner tone="neutral" title="These take effect immediately, for everyone">
          Both flags change who can get in, so they are audited like any other change. A flag marked
          UNAVAILABLE is one whose feature isn&apos;t finished — it can always be turned off, never on,
          until it is.
        </Banner>
        {state && (
          <ChipFilterRow chips={[{ label: "Unavailable", removeHref: flagsHref(null) }]} clearHref={flagsHref(null)} />
        )}
        {rows.length > 0 ? (
          <FlagRows rows={rows} />
        ) : (
          <EmptyState
            title={state ? "No unavailable flags" : "No flags"}
            description={state ? "Every flag in this build can be switched on." : undefined}
          />
        )}
      </div>
    </>
  );
}
