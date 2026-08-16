"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Pill } from "@/components/ui/pill";

export function RecordTabs({ assetId }: { assetId: string }) {
  const pathname = usePathname();
  const base = `/inventory/${assetId}`;
  const items = [
    { label: "Overview" as React.ReactNode, href: base },
    { label: "History" as React.ReactNode, href: `${base}/history` },
    { label: "Timeline" as React.ReactNode, href: `${base}/timeline` },
    { label: "Documents" as React.ReactNode, href: `${base}/documents` },
    {
      label: (
        <span className="inline-flex items-center gap-1.5">
          Secrets <Pill>AUDITED</Pill>
        </span>
      ) as React.ReactNode,
      href: `${base}/secrets`,
    },
    { label: "Reservations" as React.ReactNode, href: `${base}/reservations` },
  ].map((t) => ({ ...t, active: t.href === base ? pathname === base : pathname.startsWith(t.href) }));
  return <Tabs items={items} />;
}
