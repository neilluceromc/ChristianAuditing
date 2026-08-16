import { cookies } from "next/headers";
import { requireUser } from "@/server/auth/guards";
import {
  resolveWorkspace,
  ROLE_WORKSPACES,
  WORKSPACE_NAV,
} from "@/lib/workspaces";
import { filterSectionsForRole, getApprovalsBadge, Sidebar } from "@/components/shell/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const sections = filterSectionsForRole(WORKSPACE_NAV[ws], user.role);
  const badge = await getApprovalsBadge();

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-(--radius-btn) focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-accent-fg"
      >
        Skip to content
      </a>
      <Sidebar
        user={user}
        ws={ws}
        sections={sections}
        badge={badge}
        allowed={ROLE_WORKSPACES[user.role]}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" tabIndex={-1} className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
