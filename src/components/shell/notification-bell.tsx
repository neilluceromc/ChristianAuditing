"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import {
  arrivalText, bellLabel, NOTIFICATION_TABS, notificationsHref, TEAM_LABEL, type NotificationTab, type NotificationView,
} from "@/lib/notifications";
import { BELL_POLL_MS, bellPollStep, initialBellPollState, type BellPollEvent, type BellPollState } from "@/lib/bell-poll";
import { bellCount, bellItems, markRead } from "@/server/notifications/actions";
import { Icon } from "@/components/ui/icon";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";

/**
 * Task 7 (spec §7): the team bell in the top bar, on every page. A real button named "Notifications, N unread"; its
 * panel (a non-modal dialog right after it in the DOM; opening it moves focus to its selected tab) has the tabs Sent back · To check ·
 * Changed · All, the newest 8 of each, and "See all". Opening an item marks it read — for this person only — and goes
 * to it. The count is polled as bellPollStep decides (every 2 minutes while the tab is visible and the person is
 * active, on window focus, on a route change at most once per 30 s; nothing after 10 idle minutes until the next
 * input) — cheap on Vercel Hobby. A polite live region says "1 new notification" only when the count goes up, from a
 * poll or from a layout re-render. An admin's bell (2026-10-23) works the same across every team: the count sums them,
 * and each item carries its team.
 */
export function NotificationBell({ initialCount, admin }: { initialCount: number; admin: boolean }) {
  const pathname = usePathname();
  const panelId = useId();
  const tabsId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Partial<Record<NotificationTab, HTMLButtonElement | null>>>({});

  const [count, setCount] = useState(initialCount);
  const countRef = useRef(initialCount);
  useEffect(() => {
    countRef.current = count;
  }, [count]);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotificationTab>("all");
  /** null while the tab loads */
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // A navigation closes the panel (its item was opened, or the person went elsewhere).
  const [path, setPath] = useState(pathname);
  if (pathname !== path) {
    setPath(pathname);
    setOpen(false);
  }

  /** The new count; announced only when it went up (an arrival), never when it dropped (read here or elsewhere). */
  const announceTimer = useRef<number | undefined>(undefined);
  const applyCount = useCallback((next: number, announce: boolean) => {
    const text = announce ? arrivalText(countRef.current, next) : null;
    countRef.current = next;
    setCount(next);
    if (text) {
      // Cleared first, so the same words ("1 new notification" twice) are announced again.
      setAnnouncement("");
      window.clearTimeout(announceTimer.current);
      announceTimer.current = window.setTimeout(() => setAnnouncement(text), 100);
    }
  }, []);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  // A server render with a new count (a revalidation re-rendered the layout) wins over what this copy last saw, and
  // is announced like a poll's when it went up.
  const lastInitial = useRef(initialCount);
  useEffect(() => {
    if (initialCount === lastInitial.current) return;
    lastInitial.current = initialCount;
    applyCount(initialCount, true);
  }, [initialCount, applyCount]);

  // When to ask the server (bellPollStep). The layout's render counts as the first poll.
  const schedule = useRef<BellPollState | null>(null);
  const step = useCallback(async (event: BellPollEvent) => {
    const now = Date.now();
    const r = bellPollStep(schedule.current ?? initialBellPollState(now), event, now);
    schedule.current = r.state;
    if (!r.poll) return;
    try {
      const res = await bellCount();
      applyCount(res.count, true);
    } catch {
      // offline or signed out mid-poll: keep the last count
    }
  }, [applyCount]);

  // A route change (the first render already has the layout's count), at most one poll per 30 s.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      schedule.current ??= initialBellPollState(Date.now());
      return;
    }
    void step("route");
  }, [pathname, step]);

  // The interval while this tab is visible; window focus or coming back to the tab polls; pointer and key input keep
  // the person active (the first input after 10 idle minutes polls at once).
  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => void step("interval"), BELL_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void step("focus");
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => void step("focus");
    const onInput = () => void step("input");
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("pointermove", onInput, { passive: true });
    window.addEventListener("keydown", onInput);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("pointermove", onInput);
      window.removeEventListener("keydown", onInput);
    };
  }, [step]);

  // The open tab's items.
  useEffect(() => {
    if (!open) return;
    let live = true;
    bellItems({ tab })
      .then((r) => {
        if (live) setItems(r.items);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, tab]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // Escape (top overlay layer only) closes and returns focus to the bell.
  useOverlayLayer(open, () => close(true));

  // The panel is a dialog (aria-haspopup="dialog"), so opening it moves focus into it: onto the selected tab. Only on
  // the open itself — a tab change already focuses its own tab.
  useEffect(() => {
    if (!open) return;
    tabRefs.current[tab]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A click outside closes without refocusing: focus follows the click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  function toggle() {
    if (open) {
      close(false);
      return;
    }
    setItems(null);
    setFailed(false);
    setOpen(true);
  }

  function pickTab(next: NotificationTab, focus = false) {
    if (next !== tab) {
      setItems(null);
      setFailed(false);
      setTab(next);
    }
    if (focus) tabRefs.current[next]?.focus();
  }

  /** Arrow keys move between the tabs (and select them); Home and End jump to the ends. */
  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    const ids = NOTIFICATION_TABS.map((t) => t.id);
    const i = ids.indexOf(tab);
    const to =
      e.key === "ArrowRight" ? ids[(i + 1) % ids.length]
      : e.key === "ArrowLeft" ? ids[(i - 1 + ids.length) % ids.length]
      : e.key === "Home" ? ids[0]
      : e.key === "End" ? ids[ids.length - 1]
      : null;
    if (!to) return;
    e.preventDefault();
    pickTab(to, true);
  }

  function openItem(n: NotificationView) {
    if (!n.read) {
      setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? list);
      applyCount(Math.max(0, countRef.current - 1), false);
      void markRead({ ids: [n.id] })
        .then((r) => {
          if (r.ok) applyCount(r.data.count, false);
        })
        .catch(() => {});
    }
    setOpen(false);
  }

  const shown = count > 99 ? "99+" : String(count);

  return (
    <div
      ref={rootRef}
      className="relative"
      // Tabbing out of the panel (or the bell) closes it. A click on the panel's plain text blurs to nothing (no
      // relatedTarget) and must not; a click outside is the mousedown listener's.
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (open && to && !rootRef.current?.contains(to)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={bellLabel(count)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        className="relative grid size-8 place-items-center rounded-(--radius-btn) border border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle"
      >
        <Icon name="bell" size={16} />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--st-fault-dot)] px-1 font-mono text-[10px] font-semibold leading-none text-surface"
          >
            {shown}
          </span>
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "z-40 flex flex-col rounded-(--radius-card) border border-border bg-surface-raised shadow-pop",
            // a phone: the full width under the bar; from sm: under the bell, right-aligned
            "fixed inset-x-4 top-[56px] max-h-[70vh] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:w-[380px]",
          )}
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          <div role="tablist" aria-label="Notification types" className="flex gap-1 border-b border-border px-2">
            {NOTIFICATION_TABS.map((t) => {
              const selected = t.id === tab;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${tabsId}-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => pickTab(t.id)}
                  onKeyDown={onTabKey}
                  className={cn(
                    "relative px-2.5 py-2 text-[12px] font-medium",
                    selected ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
                  )}
                >
                  {t.label}
                  {selected && <span aria-hidden className="absolute inset-x-1.5 bottom-0 h-[2px] bg-accent" />}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={`${tabsId}-panel`}
            aria-labelledby={`${tabsId}-${tab}`}
            aria-busy={items === null && !failed}
            className="min-h-[72px] overflow-y-auto"
          >
            {failed ? (
              <p className="px-4 py-3 text-[13px] text-fg-secondary">Couldn&apos;t load notifications. Try again.</p>
            ) : items === null ? (
              <p className="px-4 py-3 text-[13px] text-fg-muted">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-fg-muted">Nothing here.</p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => (
                  <li key={n.id}>
                    <NotificationLink n={n} onOpen={() => openItem(n)} compact showTeam={admin} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-border px-4 py-2 text-right">
            <Link
              href={notificationsHref({ tab })}
              onClick={() => setOpen(false)}
              className="text-[12.5px] font-medium text-accent underline-offset-2 hover:underline"
            >
              See all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One notification as a link to its record: what happened, the reason or note, who did it and when; unread ones are
 * marked (in words for a screen reader, a dot for the eye). Shared by the bell and /notifications. `showTeam` (an
 * admin's lists, which mix every team's) adds the team it rang.
 */
export function NotificationLink({
  n, onOpen, compact = false, showTeam = false,
}: { n: NotificationView; onOpen: () => void; compact?: boolean; showTeam?: boolean }) {
  const when = new Date(n.createdAt);
  return (
    <Link
      href={n.href}
      onClick={onOpen}
      className={cn("flex gap-2.5 hover:bg-surface-subtle", compact ? "px-4 py-2.5" : "px-4 py-3")}
    >
      <span
        aria-hidden
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-[var(--st-fault-dot)]")}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-[13px] text-fg", !n.read && "font-semibold")}>
          {!n.read && <span className="sr-only">Unread: </span>}
          {n.title}
        </span>
        {n.body && <span className="text-[12.5px] text-fg-secondary">&ldquo;{n.body}&rdquo;</span>}
        <span className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-fg-muted">
          {showTeam && (
            <span className="rounded-full border border-border px-1.5 text-[10.5px] font-medium leading-[16px] text-fg-secondary">
              {TEAM_LABEL[n.team]}
            </span>
          )}
          <span>
            {n.actorName ?? "Someone"} · <time dateTime={when.toISOString()}>{fmtDateTime(when)}</time>
          </span>
        </span>
      </span>
    </Link>
  );
}
