// src/components/shell/workspace-switcher.tsx — placeholder, Task 10 replaces
import type { WorkspaceId } from "@/lib/workspaces";

export function WorkspaceSwitcher({
  current,
  meta,
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
  meta: Record<WorkspaceId, { label: string; landing: string }>;
}) {
  return (
    <div className="mx-3 mb-2 rounded-(--radius-btn) border border-border px-2.5 py-2">
      <p className="text-[12.5px] font-semibold text-fg">{meta[current].label}</p>
    </div>
  );
}
