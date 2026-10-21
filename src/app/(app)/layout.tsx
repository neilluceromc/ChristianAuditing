import { Suspense } from "react";
import type { Role } from "@prisma/client";
import { cookies } from "next/headers";
import { requireUser } from "@/server/auth/guards";
import {
  filterSectionsForRole,
  resolveWorkspace,
  ROLE_WORKSPACES,
  WORKSPACE_META,
  WORKSPACE_NAV,
} from "@/lib/workspaces";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { navDestinations } from "@/lib/shell";
import { NavigationTracker } from "@/components/shell/navigation-tracker";
import { StuckNavGuard } from "@/components/shell/stuck-nav-guard";
import { PageSearchShortcut } from "@/components/shell/page-search-shortcut";
import { SidebarShell } from "@/components/shell/sidebar-collapse";
import { parseSidebar, SIDEBAR_COOKIE } from "@/lib/sidebar-state";
import { UI_UID_COOKIE } from "@/lib/ui-prefs";
import { UiPrefsSync } from "@/components/shell/ui-prefs-sync";
import { navCountKeys, type NavBadges } from "@/lib/nav-badges";
import { defaultClassFor } from "@/lib/asset-class";
import { getApprovalsBadge, readNavCounts } from "@/server/modules/home/nav-counts";
import { unreadCount } from "@/server/notifications/queries";
import { CrisOrbDefs } from "@/components/cris/orb";
import { CrisWidget } from "@/components/cris/cris-widget";
import { crisAvailability, crisPrefsFor } from "@/server/cris/settings-read";
import { crisWidgetStart } from "@/server/cris/widget-read";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const sections = filterSectionsForRole(WORKSPACE_NAV[ws], user.role);
  const reviewer = user.role === "admin" || user.role === "it_staff";
  // Phase 42 spec §4.3: only the counts this role's visible links and views use are read. Role gating comes from
  // which keys the visible nav carries; readNavCounts keeps the Worklist and Purchase reviews counts admin's and
  // IT's only; both it and getApprovalsBadge fail each count to 0 rather than failing every page's shell.
  const keys = navCountKeys(sections);
  // Task 7 (purchase-orders spec §7): the bell's first count. A viewer has no team, so no bell (null); an admin's bell
  // never rings (0). Like the nav counts, a failed read shows 0 rather than failing every page's shell.
  const [approvals, counts, cris, unread] = await Promise.all([
    keys.includes("approvals") ? getApprovalsBadge(user.role) : Promise.resolve({ open: 0, overdue: 0 }),
    readNavCounts(keys.filter((k) => k !== "approvals"), user),
    // Phase 41 (spec §2, §4): Cris is admin's and IT's only, and only while the admin switch is on (with no key,
    // Cris shows in preview). A failed read hides Cris rather than failing every page's shell.
    reviewer ? crisFor(user.id, user.name, jar.get("br.theme")?.value) : Promise.resolve(null),
    user.role === "viewer" ? Promise.resolve(null) : bellStart(user),
  ]);
  const badges: NavBadges = { approvals, counts: { ...counts, approvals: approvals.open } };
  // Spec §4.2: /inventory drops `cls` from its URLs when it is the viewer's default, so the nav matcher needs it.
  const defaultCls = defaultClassFor(user.role);
  // Phase 46 spec §4.1: the sidebar's rail or full state, read here so the first paint is already right.
  const sidebar = parseSidebar(jar.get(SIDEBAR_COOKIE)?.value);

  return (
    <SidebarShell initial={sidebar}>
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
          defaultCls={defaultCls}
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
            defaultCls={defaultCls}
            unread={unread}
          />
        </div>
        <main id="main" tabIndex={-1} className="flex-1 p-6 print:p-0">
          {children}
        </main>
      </div>
      <CommandPalette destinations={navDestinations(WORKSPACE_NAV[ws], user.role)} />
      {/* The orb's symbols, once per page: the widget and Settings › Cris both draw from them. */}
      {reviewer && <CrisOrbDefs />}
      {cris && <CrisWidget {...cris} />}
      <PageSearchShortcut />
      {/* Phase 47 spec §5.4: settings follow the person; rewrites the cookies when they are someone else's. */}
      <UiPrefsSync userId={user.id} cookieUid={jar.get(UI_UID_COOKIE)?.value} />
      <Suspense fallback={null}><NavigationTracker /></Suspense>
      {/* Same-page filter links that never commit in production fall back to an ordinary load (src/lib/stuck-nav.ts). */}
      <StuckNavGuard />
    </SidebarShell>
  );
}

/** The bell's count for the first paint; 0 (with a log) when the read fails, as every nav count does. */
async function bellStart(user: { id: string; role: Role }): Promise<number> {
  try {
    return await unreadCount(user);
  } catch (err: unknown) {
    console.error("[nav counts] notifications failed:", err);
    return 0;
  }
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
