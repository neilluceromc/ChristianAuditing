"use client";

import { useRouter } from "next/navigation";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { signOutAction } from "@/server/auth/actions";
import { useSidebar } from "./sidebar-collapse";

/** `crisSettings`: the role has Cris (admin, it_staff), so the menu offers Settings › Cris (spec §9). */
export function AccountMenu({ crisSettings = false }: { crisSettings?: boolean }) {
  const router = useRouter();
  // In the 72 px rail the trigger sits near the window's left edge: open rightwards so the menu stays on screen.
  const rail = useSidebar()?.state === "rail";
  const items: MenuItem[] = [
    ...(crisSettings ? [{ label: "Cris settings", onSelect: () => router.push("/settings/cris") }] : []),
    { label: "Sign out", onSelect: () => void signOutAction() },
  ];
  return (
    <Menu
      align={rail ? "start" : "end"}
      trigger={(p) => (
        <button
          {...p}
          type="button"
          aria-label="Account menu"
          className="rounded-(--radius-ctl) px-1.5 py-0.5 text-fg-muted hover:bg-surface-subtle"
        >
          ⋯
        </button>
      )}
      items={items}
    />
  );
}
