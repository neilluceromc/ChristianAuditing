import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { canManageClass } from "@/lib/asset-class";
import { ROLE_LANDING } from "@/lib/workspaces";
import { clearedToday, worklist } from "@/server/modules/home/queries";
import { pageFrom, queueFrom } from "@/lib/worklist-view";
import { WorklistView } from "@/components/worklist/worklist-view";

export const metadata: Metadata = { title: pageTitle("Worklist") };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Worklist H4: one screen — queue tabs, a sortable paged table and a details panel. `?q` opens a queue, `?page` a
 * page, `?sel` a row (plan call 10); every queue is read here once, and the rest is the client's.
 */
export default async function WorklistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  // Viewer reads the whole worklist (read-only: no ticks, no buttons); every
  // other role needs to manage IT directly — same test spec-13's page-level
  // checks already use elsewhere in inventory/.
  if (!canManageClass(user.role, "IT") && user.role !== "viewer") redirect(ROLE_LANDING[user.role]);

  const sp = await searchParams;
  const [groups, cleared] = await Promise.all([worklist(user.id, user.role, {}), clearedToday(user.id)]);
  const sel = one(sp.sel);

  return (
    <WorklistView
      groups={groups}
      initial={{ q: queueFrom(one(sp.q), groups), page: pageFrom(one(sp.page)), sel: sel || null }}
      canAct={user.role !== "viewer"}
      cleared={cleared}
    />
  );
}
