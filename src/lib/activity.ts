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
    // Phase 12's asset actions. Left to the default they rendered the
    // raw verb — "J. Sarmiento finance.return BR-LT-0148" — which is not a
    // sentence and buries the one thing a reader of the feed wants.
    case "register":
      return `${entry.actorLabel} registered ${entry.entityLabel}`;
    case "finance.confirm":
      return `${entry.actorLabel} confirmed ${entry.entityLabel}'s details`;
    case "it.verify":
      return `${entry.actorLabel} checked ${entry.entityLabel}`;
    case "finance.return": {
      // The reason is the entire point of a return, so it belongs in the
      // sentence rather than one click away in the diff.
      const why = diff?.financeReturn?.to;
      return `${entry.actorLabel} sent ${entry.entityLabel} back to IT${why ? ` \u00b7 ${String(why)}` : ""}`;
    }
    case "finance.resubmit":
      return `${entry.actorLabel} marked ${entry.entityLabel} corrected for Finance`;
    case "offboarding.completed": {
      const items = diff?.decisions?.to;
      const n = Array.isArray(items) ? items.length : 0;
      return `${entry.actorLabel} completed offboarding for ${entry.entityLabel}${n ? ` · ${n} item${n === 1 ? "" : "s"} settled` : ""}`;
    }
    // Phase 15: direct IT lifecycle changes. Subject-first, no refNo — the
    // approval row exists (already EXECUTED) but the sentence is about the asset.
    case "lifecycle.assign":
      return `${entry.actorLabel} assigned ${entry.entityLabel} to ${String(diff?.assignee?.to ?? "someone")}`;
    case "lifecycle.return": {
      const to = diff?.status?.to;
      return diff?.returnedAt?.to
        ? `${entry.actorLabel} returned ${entry.entityLabel} for triage`
        : `${entry.actorLabel} returned ${entry.entityLabel} as ${String(to ?? "?")}`;
    }
    case "lifecycle.change-status":
      return `${entry.actorLabel} changed ${entry.entityLabel} to ${String(diff?.status?.to ?? "?")}`;
    case "lifecycle.replace":
      return diff?.replacedBy
        ? `${entry.actorLabel} replaced ${entry.entityLabel} with ${String(diff.replacedBy.to)}`
        : `${entry.actorLabel} put ${entry.entityLabel} in place of ${String(diff?.replaces?.to ?? "?")} for ${String(diff?.assignee?.to ?? "someone")}`;
    case "lifecycle.triage":
      return `${entry.actorLabel} triaged ${entry.entityLabel}: ${String(diff?.triage?.to ?? "?")}`;
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
      //
      // Task 12: scope decision 15 is the employee analogue of scope
      // decision 13 — an import can create an employee already OFFBOARDING
      // or OFFBOARDED — so `employment` gets the identical treatment as
      // `status`, checked second since the two diffs are mutually exclusive
      // (one entityType writes `status`, the other writes `employment`,
      // never both). Verified rather than assumed this case was already
      // entity-agnostic (the draft's own instruction): it was NOT — before
      // this, an employee import-create's diff carried `employment` but
      // this sentence only ever looked at `status`, so a person created
      // already mid-offboarding read identically to an ordinary ACTIVE
      // hire, the exact gap A-5 closed for assets and reopened here.
      const status = diff?.status?.to;
      const employment = diff?.employment?.to;
      const suffix =
        typeof status === "string" && status !== "SPARE" ? ` as ${status}`
        : typeof employment === "string" && employment !== "ACTIVE" ? ` as ${employment}`
        : "";
      return `${entry.actorLabel} imported ${entry.entityLabel}${suffix}`;
    }
    case "import-update": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return `${entry.actorLabel} updated ${fields} on ${entry.entityLabel} by import`;
    }
    // Phase 19 (M-3): the twelve stock/stocktake actions this module writes
    // (`item-actions.ts`, `movement-actions.ts`, `stocktake-actions.ts`) all
    // fell to the `default` branch and rendered as a raw verb — exactly the
    // non-sentence rule 16's own Phase 12 fix (above) already corrected once
    // for assets. `entityLabels` already resolves `stock-item`/`stocktake`/
    // `stock-category` to a human label (`code · name` / refNo / name), so
    // every case below only supplies the verb and, where the diff carries
    // one, the quantity/department/reason that makes the row worth reading
    // without opening the diff.
    case "stock.item.created":
      return `${entry.actorLabel} created ${entry.entityLabel}`;
    case "stock.item.updated": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return `${entry.actorLabel} updated ${fields} on ${entry.entityLabel}`;
    }
    case "stock.item.archived":
      return `${entry.actorLabel} archived ${entry.entityLabel}`;
    case "stock.item.restored":
      return `${entry.actorLabel} restored ${entry.entityLabel}`;
    case "stock.category.created":
      return `${entry.actorLabel} created the category ${entry.entityLabel}`;
    case "stock.category.updated": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return `${entry.actorLabel} updated ${fields} on the category ${entry.entityLabel}`;
    }
    case "stock.category.archived":
      return `${entry.actorLabel} archived the category ${entry.entityLabel}`;
    case "stock.category.restored":
      return `${entry.actorLabel} restored the category ${entry.entityLabel}`;
    case "stock.received": {
      const qty = diff?.quantity?.to;
      return `${entry.actorLabel} received ${typeof qty === "number" ? qty : "stock"} of ${entry.entityLabel}`;
    }
    case "stock.issued": {
      // `movement-actions.ts` records the balance before/after, not the
      // issued quantity itself, so the sentence recovers it as their
      // difference — the same number the over-issue refusal would have
      // named had this issue been refused instead.
      const from = diff?.quantity?.from;
      const to = diff?.quantity?.to;
      const qty = typeof from === "number" && typeof to === "number" ? from - to : null;
      const dept = diff?.department?.to;
      return `${entry.actorLabel} issued ${qty ?? "stock"} of ${entry.entityLabel}${typeof dept === "string" ? ` to ${dept}` : ""}`;
    }
    case "stock.adjusted": {
      const from = diff?.balance?.from;
      const to = diff?.balance?.to;
      const delta = typeof from === "number" && typeof to === "number" ? to - from : null;
      // Real minus (U+2212), never a hyphen-minus — the same convention
      // `stocktake-review.tsx`'s `fmtVariance` uses for a negative.
      const deltaStr = delta === null ? "an amount" : delta >= 0 ? `+${delta}` : `−${Math.abs(delta)}`;
      const reason = diff?.reason?.to;
      return `${entry.actorLabel} adjusted ${entry.entityLabel} by ${deltaStr}${typeof reason === "string" ? ` · ${reason}` : ""}`;
    }
    case "stocktake.opened": {
      const scope = diff?.scope?.to;
      const lines = diff?.lines?.to;
      const lineSuffix = typeof lines === "number" ? ` · ${lines} item${lines === 1 ? "" : "s"}` : "";
      return `${entry.actorLabel} opened ${entry.entityLabel} for ${typeof scope === "string" ? scope : "all categories"}${lineSuffix}`;
    }
    case "stocktake.posted": {
      const adjusted = diff?.adjusted?.to;
      const skipped = diff?.skipped?.to;
      return `${entry.actorLabel} posted ${entry.entityLabel} · ${typeof adjusted === "number" ? adjusted : 0} adjusted, ${typeof skipped === "number" ? skipped : 0} not counted`;
    }
    case "stocktake.cancelled":
      return `${entry.actorLabel} cancelled the stocktake ${entry.entityLabel}`;
    default:
      return `${entry.actorLabel} ${entry.action} ${entry.entityLabel}`;
  }
}
