import Link from "next/link";
import { usersListHref } from "@/lib/admin-lists";
import { waitingChip } from "@/lib/admin-users";

/**
 * Users & access (spec §4.4): "Waiting for approval · N" above the list while any sign-ups wait; it opens that
 * filter. Nothing at all when none wait.
 */
export function WaitingChip({ count, active }: { count: number; active: boolean }) {
  if (count <= 0) return null;
  return (
    <Link
      href={usersListHref({ status: "PENDING" })}
      aria-current={active ? "true" : undefined}
      data-waiting-chip=""
      className="inline-flex min-h-[32px] items-center gap-2 self-start rounded-full border px-3 text-[12.5px] font-medium hover:opacity-90"
      style={{
        background: "var(--st-attention-bg)",
        borderColor: "var(--st-attention-border)",
        color: "var(--st-attention-text)",
      }}
    >
      <span aria-hidden className="inline-block size-[7px] rounded-full" style={{ background: "var(--st-attention-dot)" }} />
      {waitingChip(count)}
    </Link>
  );
}
