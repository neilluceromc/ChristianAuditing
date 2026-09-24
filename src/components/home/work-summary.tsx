import Link from "next/link";
import { cn } from "@/lib/cn";
import { pastSlaCount, summaryChips, type WorkGroup } from "@/lib/worklist";

const CHIP = "rounded-full border px-2.5 py-1 text-[11.5px] font-medium hover:underline";

/** Spec §5.2: one chip per non-empty section, jumping to its anchor, plus a past-SLA chip in the accent tone. */
export function WorkSummary({ groups }: { groups: WorkGroup[] }) {
  const chips = summaryChips(groups);
  const pastSla = pastSlaCount(groups);
  if (chips.length === 0 && pastSla === 0) return null;
  return (
    <nav aria-label="Worklist sections" className="mb-5">
      <ul className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <li key={c.id}>
            <Link href={c.href} className={cn(CHIP, "border-border-strong bg-surface text-fg-secondary")}>{c.label}</Link>
          </li>
        ))}
        {pastSla > 0 && (
          <li>
            <Link href="#queue" className={cn(CHIP, "border-accent text-accent")}>{pastSla} past SLA</Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
