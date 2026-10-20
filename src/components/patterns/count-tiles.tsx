"use client";

import { cn } from "@/lib/cn";
import type { StatusFamily } from "@/lib/status";
import { NavLink } from "@/components/patterns/list-navigation";

/** One count tile: a filter the list can switch on, with how many rows it shows. */
export interface TileDef {
  key: string;
  label: string;
  /** the 12 px line under the number, e.g. "Spare, ready to assign" */
  caption: string;
  /** the status family of the label's dot */
  family: StatusFamily;
  count: number;
  /** where a click goes: the filter on, or (while pressed) off again */
  href: string;
  /** pressed: this tile's filter is the one applied */
  on: boolean;
}

/** The 7 px family dot; closed is hollow, as in StatusDot. */
function FamilyDot({ family }: { family: StatusFamily }) {
  return (
    <span
      aria-hidden
      className="inline-block size-[7px] shrink-0 rounded-full"
      style={
        family === "closed"
          ? { border: "1.5px solid var(--st-closed-ring)" }
          : { background: `var(--st-${family}-dot)` }
      }
    />
  );
}

/**
 * Phase 45 (spec §2.1): a row of clickable count tiles. Each is a link (through the list's shared transition)
 * marked `aria-current="true"` while its filter is on; the row is a `nav` named by `label`. From 1280 px one
 * column per tile (IT has six, Purchasing five, so no empty slot), three from 768 px, two below; every tile in a
 * row is the same height.
 */
export function CountTiles({ tiles, label }: { tiles: TileDef[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3",
        // whole class names, so Tailwind sees both
        tiles.length <= 5 ? "xl:grid-cols-5" : "xl:grid-cols-6",
      )}
    >
      {tiles.map((t) => (
        <NavLink
          key={t.key}
          href={t.href}
          aria-current={t.on ? "true" : undefined}
          className={cn(
            "flex h-full min-w-0 flex-col gap-1 rounded-(--radius-card) border p-4 text-left shadow-card transition-colors duration-(--dur-1)",
            // pressed: the accent border doubled by a ring, the soft fill, and the label and number in accent text
            t.on ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border bg-surface hover:border-border-strong",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.06em]",
              t.on ? "text-accent-soft-text" : "text-fg-muted",
            )}
          >
            <FamilyDot family={t.family} />
            <span className="truncate">{t.label}</span>
          </span>
          <span className={cn("text-[26px] font-semibold leading-8 tabular-nums", t.on ? "text-accent-soft-text" : "text-fg")}>
            {t.count.toLocaleString("en-US")}
          </span>
          <span className="truncate text-[12px] leading-4 text-fg-muted">{t.caption}</span>
        </NavLink>
      ))}
    </nav>
  );
}
