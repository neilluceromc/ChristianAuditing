import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { cookies } from "next/headers";
import { requireUser } from "@/server/auth/guards";
import { resolveWorkspace, type WorkspaceId } from "@/lib/workspaces";
import { safeSection } from "@/lib/section";
import { adminOverview, financeOverview, itOverview, purchasingOverview } from "@/server/modules/home/overview";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { SectionCard } from "@/components/home/section-card";
import { FocusToggle } from "@/components/home/focus-toggle";
import { OverviewHome } from "@/components/home/overview/overview";

/**
 * Focus's only job is hiding SECONDARY sections. Phase 46 (spec §3.1): on every
 * workspace's Overview that is the trend, the make-up and the breakdown — focus
 * keeps the KPI row and "Needs you". Every workspace has those secondary
 * sections, so every workspace shows the toggle. A `Record` rather than an
 * inline `true` so adding a fifth workspace forces a decision at this table
 * instead of being silently `true` by omission (HANDOVER §6a rule 10's near
 * relative: never a control that does nothing visible).
 */
const SHOWS_FOCUS_TOGGLE: Record<WorkspaceId, boolean> = {
  it: true,
  purchasing: true,
  finance: true,
  admin: true,
};

/** Phase 46 (spec §3.2): each workspace's Overview builder. A viewer reads IT's, read-only (every action Open). */
const OVERVIEW: Record<WorkspaceId, typeof itOverview> = {
  it: itOverview,
  purchasing: purchasingOverview,
  finance: financeOverview,
  admin: adminOverview,
};

export const metadata: Metadata = { title: pageTitle("Home") };

export default async function Home() {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const focus = jar.get("br.focus")?.value === "on";
  const isViewer = user.role === "viewer";

  // Brief §7: a builder that throws shows the designed FAILED card; the header and its controls still render.
  const overview = await safeSection("Overview", () => OVERVIEW[ws](user, new Date()));

  return (
    <>
      <PageHeader
        title={`Hello, ${user.name.split(" ")[0]}`}
        badge={isViewer ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
        actions={SHOWS_FOCUS_TOGGLE[ws] ? <FocusToggle on={focus} /> : undefined}
      />
      {overview.ok ? (
        <OverviewHome overview={overview.data} focus={focus} />
      ) : (
        <SectionCard title="Overview" result={overview}>
          {() => null}
        </SectionCard>
      )}
    </>
  );
}
