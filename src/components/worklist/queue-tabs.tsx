"use client";

import { cn } from "@/lib/cn";
import { workHref, type QueueTab } from "@/lib/worklist-view";
import type { WorkSectionId } from "@/lib/worklist";

/**
 * The queue tabs (plan call 9, Global Constraints): links — each one is a URL, the open one `aria-current="page"` —
 * 44 px tall, with the queue's count ("50+" when capped). A plain click switches in place (every queue is already
 * read); a middle or modified click opens the URL. Below 640 px the row scrolls sideways in its own box.
 */
export function QueueTabs({ tabs, onPick }: { tabs: QueueTab[]; onPick: (id: WorkSectionId) => void }) {
  return (
    <nav aria-label="Queues" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <a
          key={t.id}
          href={workHref(t.id, 1, null)}
          aria-current={t.on ? "page" : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onPick(t.id);
          }}
          className={cn(
            "relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-[13.5px] transition-colors duration-(--dur-1)",
            // the row is a scroll box, which would clip an outset ring: draw it inside
            "focus-visible:outline-offset-[-2px]",
            t.on ? "font-semibold text-fg" : "font-medium text-fg-muted hover:text-fg-secondary",
          )}
        >
          {t.label}
          <span
            className={cn(
              "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11.5px] font-medium tabular-nums",
              t.fault ? "bg-(--st-fault-bg) text-(--st-fault-text)"
                : t.on ? "bg-accent-soft text-accent-soft-text" : "bg-(--st-neutral-bg) text-(--st-neutral-text)",
            )}
          >
            {t.count}
          </span>
          {t.on && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" />}
        </a>
      ))}
    </nav>
  );
}
