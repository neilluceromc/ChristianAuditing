// src/components/shell/command-palette.tsx — stub, Task 12 replaces
"use client";

import type { Role } from "@prisma/client";
import type { NavSection } from "@/lib/workspaces";

export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      className="hidden h-[34px] w-[320px] items-center gap-2 rounded-(--radius-btn) border border-border bg-canvas px-3 text-left text-xs text-fg-muted hover:border-border-strong md:flex"
    >
      Search…
    </button>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Task 12 wires these up
export function CommandPalette(_props: { role: Role; sections: NavSection[] }) {
  return null;
}
