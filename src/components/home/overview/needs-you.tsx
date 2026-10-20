import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import type { NeedItem } from "@/lib/overview";
import { Panel } from "./panel";

const TONE: Record<NeedItem["tone"], { box: string; word: string }> = {
  bad: { box: "bg-[color:var(--st-fault-bg)] text-[color:var(--st-fault-text)]", word: "Urgent" },
  warn: { box: "bg-[color:var(--st-attention-bg)] text-[color:var(--st-attention-text)]", word: "Needs attention" },
  info: { box: "bg-[color:var(--st-inflight-bg)] text-[color:var(--st-inflight-text)]", word: "To do" },
};

/** The most items "Needs you" lists; the rest are behind "See all". */
export const NEEDS_MAX = 6;

/**
 * Spec §3.1 Row A: up to 6 items, most urgent first, each an icon, a title, a meta line and one action link, with
 * "See all →" to the workspace's full queue. The tone tint is never alone: the icon box carries the tone as a word
 * (visually hidden, and the box's tooltip), and an urgent item's action is the filled button. Each action names its
 * item for a screen reader, so six "Open" links stay distinguishable.
 */
export function NeedsYou({ items, href, className }: { items: NeedItem[]; href: string; className?: string }) {
  const shown = items.slice(0, NEEDS_MAX);
  const urgent = shown.filter((i) => i.tone === "bad").length;
  return (
    <Panel
      title="Needs you"
      sub={urgent ? `${urgent} urgent` : undefined}
      className={className}
      action={
        <Link href={href} className="text-[12.5px] font-medium text-accent hover:underline">
          See all <span aria-hidden="true">→</span>
        </Link>
      }
    >
      {shown.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-muted">Nothing needs you right now.</p>
      ) : (
        <ul className="flex flex-col" data-needs-you="">
          {shown.map((item, i) => (
            <li
              key={`${item.href}-${i}`}
              className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border-faint py-2.5 first:border-t-0"
              data-tone={item.tone}
            >
              <span className={cn("grid size-[30px] place-items-center rounded-[8px]", TONE[item.tone].box)} title={TONE[item.tone].word}>
                <Icon name={item.icon} size={16} />
                <span className="sr-only">{TONE[item.tone].word}: </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-fg">{item.title}</span>
                <span className="block truncate text-[12px] text-fg-muted">{item.meta}</span>
              </span>
              <ButtonLink href={item.href} size="sm" variant={item.tone === "bad" ? "primary" : "secondary"}>
                {item.action}
                <span className="sr-only">: {item.title}</span>
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
