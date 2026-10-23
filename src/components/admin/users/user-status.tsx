import { cn } from "@/lib/cn";
import { USER_STATUS_LABEL, type UserStatus } from "@/lib/admin-users";
import type { StatusFamily } from "@/lib/status";

/**
 * Users & access (spec §4.4): each status's dot. Waiting for approval is the one that asks for something (attention);
 * Disabled and Declined stay neutral — a turned-off account is a decision, not a fault — Declined with the hollow
 * "closed" ring.
 */
const DOT: Record<UserStatus, StatusFamily> = {
  PENDING: "attention",
  ACTIVE: "settled",
  MUST_SET_PASSWORD: "inflight",
  DISABLED: "neutral",
  DECLINED: "closed",
};

/** A status as a dot plus its words (never colour alone). */
export function UserStatusLabel({ status, className }: { status: UserStatus; className?: string }) {
  const family = DOT[status];
  return (
    <span
      data-user-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        status === "DISABLED" || status === "DECLINED" ? "text-fg-muted" : status === "PENDING" ? undefined : "text-fg-secondary",
        className,
      )}
      style={status === "PENDING" ? { color: "var(--st-attention-text)" } : undefined}
    >
      <span
        aria-hidden
        data-status-dot=""
        className="inline-block size-[7px] shrink-0 rounded-full"
        style={
          family === "closed"
            ? { border: "1.5px solid var(--st-closed-ring)" }
            : { background: `var(--st-${family}-dot)` }
        }
      />
      {USER_STATUS_LABEL[status]}
    </span>
  );
}
