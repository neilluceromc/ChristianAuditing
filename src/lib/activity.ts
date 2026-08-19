/**
 * One row = one subject-first sentence (README 4b). The entityLabel is
 * enriched server-side (asset tag / employee name); the sentence never
 * exposes raw ids.
 */
export interface ActivityEntryLike {
  actorLabel: string;
  action: string;
  diff: unknown;
  entityLabel: string;
}

export function auditSentence(entry: ActivityEntryLike): string {
  const diff = (entry.diff ?? null) as Record<string, { from: unknown; to: unknown }> | null;
  switch (entry.action) {
    case "create":
      return `${entry.actorLabel} created ${entry.entityLabel}`;
    case "update": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return `${entry.actorLabel} updated ${fields} on ${entry.entityLabel}`;
    }
    case "SECRET_READ": {
      const label = diff?.label?.to;
      return `${entry.actorLabel} revealed the secret "${String(label ?? "?")}" on ${entry.entityLabel}`;
    }
    case "approval.requested": {
      const ref = diff?.approval?.to;
      return `${entry.actorLabel} requested ${String(ref ?? "an approval")} on ${entry.entityLabel}`;
    }
    case "submit":
      return `${entry.actorLabel} submitted ${entry.entityLabel} for IT review`;
    case "it-review":
      return `${entry.actorLabel} marked ${entry.entityLabel} IT-reviewed`;
    case "it-reject":
      return `${entry.actorLabel} sent ${entry.entityLabel} back to purchasing`;
    case "request-info":
      return `${entry.actorLabel} sent ${entry.entityLabel} back for more information`;
    case "cancel":
      return `${entry.actorLabel} cancelled ${entry.entityLabel}`;
    case "complete":
      return `${entry.actorLabel} completed ${entry.entityLabel}`;
    case "offboarding.completed": {
      const items = diff?.decisions?.to;
      const n = Array.isArray(items) ? items.length : 0;
      return `${entry.actorLabel} completed offboarding for ${entry.entityLabel}${n ? ` · ${n} item${n === 1 ? "" : "s"} settled` : ""}`;
    }
    case "comment":
      return `${entry.actorLabel} commented on ${entry.entityLabel}`;
    case "unit-update":
      return `${entry.actorLabel} updated a unit on ${entry.entityLabel}`;
    case "delete": {
      // Entry criterion #6: a deleted policy can never be resolved from the
      // database again, so the label has to come out of the diff, not a lookup.
      const name = diff?.name?.from;
      return `${entry.actorLabel} deleted ${String(name ?? entry.entityLabel)}`;
    }
    case "policy.slot.added":
    case "policy.slot.removed":
    case "policy.slot.changed": {
      // Entry criterion #6: the diff carries BOTH slot lists precisely so the
      // sentence can name what changed, not just that "something" did.
      const before = Array.isArray(diff?.slots?.from) ? (diff.slots.from as string[]) : [];
      const after = Array.isArray(diff?.slots?.to) ? (diff.slots.to as string[]) : [];
      const added = after.filter((s) => !before.includes(s));
      const removed = before.filter((s) => !after.includes(s));
      const slotName = (row: string) => row.split(" · ")[0];

      if (entry.action === "policy.slot.added") {
        return added[0]
          ? `${entry.actorLabel} added the "${slotName(added[0])}" slot to ${entry.entityLabel}`
          : `${entry.actorLabel} added a slot to ${entry.entityLabel}`;
      }
      if (entry.action === "policy.slot.removed") {
        return removed[0]
          ? `${entry.actorLabel} removed the "${slotName(removed[0])}" slot from ${entry.entityLabel}`
          : `${entry.actorLabel} removed a slot from ${entry.entityLabel}`;
      }
      const changed = added[0] ?? removed[0];
      return changed
        ? `${entry.actorLabel} changed the "${slotName(changed)}" slot on ${entry.entityLabel}`
        : `${entry.actorLabel} changed a slot on ${entry.entityLabel}`;
    }
    default:
      return `${entry.actorLabel} ${entry.action} ${entry.entityLabel}`;
  }
}
