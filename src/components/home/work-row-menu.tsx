"use client";

import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { dismissShiftRow, undismissShiftRow } from "@/server/modules/home/actions";
import type { WorkRow } from "@/lib/worklist";

/** Spec §5.2: Open record / Open profile / Hide until tomorrow — replacing the ✓ that looked like "done". */
export function WorkRowMenu({ row }: { row: WorkRow }) {
  const router = useRouter();
  const toast = useToast();
  const entity = row.entity;

  async function undo() {
    const res = await undismissShiftRow({ key: row.key });
    if (!res.ok) { toast(res.message, "fault"); return; }
    router.refresh();
  }

  const items: MenuItem[] = [];
  if (entity?.kind === "asset") items.push({ label: "Open record", onSelect: () => router.push(`/inventory/${entity.id}`) });
  if (entity?.kind === "employee") items.push({ label: "Open profile", onSelect: () => router.push(`/employees/${entity.id}`) });
  items.push({
    label: "Hide until tomorrow",
    onSelect: async () => {
      const res = await dismissShiftRow({ key: row.key });
      // A rate-limited refusal carries the RateLimitNotice copy in its message.
      if (!res.ok) { toast(res.message, "fault"); return; }
      router.refresh();
      toast("Hidden until tomorrow", "neutral", { label: "Undo", onAction: () => void undo() });
    },
  });
  const name = entity?.label ?? row.title;
  return (
    // A worklist row has no click of its own, so the menu needs no stopPropagation cell.
    <span className="shrink-0">
      <Menu align="end" items={items} trigger={(p) => <IconButton {...p} aria-label={`Actions for ${name}`}>⋯</IconButton>} />
    </span>
  );
}
