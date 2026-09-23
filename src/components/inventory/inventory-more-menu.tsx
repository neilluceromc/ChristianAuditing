"use client";

import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";

/**
 * Phase 30 (spec §6.1): Register assets is the list header's one primary; Import and Export sit
 * behind this menu (the Phase 29 EmployeesMoreMenu shape). Export targets a route handler that
 * streams a file, so it navigates with window.location.assign, not router.push. `importHref` is
 * null for a role or a view with no importer — the item is absent, not disabled.
 */
export function InventoryMoreMenu({
  importHref,
  exportHref,
}: {
  importHref: string | null;
  exportHref: string;
}) {
  const router = useRouter();

  const items: MenuItem[] = [];
  if (importHref) items.push({ label: "Import…", onSelect: () => router.push(importHref) });
  items.push({ label: "Export", onSelect: () => window.location.assign(exportHref) });

  return (
    <Menu
      align="end"
      items={items}
      trigger={(props) => <IconButton {...props} aria-label="More actions">⋯</IconButton>}
    />
  );
}
