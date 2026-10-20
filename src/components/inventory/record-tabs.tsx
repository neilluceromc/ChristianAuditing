"use client";

import { usePathname } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { cn } from "@/lib/cn";
import { Tabs } from "@/components/ui/tabs";
import { recordTabItems, type RecordTabCounts } from "@/lib/inventory-record";

const BADGE = "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11.5px] font-medium tabular-nums";

/**
 * Phase 30 (spec §4.4): Secrets reads plainly (its page says reads are audited); holds exist for IT only.
 * Phase 47 (spec §4.2a): Notes (thread count, amber while one is unresolved) and Attachments (count) sit after Documents.
 */
export function RecordTabs({ assetId, cls, showSecrets, counts }: { assetId: string; cls: AssetClass; showSecrets: boolean; counts: RecordTabCounts }) {
  const pathname = usePathname();
  const base = `/inventory/${encodeURIComponent(assetId)}`;
  const items = recordTabItems(assetId, { cls, showSecrets, counts }).map((t) => {
    const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
    return {
      href: t.href,
      active,
      label: t.count === undefined ? t.label : (
        <span className="inline-flex items-center gap-2">
          {t.label}
          <span
            className={cn(
              BADGE,
              active
                ? "bg-accent-soft text-accent-soft-text"
                : t.tone === "attention" ? "bg-(--st-attention-bg) text-(--st-attention-text)" : "bg-(--st-neutral-bg) text-(--st-neutral-text)",
            )}
          >
            {t.count.toLocaleString("en-US")}
          </span>
        </span>
      ),
    };
  });
  return <Tabs items={items} label="Record sections" />;
}
