import Link from "next/link";
import type { AssetClass, AssetStatus } from "@prisma/client";
import { cn } from "@/lib/cn";
import { FIN_FILTERS, FIN_LABEL, type FinFilter } from "@/lib/registration";

/** Phase 35 (spec 4.1): Finance's registration-state chips. They keep cls, q and status; changing chip drops the page. */
export function FinChips({
  chips, current, cls, q, status,
}: {
  chips: Record<FinFilter | "all", number>;
  current: FinFilter | null;
  cls: AssetClass;
  q: string;
  status: AssetStatus | null;
}) {
  const hrefFor = (f: FinFilter | null) => {
    const next = new URLSearchParams();
    if (cls === "PURCHASING") next.set("cls", "PURCHASING");
    if (status) next.set("status", status);
    if (q) next.set("q", q);
    if (f) next.set("fin", f);
    const qs = next.toString();
    return qs ? `/finance/assets?${qs}` : "/finance/assets";
  };
  const items: Array<{ key: FinFilter | "all"; label: string; value: FinFilter | null }> = [
    { key: "all", label: "All", value: null },
    ...FIN_FILTERS.map((f) => ({ key: f, label: FIN_LABEL[f], value: f })),
  ];
  return (
    <nav aria-label="Finance state" className="flex flex-wrap items-center gap-1.5">
      {items.map((it) => {
        const active = current === it.value;
        return (
          <Link
            key={it.key}
            href={hrefFor(it.value)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
              active
                ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
            )}
          >
            {it.label} {chips[it.key]}
          </Link>
        );
      })}
    </nav>
  );
}
