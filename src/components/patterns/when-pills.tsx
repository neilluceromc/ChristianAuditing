"use client";

import { cn } from "@/lib/cn";
import { WHEN_LABEL, WHEN_VALUES } from "@/lib/audit-list";
import { NavLink } from "@/components/patterns/list-navigation";

/**
 * Spec §6.2 (plan P-15): the When facet — one choice of `Today` / `Last 7 days` / `Last 30 days`,
 * stored as `?when=`. The `ClosedViaChips` shape: a labelled group of links, the active one marked
 * `aria-current`; a second click on the active one clears it. Links go through the list's shared
 * transition (`NavLink`), so the list reads busy while the next view renders.
 */
export function WhenPills({ value, hrefFor }: {
  value: string | undefined;
  /** the list's URL with `when` set to this value, or cleared for `undefined` */
  hrefFor: (when: string | undefined) => string;
}) {
  const pillClass = (on: boolean) =>
    cn(
      "inline-flex items-center rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
      on
        ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
        : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
    );

  return (
    <div role="group" aria-label="When" className="flex flex-wrap items-center gap-1.5">
      {WHEN_VALUES.map((v) => {
        const on = v === value;
        return (
          <NavLink key={v} href={hrefFor(on ? undefined : v)} aria-current={on ? "true" : undefined} className={pillClass(on)}>
            {WHEN_LABEL[v]}
          </NavLink>
        );
      })}
    </div>
  );
}
