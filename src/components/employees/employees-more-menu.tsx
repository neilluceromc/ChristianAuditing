"use client";

import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";

/**
 * Phase 29 (spec §8): with New employee the list header's one primary,
 * Import and Export collapse behind this menu. Export targets a route
 * handler that streams a file, so it navigates with window.location.assign,
 * not router.push (ruling R5). The trigger's "More" name is deliberately
 * distinct from the profile header's "More actions" (ProfileActions).
 */
export function EmployeesMoreMenu({
  exportHref,
  canMutate,
}: {
  exportHref: string;
  canMutate: boolean;
}) {
  const router = useRouter();

  const items: MenuItem[] = [];
  if (canMutate) items.push({ label: "Import…", onSelect: () => router.push("/employees/import") });
  items.push({ label: "Export", onSelect: () => window.location.assign(exportHref) });

  return (
    <Menu
      align="end"
      items={items}
      trigger={(props) => <IconButton {...props} aria-label="More">⋯</IconButton>}
    />
  );
}
