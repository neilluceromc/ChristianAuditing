"use client";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";

/** The queue header's ⋯ (spec §4.1): Export is a route handler, so it is a full navigation. */
export function OffboardingMoreMenu({ exportHref }: { exportHref: string }) {
  const items: MenuItem[] = [{ label: "Export", onSelect: () => window.location.assign(exportHref) }];
  return <Menu align="end" items={items} trigger={(props) => <IconButton {...props} aria-label="More actions">⋯</IconButton>} />;
}
