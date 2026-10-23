import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { flagDomain } from "@/lib/auth-shared";
import { parseUsersFilter } from "@/lib/admin-lists";
import { prisma } from "@/server/db/client";
import { ListNavigationProvider } from "@/components/patterns/list-navigation";
import { UsersView } from "@/components/admin/users/users-view";
import { findUserRow, listUsers } from "@/server/modules/admin/queries";

export const metadata: Metadata = { title: pageTitle("Users & access") };

/**
 * Users & access (spec §4.4, Task 4): `?role=`, `?status=`, `?q=` and `?page=` filter the list on the server; `?sel=`
 * opens one person's details (read on its own when this page doesn't list them, e.g. an account just created).
 *
 * `?disabled=1` (the old Disabled view's link) is an alias of `?status=DISABLED` and is redirected there. `?disabled=0`
 * (the Admin overview's "Active accounts" tile: turned on, any status) is still parsed and shown as a chip.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireRole("admin");
  const sp = toSearchParams(await searchParams);
  if (sp.get("disabled") === "1") {
    sp.delete("disabled");
    sp.set("status", "DISABLED");
    redirect(`/admin/users?${sp.toString()}`);
  }
  const filter = parseUsersFilter(sp);
  const sel = sp.get("sel") || null;
  const [list, domainFlag] = await Promise.all([
    listUsers(filter, parsePage(sp)),
    prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } }),
  ]);
  const selected = sel ? (list.rows.find((r) => r.id === sel) ?? (await findUserRow(sel))) : null;

  return (
    <ListNavigationProvider>
      <UsersView
        list={list}
        filter={filter}
        sel={selected ? sel : null}
        selected={selected}
        actorId={actor.id}
        domain={flagDomain(domainFlag)}
        now={new Date().toISOString()}
      />
    </ListNavigationProvider>
  );
}
