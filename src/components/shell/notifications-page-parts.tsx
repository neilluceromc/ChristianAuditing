"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { NotificationView } from "@/lib/notifications";
import type { Team } from "@/lib/intake-rules";
import { markAllRead, markRead } from "@/server/notifications/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { NotificationLink } from "./notification-bell";

/** Task 7 (spec §7): the notifications page's list; opening an item marks it read for this person and goes to it. */
export function NotificationList({ items }: { items: NotificationView[] }) {
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());
  return (
    <ul className="divide-y divide-border rounded-(--radius-card) border border-border bg-surface">
      {items.map((n) => {
        const view = read.has(n.id) ? { ...n, read: true } : n;
        return (
          <li key={n.id}>
            <NotificationLink
              n={view}
              onOpen={() => {
                if (view.read) return;
                setRead((s) => new Set(s).add(n.id));
                void markRead({ ids: [n.id] }).catch(() => {});
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** "Mark all read": every notification of the team shown, for this person only. An admin names the team. */
export function MarkAllReadButton({ team }: { team: Team | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await markAllRead(team ? { team } : undefined);
          if (!r.ok) {
            toast(r.message ?? "Couldn't mark them read. Try again.", "fault");
            return;
          }
          toast(r.data.marked === 1 ? "1 notification marked read" : `${r.data.marked} notifications marked read`, "settled");
          router.refresh();
        })
      }
    >
      Mark all read
    </Button>
  );
}
