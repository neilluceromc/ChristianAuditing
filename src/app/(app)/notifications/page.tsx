import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import { teamOfRole } from "@/lib/intake-rules";
import {
  NOTIFICATION_TABS, NOTIFICATIONS_PAGE, notificationsHref, parseNotificationTab, parseTeam, TEAM_LABEL, TEAMS,
} from "@/lib/notifications";
import { NOTIFICATION_DAYS } from "@/lib/retention";
import { listNotifications } from "@/server/notifications/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkAllReadButton, NotificationList } from "@/components/shell/notifications-page-parts";

export const metadata: Metadata = { title: pageTitle("Notifications") };

/**
 * Task 7 (spec §7): the bell's "See all" — the same tabs (Sent back · To check · Changed · All), 30 at a time, newest
 * first, with "Mark all read". Everyone on a team reads their own team's; an admin, never rung, picks any team.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = toSearchParams(await searchParams);
  const tab = parseNotificationTab(params.get("tab"));
  const admin = user.role === "admin";
  // An admin reads the team they pick (Purchasing until they pick); anyone else always their own.
  const team = teamOfRole(user.role) ?? (admin ? parseTeam(params.get("team")) ?? "PURCHASING" : null);
  const teamParam = admin ? team : null;
  const cursor = params.get("cursor");
  const { items, next } = team
    ? await listNotifications(user, { tab, team, cursor, take: NOTIFICATIONS_PAGE })
    : { items: [], next: null };

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={team ? <MarkAllReadButton team={teamParam} /> : undefined}
      />
      <div className="flex flex-col gap-3">
        {admin && (
          <form method="get" className="flex flex-wrap items-center gap-2">
            {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
            <label htmlFor="notifications-team" className="text-[12.5px] text-fg-secondary">Team</label>
            <Select id="notifications-team" name="team" defaultValue={team ?? "PURCHASING"} className="max-w-[200px]">
              {TEAMS.map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
            </Select>
            <Button type="submit" size="sm">Show</Button>
            <span className="text-[12px] text-fg-muted">Admins aren&apos;t notified; this is the team&apos;s own list.</span>
          </form>
        )}
        {team && (
          <Tabs
            label="Notification types"
            items={NOTIFICATION_TABS.map((t) => ({
              label: t.label,
              href: notificationsHref({ tab: t.id, team: teamParam }),
              active: t.id === tab,
            }))}
          />
        )}
        {!team ? (
          <EmptyState title="No notifications" description="Notifications go to the Purchasing, IT and Finance teams." />
        ) : items.length === 0 ? (
          <EmptyState
            title={cursor ? "No older notifications" : "Nothing here"}
            description={`Notifications are kept for ${NOTIFICATION_DAYS} days.`}
            actions={cursor ? <ButtonLink href={notificationsHref({ tab, team: teamParam })}>Newest</ButtonLink> : undefined}
          />
        ) : (
          <>
            <NotificationList key={`${tab}:${team}:${cursor ?? ""}`} items={items} />
            <nav aria-label="Notification pages" className="flex items-center justify-between pt-1">
              {cursor ? <ButtonLink href={notificationsHref({ tab, team: teamParam })}>Newest</ButtonLink> : <span />}
              {next && <ButtonLink href={notificationsHref({ tab, team: teamParam, cursor: next })}>Older</ButtonLink>}
            </nav>
          </>
        )}
      </div>
    </>
  );
}
