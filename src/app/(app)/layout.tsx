import { Suspense } from "react";
import { cookies } from "next/headers";
import { requireUser } from "@/server/auth/guards";
import {
  resolveWorkspace,
  ROLE_WORKSPACES,
  WORKSPACE_META,
  WORKSPACE_NAV,
} from "@/lib/workspaces";
import { filterSectionsForRole, getApprovalsBadge, Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { NavigationTracker } from "@/components/shell/navigation-tracker";
import { PageSearchShortcut } from "@/components/shell/page-search-shortcut";
import { purchaseReviewCount, worklistCount } from "@/server/modules/home/queries";
import { CrisOrbDefs } from "@/components/cris/orb";
import { CrisWidget } from "@/components/cris/cris-widget";
import { crisAvailability, crisPrefsFor } from "@/server/cris/settings-read";
import { crisWidgetStart } from "@/server/cris/widget-read";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const sections = filterSectionsForRole(WORKSPACE_NAV[ws], user.role);
  // Spec §5.3: the Worklist count is admin's and IT's only. A failed count
  // hides the badge rather than failing every page's shell. Phase 40 §6: so is
  // the Purchase reviews count, read only where its nav item shows (IT workspace).
  const reviewer = user.role === "admin" || user.role === "it_staff";
  const [approvals, worklist, purchaseReviews, cris] = await Promise.all([
    getApprovalsBadge(user.role),
    reviewer
      ? worklistCount(user.id, user.role).catch((err: unknown) => {
          console.error("[worklist badge] count failed:", err);
          return 0;
        })
      : Promise.resolve(0),
    reviewer && ws === "it"
      ? purchaseReviewCount().catch((err: unknown) => {
          console.error("[purchase reviews badge] count failed:", err);
          return 0;
        })
      : Promise.resolve(0),
    // Phase 41 (spec §2, §4): Cris is admin's and IT's only, and only while the admin switch is on (with no key,
    // Cris shows in preview). A failed read hides Cris rather than failing every page's shell.
    reviewer ? crisFor(user.id, user.name, jar.get("br.theme")?.value) : Promise.resolve(null),
  ]);
  const badges = { approvals, worklist, purchaseReviews };

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-(--radius-btn) focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-accent-fg print:hidden"
      >
        Skip to content
      </a>
      <div className="contents print:hidden">
        <Sidebar
          user={user}
          ws={ws}
          sections={sections}
          badges={badges}
          allowed={ROLE_WORKSPACES[user.role]}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="contents print:hidden">
          <Topbar
            sections={sections}
            badges={badges}
            workspaceLabel={WORKSPACE_META[ws].label}
            user={{ name: user.name, role: user.role }}
            ws={ws}
            allowed={ROLE_WORKSPACES[user.role]}
            meta={WORKSPACE_META}
          />
        </div>
        <main id="main" tabIndex={-1} className="flex-1 p-6 print:p-0">
          {children}
        </main>
      </div>
      <CommandPalette role={user.role} sections={sections} />
      {/* The orb's symbols, once per page: the widget and Settings › Cris both draw from them. */}
      {reviewer && <CrisOrbDefs />}
      {cris && <CrisWidget {...cris} />}
      <PageSearchShortcut />
      <Suspense fallback={null}><NavigationTracker /></Suspense>
    </div>
  );
}

/**
 * The widget's props, or null when Cris doesn't show for this person (switched off, or hidden in their prefs). With
 * no AI key Cris shows in preview: placeholder replies only (added 2026-10-18).
 */
async function crisFor(userId: string, name: string, themeCookie: string | undefined) {
  try {
    const [availability, prefs] = await Promise.all([crisAvailability(), crisPrefsFor(userId)]);
    if (!availability.on || !prefs.show) return null;
    const start = await crisWidgetStart(userId);
    return {
      firstName: name.trim().split(/\s+/)[0] ?? "",
      prefs,
      theme: themeCookie === "dark" ? ("dark" as const) : ("light" as const),
      conversationId: start.conversationId,
      left: start.left,
      preview: !!availability.preview,
    };
  } catch (err: unknown) {
    console.error("[cris] widget read failed:", err);
    return null;
  }
}
