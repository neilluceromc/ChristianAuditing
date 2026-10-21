import type { NotificationKind } from "@prisma/client";
import type { Team } from "./intake-rules";

/**
 * Task 7 (spec §7): the bell's and the notifications page's pure parts — the tabs, the words a screen reader hears,
 * and the page cursor. Client-safe: no Prisma runtime, no server code.
 */

export const NOTIFICATION_TABS = [
  { id: "sent-back", label: "Sent back", kind: "SENT_BACK" },
  { id: "to-check", label: "To check", kind: "TO_CHECK" },
  { id: "changed", label: "Changed", kind: "CHANGED" },
  { id: "all", label: "All", kind: null },
] as const satisfies ReadonlyArray<{ id: string; label: string; kind: NotificationKind | null }>;

export type NotificationTab = (typeof NOTIFICATION_TABS)[number]["id"];

/** The bell shows this many per tab; the page pages this many at a time. */
export const BELL_ITEMS = 8;
export const NOTIFICATIONS_PAGE = 30;

export const TEAMS: readonly Team[] = ["PURCHASING", "IT", "FINANCE"];
export const TEAM_LABEL: Record<Team, string> = { IT: "IT", PURCHASING: "Purchasing", FINANCE: "Finance" };

export function parseNotificationTab(raw: string | null | undefined): NotificationTab {
  return NOTIFICATION_TABS.find((t) => t.id === raw)?.id ?? "all";
}

export function parseTeam(raw: string | null | undefined): Team | null {
  return (TEAMS as readonly string[]).includes(raw ?? "") ? (raw as Team) : null;
}

export function tabKind(tab: NotificationTab): NotificationKind | null {
  return NOTIFICATION_TABS.find((t) => t.id === tab)!.kind;
}

/** A /notifications URL; the defaults (All, the first page) are left out. */
export function notificationsHref(p: { tab: NotificationTab; team?: Team | null; cursor?: string | null }): string {
  const qs = new URLSearchParams();
  if (p.tab !== "all") qs.set("tab", p.tab);
  if (p.team) qs.set("team", p.team);
  if (p.cursor) qs.set("cursor", p.cursor);
  const s = qs.toString();
  return s ? `/notifications?${s}` : "/notifications";
}

/** The bell's accessible name (spec §7: "Notifications, 3 unread"). */
export function bellLabel(unread: number): string {
  return `Notifications, ${unread} unread`;
}

/** What the polite live region says when the count goes up, once per arrival; nothing when it stays or drops. */
export function arrivalText(before: number, after: number): string | null {
  const n = after - before;
  if (n <= 0) return null;
  return `${n} new notification${n === 1 ? "" : "s"}`;
}

/** One view of a notification, as the bell and the page draw it. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string;
  actorName: string | null;
  createdAt: Date;
  /** read by the person looking (read state is per person) */
  read: boolean;
}

/** The page cursor: the last item's time and id ("<ISO>~<id>"), newest first. */
export function encodeCursor(last: { createdAt: Date; id: string }): string {
  return `${last.createdAt.toISOString()}~${last.id}`;
}

export function decodeCursor(raw: string | null | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const i = raw.indexOf("~");
  if (i <= 0 || i === raw.length - 1) return null;
  const at = new Date(raw.slice(0, i));
  if (Number.isNaN(at.getTime())) return null;
  return { at, id: raw.slice(i + 1) };
}
