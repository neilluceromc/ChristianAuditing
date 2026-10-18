import Link from "next/link";
import type { VisibleSection } from "@/lib/workspaces";

/** Spec §4.6: the top-level links except Home, up to 10 (views stay in the sidebar). */
export function JumpTo({ sections }: { sections: VisibleSection[] }) {
  const links = sections.flatMap((s) => s.items).filter((i) => i.href !== "/").slice(0, 10);
  return (
    <div className="grid grid-cols-2 gap-1">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-(--radius-ctl) px-2.5 py-1.5 text-[12.5px] text-fg-secondary hover:bg-surface-subtle hover:text-fg"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
