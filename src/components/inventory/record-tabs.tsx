"use client";

import { usePathname } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Tabs } from "@/components/ui/tabs";

/** Phase 30 (spec §4.4): Secrets reads plainly (its page says reads are audited); holds exist for IT only. */
export function RecordTabs({ assetId, cls, showSecrets }: { assetId: string; cls: AssetClass; showSecrets: boolean }) {
  const pathname = usePathname();
  const base = `/inventory/${assetId}`;
  const items = [
    { label: "Overview", href: base },
    { label: "History", href: `${base}/history` },
    { label: "Timeline", href: `${base}/timeline` },
    { label: "Documents", href: `${base}/documents` },
    ...(showSecrets ? [{ label: "Secrets", href: `${base}/secrets` }] : []),
    ...(cls === "IT" ? [{ label: "Reservations", href: `${base}/reservations` }] : []),
  ].map((t) => ({ ...t, active: t.href === base ? pathname === base : pathname.startsWith(t.href) }));
  return <Tabs items={items} label="Record sections" />;
}
