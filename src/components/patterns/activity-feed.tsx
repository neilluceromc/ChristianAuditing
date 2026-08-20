import { Avatar } from "@/components/ui/avatar";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";

export interface ActivityItem {
  id: string;
  sentence: string;
  /** relative or absolute display time, preformatted */
  when: string;
  actor: string;
  /** any status value for the trailing dot */
  dotValue: string;
  /** rendered ONLY on cross-domain feeds (Home, Phase 6) — scoped logs pass undefined */
  domain?: string;
}

/** One renderer for all five activity routes — the domain pill is the only variance (README 4b). */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <ol className="flex flex-col rounded-(--radius-card) border border-border bg-surface shadow-card">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2.5 border-b border-border-faint px-3 py-2.5 last:border-b-0">
          <Avatar name={item.actor} size="sm" />
          {item.domain && <Pill>{item.domain}</Pill>}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-secondary">{item.sentence}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-fg-muted">{item.when}</span>
          <StatusDot value={item.dotValue} />
        </li>
      ))}
    </ol>
  );
}

/** Status-dot family for a feed row, derived from the action. */
export function actionDot(action: string): string {
  if (action === "SECRET_READ") return "TEMPORARY"; // attention
  if (action === "it-reject" || action === "request-info") return "PENDING"; // attention: it came back
  if (action === "cancel") return "CANCELLED"; // closed
  if (action === "complete" || action === "offboarding.completed") return "COMPLETED"; // settled
  if (action === "submit" || action === "it-review") return "SUBMITTED"; // inflight
  // "disable" (entityType "user") is unreachable today: every actionDot caller
  // scopes to employee/asset/purchase-request, and /audit — the one page that
  // renders "user" entries — never calls this. Pre-wired for a user-scoped
  // feed Task 11 may add; not dead by mistake. "delete" already has several
  // producers that never reach this function either (asset-category,
  // asset-type, department via reference-actions.ts) — worth knowing before
  // treating either bare verb as owned by one entity type. webhook-endpoint
  // deliberately does NOT write "disable"/"enable"/"delete": it writes
  // "endpoint-disable"/"endpoint-enable"/"endpoint-delete" specifically so it
  // doesn't become one more producer sharing this line's meaning by accident.
  if (action.includes("failed") || action === "delete" || action === "disable") return "DEFECTIVE"; // fault
  if (action === "create" || action.includes("executed")) return "DEPLOYED"; // settled
  if (action.includes("requested") || action === "claim") return "SUBMITTED"; // inflight
  return "SPARE"; // neutral
}
