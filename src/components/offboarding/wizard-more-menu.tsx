"use client";
import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";

/** The wizard header's ⋯ (spec §4.2). Export sheet is a route handler: a full navigation. */
export function WizardMoreMenu({ recordHref, reportHref, exportHref }: { recordHref: string; reportHref: string; exportHref: string }) {
  const router = useRouter();
  const items: MenuItem[] = [
    { label: "Employee record", onSelect: () => router.push(recordHref) },
    { label: "Farewell report", onSelect: () => router.push(reportHref) },
    { label: "Export sheet", onSelect: () => window.location.assign(exportHref) },
  ];
  return <Menu align="end" items={items} trigger={(props) => <IconButton {...props} aria-label="More actions">⋯</IconButton>} />;
}
