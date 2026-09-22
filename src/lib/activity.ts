import { fmtDate } from "./format";

/** Phase 27 (spec §3.5): the facet's words for each action a feed can show; an unmapped action shows its raw name. */
export const ACTION_LABELS: Record<string, string> = {
  create: "Created", update: "Updated", register: "Registered",
  "import-create": "Imported (new)", "import-update": "Imported (update)",
  "lifecycle.assign": "Assigned", "lifecycle.return": "Returned", "lifecycle.change-status": "Status changed",
  "lifecycle.replace": "Replaced", "lifecycle.triage": "Triaged", "loan.due-changed": "Loan due date changed",
  "reservation.placed": "Hold placed", "reservation.released": "Hold released",
  "document.uploaded": "Document attached", "document.signed": "Document signed",
  "secret.created": "Secret added", SECRET_READ: "Secret read",
  "approval.requested": "Change requested", comment: "Comment", "unit-update": "Units updated",
  submit: "Submitted", "it-review": "IT review", "it-reject": "Returned by IT", "request-info": "Info requested",
  cancel: "Cancelled", complete: "Completed", "finance.confirm": "Finance confirmed", "it.verify": "IT verified",
  "finance.return": "Returned by Finance", "finance.resubmit": "Resubmitted", "supplier-set": "Supplier set",
  "employee.transferred": "Transferred", "offboarding.completed": "Offboarding completed",
  "acknowledgement.recorded": "Acknowledgement signed",
  "policy.exception.added": "Exception added", "policy.exception.waived": "Exception waived", "policy.exception.removed": "Exception removed",
};
export function actionLabel(action: string): string { return ACTION_LABELS[action] ?? action; }

/** Phase 27 (spec §3.5): raw diff keys → words, shared by the `update` and `import-update` sentences. */
export const FIELD_LABELS: Record<string, string> = {
  name: "name", model: "model", serial: "serial", cost: "cost", location: "location", notes: "notes",
  categoryId: "category", typeId: "type", departmentId: "department", assigneeId: "holder", vendorId: "supplier",
  purchasedAt: "purchase date", warrantyUntil: "warranty end", loanDueAt: "loan due date",
  employeeNo: "employee number", email: "email", title: "title", employment: "employment", joinedAt: "join date",
  offboardingAt: "offboarding start", offboardingDueAt: "complete-by date",
  registeredName: "registered name", contactPerson: "contact person", phone: "phone", address: "address",
  registrationNo: "registration number", contractStatus: "contract status", contractStart: "contract start", contractEnd: "contract end",
  unit: "unit", packSize: "pack size", reorderLevel: "reorder level", expiresAt: "expiry",
};
/** Known keys read from the table; unknown ones lose a trailing "Id" and split camelCase: "repairEndedAt" → "repair ended at". */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

const fieldList = (diff: Record<string, unknown> | null) => (diff ? Object.keys(diff).map(fieldLabel).join(", ") : "fields");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Phase 22 Task 2 (spec §2.3/§4.3): the three document kinds a
 * `StockLotDocument` can carry, worded as the indefinite-article noun phrase
 * `stock.document-added`'s sentence names — "a delivery receipt" reads as a
 * sentence; "delivery-receipt" does not. Kept local rather than derived from
 * `LOT_DOCUMENT_KINDS` (`stock-schema.ts`): that array is the identity list
 * (what a kind IS), this is prose (what a kind is CALLED in a sentence), and
 * the two have never been the same shape anywhere else in this file either
 * (`REQUEST_DOCUMENT_LABEL` etc. are themselves separate from
 * `REQUEST_DOCUMENT_KINDS` for the same reason).
 */
const LOT_DOCUMENT_ARTICLE_LABEL: Record<string, string> = {
  "delivery-receipt": "a delivery receipt",
  invoice: "an invoice",
  other: "a document",
};

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
    case "update":
      return `${entry.actorLabel} updated ${fieldList(diff)} on ${entry.entityLabel}`;
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
    // Phase 20 (R5, ruling on Task 3's report): transferEmployee writes
    // `diff: { department: { from, to }, title: { from, to }, effectiveAt: {
    // from: null, to } }` (transfer-actions.ts) — without this case the raw
    // activity feed and the audit page rendered the bare verb
    // ("J. Sarmiento employee.transferred Dennis Ong") via the default
    // fallback below. The Transfers card / timeline line stay their own
    // bespoke sentence built straight off `EmployeeTransfer` fields (spec
    // §3) — this case is only for the generic `AuditEntry` feeds.
    case "employee.transferred": {
      const dept = diff?.department as { from: unknown; to: unknown } | undefined;
      const titleChange = diff?.title as { from: unknown; to: unknown } | undefined;
      const from = String(dept?.from ?? "?");
      const to = String(dept?.to ?? "?");
      const retitled = titleChange && titleChange.from !== titleChange.to
        ? ` · retitled ${String(titleChange.to)}`
        : "";
      return `${entry.actorLabel} moved ${entry.entityLabel} from ${from} to ${to}${retitled}`;
    }
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
    // Phase 26 (spec §4.1): holds are placed and released on the asset.
    case "reservation.placed": {
      const until = diff?.expiresAt?.to;
      return `${entry.actorLabel} reserved ${entry.entityLabel} for ${String(diff?.hold?.to ?? "someone")}${typeof until === "string" ? ` until ${fmtDate(new Date(until))}` : ""}`;
    }
    case "reservation.released":
      return `${entry.actorLabel} released the hold on ${entry.entityLabel}`;
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
    case "import-update":
      return `${entry.actorLabel} updated ${fieldList(diff)} on ${entry.entityLabel} by import`;
    // Phase 19 (M-3): the fourteen stock/stocktake actions this module writes
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
    // Phase 22 Task 2 (spec §4.1/§5.4): writeOffLot/setLotCost/
    // uploadLotDocument's own audit rows. `entityLabel` here is the lot's
    // item (resolved server-side, `stock-lot` entities labelled by item code
    // and reference — Task 5's `entityLabels`), so these read like
    // `stock.received`/`stock.issued` above: no raw ids, the quantity/cost/
    // kind that makes the row worth reading without opening the diff.
    case "stock.written-off": {
      // `quantity` already carries its unit noun ("12 sachets") — the same
      // one `unitsLabel` (stock-balance.ts) would produce — because a
      // write-off has no before/after balance for the sentence to derive a
      // bare number and a unit word from separately, unlike stock.issued's
      // subtraction above.
      const qty = diff?.quantity?.to;
      const reason = diff?.reason?.to;
      return `${entry.actorLabel} wrote off ${qty ?? "stock"} of ${entry.entityLabel}${typeof reason === "string" && reason ? ` — ${reason}` : ""}`;
    }
    case "stock.lot-cost-set": {
      const cost = diff?.unitCost?.to;
      const costStr = typeof cost === "number" ? `₱${cost.toFixed(2)}` : "a cost";
      return `${entry.actorLabel} priced a lot of ${entry.entityLabel} at ${costStr}`;
    }
    case "stock.document-added": {
      const kind = diff?.kind?.to;
      const label = typeof kind === "string" ? (LOT_DOCUMENT_ARTICLE_LABEL[kind] ?? "a document") : "a document";
      return `${entry.actorLabel} attached ${label} to ${entry.entityLabel}`;
    }
    // Phase 27 (spec §3.5): every action that can reach a feed reads as a sentence.
    case "document.uploaded":
      return `${entry.actorLabel} attached ${String(diff?.document?.to ?? "a document")} to ${entry.entityLabel}`;
    case "document.signed": {
      const fileName = diff ? Object.keys(diff)[0] ?? "a document" : "a document";
      return `${entry.actorLabel} marked ${fileName} signed on ${entry.entityLabel}`;
    }
    case "loan.due-changed": {
      const to = diff?.loanDueAt?.to;
      return to
        ? `${entry.actorLabel} moved the loan due date of ${entry.entityLabel} to ${fmtDate(String(to))}`
        : `${entry.actorLabel} cleared the loan due date of ${entry.entityLabel}`;
    }
    case "secret.created":
      return `${entry.actorLabel} added the secret "${String(diff?.label?.to ?? "")}" to ${entry.entityLabel}`;
    case "acknowledgement.recorded":
      return `${entry.actorLabel} recorded ${entry.entityLabel}'s signed acknowledgement of ${plural(Number(diff?.items?.to ?? 0), "item")}`;
    case "policy.exception.added": {
      const reason = diff?.reason?.to;
      return `${entry.actorLabel} added the exception slot ${String(diff?.slot?.to ?? "")} for ${entry.entityLabel}${reason ? ` — ${String(reason)}` : ""}`;
    }
    case "policy.exception.waived": {
      const reason = diff?.reason?.to;
      return `${entry.actorLabel} waived ${String(diff?.slot?.from ?? "")} for ${entry.entityLabel}${reason ? ` — ${String(reason)}` : ""}`;
    }
    case "policy.exception.removed":
      return `${entry.actorLabel} removed the exception slot ${String(diff?.slot?.from ?? "")} for ${entry.entityLabel}`;
    case "supplier-set": {
      const to = diff?.supplier?.to;
      return to
        ? `${entry.actorLabel} set ${String(to)} as the supplier on ${entry.entityLabel}`
        : `${entry.actorLabel} cleared the supplier on ${entry.entityLabel}`;
    }
    default:
      return `${entry.actorLabel} ${entry.action} ${entry.entityLabel}`;
  }
}
