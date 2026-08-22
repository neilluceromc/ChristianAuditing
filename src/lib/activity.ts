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
    case "import-create": {
      // I-6 (Task 10 round two): A-5's whole point was that the diff can
      // answer "how did this asset reach DEPLOYED without an approval?" —
      // scope decision 13 lets an import create an asset already deployed
      // to a holder, the one surface in this app that can. Recording
      // `status` in the diff (A-5) and never showing it here left that
      // question unanswerable on the one feed most people read: this
      // sentence used to be identical for an imported SPARE and an
      // imported-and-already-DEPLOYED asset. Named only when it ISN'T the
      // ordinary SPARE outcome, so the common case stays a plain sentence.
      const status = diff?.status?.to;
      const suffix = typeof status === "string" && status !== "SPARE" ? ` as ${status}` : "";
      return `${entry.actorLabel} imported ${entry.entityLabel}${suffix}`;
    }
    case "import-update": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return `${entry.actorLabel} updated ${fields} on ${entry.entityLabel} by import`;
    }
    default:
      return `${entry.actorLabel} ${entry.action} ${entry.entityLabel}`;
  }
}
