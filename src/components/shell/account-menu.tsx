"use client";

import { Menu } from "@/components/ui/menu";
import { signOutAction } from "@/server/auth/actions";

export function AccountMenu() {
  return (
    <Menu
      align="end"
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
      items={[{ label: "Sign out", onSelect: () => void signOutAction() }]}
    />
  );
}
