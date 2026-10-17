import { fmtDate, fmtMoneyExact } from "./format";
import { lifeLabel } from "./depreciation-input";
import { statusLabel } from "./asset-class";
import { EMPLOYMENT_LABEL } from "./labels";

/** Phase 27 (spec §3.5): the facet's words for each action a feed can show; an unmapped action shows its raw name. */
export const ACTION_LABELS: Record<string, string> = {
  create: "Created", update: "Updated", register: "Registered",
  "import-create": "Imported (new)", "import-update": "Imported (update)",
  "lifecycle.assign": "Assigned", "lifecycle.return": "Returned", "lifecycle.change-status": "Status changed",
  "lifecycle.replace": "Replaced", "lifecycle.triage": "Triaged", "loan.due-changed": "Loan due date changed",
  // Phase 27 fix wave (I-1): the approvals worker's own actions (`<APPROVAL_TYPE_LABEL> executed`,
  // worker/execute-approval.ts) — without these the Action facet listed a raw string and split "Assigned" in two.
  "lifecycle.transfer": "Asset transferred",
  "lifecycle.assign executed": "Assigned (approved request)",
  "lifecycle.replace executed": "Replaced (approved request)",
  "lifecycle.transfer executed": "Asset transferred (approved request)",
  "lifecycle.return executed": "Returned (approved request)",
  "lifecycle.change-status executed": "Status changed (approved request)",
  "reservation.placed": "Hold placed", "reservation.released": "Hold released",
  "document.uploaded": "Document attached", "document.signed": "Document signed",
  "secret.created": "Secret added", SECRET_READ: "Secret read",
  "approval.requested": "Change requested", comment: "Comment", "unit-update": "Units updated",
  submit: "Submitted", "it-review": "IT review", "it-reject": "Returned by IT", "request-info": "Info requested",
  cancel: "Cancelled", complete: "Completed", "finance.confirm": "Finance confirmed", "it.verify": "IT verified",
  "finance.return": "Returned by Finance", "finance.resubmit": "Resubmitted", "finance.reopened": "Back to Finance", "supplier-set": "Supplier set",
  "depreciation.policy": "Depreciation policy", "depreciation.override": "Custom depreciation", "depreciation.override.cleared": "Custom depreciation cleared",
  "employee.transferred": "Transferred", "offboarding.completed": "Offboarding completed",
  "acknowledgement.recorded": "Acknowledgement signed", "purchase.recorded": "Purchase recorded",
  "policy.exception.added": "Exception added", "policy.exception.waived": "Exception waived", "policy.exception.removed": "Exception removed",
  rename: "Renamed", archive: "Ended or archived", restore: "Restored",
  "policy.saved": "Policy saved",
  "note.added": "Note added", "note.edited": "Note edited", "note.deleted": "Note deleted", "employee.setup": "IT setup changed",
  // Final review M5: every other code the server and worker write (AUDIT_ACTIONS, audit-actions.test.ts keeps it whole).
  delete: "Deleted",
  claim: "Claimed", release: "Released", approve: "Approved", reject: "Rejected", escalate: "Escalated", retry: "Retried",
  executed: "Request carried out", "execution.failed": "Request failed",
  "stock.received": "Stock received", "stock.issued": "Stock issued", "stock.adjusted": "Stock adjusted",
  "stock.written-off": "Stock written off", "stock.lot-cost-set": "Lot cost set", "stock.document-added": "Stock document attached",
  "stock.item.created": "Stock item added", "stock.item.updated": "Stock item updated",
  "stock.item.archived": "Stock item archived", "stock.item.restored": "Stock item restored",
  "stock.category.created": "Stock category added", "stock.category.updated": "Stock category updated",
  "stock.category.archived": "Stock category archived", "stock.category.restored": "Stock category restored",
  "stocktake.opened": "Stocktake started", "stocktake.posted": "Stocktake posted", "stocktake.cancelled": "Stocktake cancelled",
  "supplier.created": "Supplier added", "supplier.updated": "Supplier updated",
  "supplier.archived": "Supplier archived", "supplier.restored": "Supplier restored",
  "supplier.bank.added": "Bank details added", "supplier.bank.removed": "Bank details removed", "supplier.bank.revealed": "Bank details viewed",
  signup: "Signed up", bootstrap: "First admin set up", "role-change": "Role changed",
  disable: "Account disabled", enable: "Account enabled",
  "flag-enable": "Flag turned on", "flag-disable": "Flag turned off", "flag-value": "Flag value changed",
  "cris-settings": "Cris settings changed",
  "endpoint-enable": "Webhook turned on", "endpoint-disable": "Webhook turned off", "endpoint-delete": "Webhook removed",
  "rotate-secret": "Webhook secret rotated", replay: "Delivery resent",
};
export function actionLabel(action: string): string { return ACTION_LABELS[action] ?? action; }

/** Phase 27 (spec §3.5): raw diff keys → words, shared by the `update` and `import-update` sentences. */
export const FIELD_LABELS: Record<string, string> = {
  name: "name", model: "model", serial: "serial", cost: "cost", location: "location", notes: "notes",
  categoryId: "category", typeId: "type", departmentId: "department", assigneeId: "holder", assignee: "holder", vendorId: "supplier",
  purchasedAt: "purchase date", warrantyUntil: "warranty end", loanDueAt: "loan due date",
  employeeNo: "employee number", email: "email", title: "title", employment: "employment", joinedAt: "join date",
  offboardingAt: "offboarding start", offboardingDueAt: "complete-by date",
  registeredName: "registered name", contactPerson: "contact person", phone: "phone", address: "address",
  registrationNo: "registration number", contractStatus: "contract status", contractStart: "contract start", contractEnd: "contract end",
  unit: "unit", packSize: "pack size", reorderLevel: "reorder level", expiresAt: "expiry",
  // Phase 40 §8: triage records Dispose/Donate's `reason` apart from Keep/Repair's optional `note`
  reason: "reason", note: "note",
};
/** Known keys read from the table; unknown ones lose a trailing "Id" and split camelCase: "repairEndedAt" → "repair ended at". */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

// sorted on the label: jsonb stores keys shortest-first, so storage order is neither the writer's nor alphabetical
const fieldList = (diff: Record<string, unknown> | null) => (diff ? Object.keys(diff).map(fieldLabel).sort().join(", ") : "fields");
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

/**
 * Phase 30 (T1): `omitActor`/`omitEntity` let a caller ask for the phrase without the leading actor
 * and/or the entity label — the same verb map below, not a second one and not string surgery on the
 * rendered sentence. `auditPhrase` is the public shorthand for omitting both.
 */
export function auditSentence(entry: ActivityEntryLike, opts?: { omitActor?: boolean; omitEntity?: boolean }): string {
  const omitEntity = opts?.omitEntity ?? false;
  const actor = opts?.omitActor ? "" : `${entry.actorLabel} `;
  const diff = (entry.diff ?? null) as Record<string, { from: unknown; to: unknown }> | null;
  // Phase 27 fix wave (I-1): the approvals worker writes "<lifecycle.*> executed" on the asset with the
  // same prepared diff a direct action writes — one sentence body serves both, with a suffix saying
  // the change came through an approved request.
  const EXECUTED = " executed";
  const viaApproval = entry.action.endsWith(EXECUTED);
  const action = viaApproval ? entry.action.slice(0, -EXECUTED.length) : entry.action;
  const suffix = viaApproval ? " (approved request)" : "";
  switch (action) {
    case "create": {
      // Phase 37: a policy copied from another group's reads as the copy, not as a bare create.
      if (diff?.copiedFrom?.to) return `${actor}copied ${String(diff.copiedFrom.to)} to ${entry.entityLabel}`;
      // Phase 37: a department/client create carries `kind` in its diff; older department entries (no kind) read as before.
      const kind = diff?.kind?.to;
      if (kind === "CLIENT" || kind === "INTERNAL") {
        const name = String(diff?.name?.to ?? entry.entityLabel);
        return `${actor}added ${kind === "CLIENT" ? "client" : "department"} ${name}`;
      }
      return omitEntity ? `${actor}created` : `${actor}created ${entry.entityLabel}`;
    }
    case "policy.saved":
      return diff?.copiedFrom?.to
        ? `${actor}copied ${String(diff.copiedFrom.to)} to ${entry.entityLabel}`
        : `${actor}saved ${entry.entityLabel}'s equipment list`;
    case "rename":
      return `${actor}renamed ${String(diff?.name?.from ?? entry.entityLabel)} to ${String(diff?.name?.to ?? "?")}`;
    case "archive": {
      const name = String(diff?.name?.to ?? entry.entityLabel);
      return diff?.kind?.to === "CLIENT" ? `${actor}ended the ${name} account` : `${actor}archived ${name}`;
    }
    case "restore":
      return `${actor}restored ${String(diff?.name?.to ?? entry.entityLabel)}`;
    case "update":
      return omitEntity ? `${actor}updated ${fieldList(diff)}` : `${actor}updated ${fieldList(diff)} on ${entry.entityLabel}`;
    case "SECRET_READ": {
      const label = diff?.label?.to;
      const phrase = `revealed the secret "${String(label ?? "?")}"`;
      return omitEntity ? `${actor}${phrase}` : `${actor}${phrase} on ${entry.entityLabel}`;
    }
    case "approval.requested": {
      const phrase = `requested ${String(diff?.approval?.to ?? "an approval")}`;
      return omitEntity ? `${actor}${phrase}` : `${actor}${phrase} on ${entry.entityLabel}`;
    }
    case "submit":
      return omitEntity ? `${actor}submitted for IT review` : `${actor}submitted ${entry.entityLabel} for IT review`;
    case "it-review":
      return omitEntity ? `${actor}marked IT-reviewed` : `${actor}marked ${entry.entityLabel} IT-reviewed`;
    case "it-reject":
      return omitEntity ? `${actor}sent back to purchasing` : `${actor}sent ${entry.entityLabel} back to purchasing`;
    case "request-info":
      return omitEntity ? `${actor}sent back for more information` : `${actor}sent ${entry.entityLabel} back for more information`;
    case "cancel":
      return omitEntity ? `${actor}cancelled` : `${actor}cancelled ${entry.entityLabel}`;
    case "complete":
      return omitEntity ? `${actor}completed` : `${actor}completed ${entry.entityLabel}`;
    // Phase 12's asset actions. Left to the default they rendered the
    // raw verb — "J. Sarmiento finance.return BR-LT-0148" — which is not a
    // sentence and buries the one thing a reader of the feed wants.
    case "register":
      return omitEntity ? `${actor}registered` : `${actor}registered ${entry.entityLabel}`;
    case "finance.confirm": {
      if (diff?.notCapitalised?.to === true) {
        return omitEntity ? `${actor}approved as not capitalised` : `${actor}approved ${entry.entityLabel} as not capitalised`;
      }
      return omitEntity ? `${actor}confirmed details` : `${actor}confirmed ${entry.entityLabel}'s details`;
    }
    case "it.verify":
      return omitEntity ? `${actor}checked` : `${actor}checked ${entry.entityLabel}`;
    case "finance.return": {
      // Phase 35 (spec §3.3): `to` is { fields: labels[], note } now; a string is a pre-Phase-35 reason.
      const to = diff?.financeReturn?.to as { fields?: string[]; note?: string | null } | string | null | undefined;
      if (to && typeof to === "object") {
        const items = (to.fields ?? []).join(", ");
        const note = to.note ? ` \u2014 \u201c${to.note}\u201d` : "";
        return omitEntity ? `${actor}sent back: ${items}${note}` : `${actor}sent ${entry.entityLabel} back: ${items}${note}`;
      }
      const tail = to ? ` \u00b7 ${String(to)}` : "";
      return omitEntity ? `${actor}sent back to IT${tail}` : `${actor}sent ${entry.entityLabel} back to IT${tail}`;
    }
    case "finance.resubmit": {
      const reply = diff?.reply?.to ? ` \u2014 \u201c${String(diff.reply.to)}\u201d` : "";
      if (reply) return omitEntity ? `${actor}marked corrected${reply}` : `${actor}marked ${entry.entityLabel} corrected${reply}`;
      return omitEntity ? `${actor}marked corrected for Finance` : `${actor}marked ${entry.entityLabel} corrected for Finance`;
    }
    case "finance.reopened":
      return omitEntity ? `${actor}added a cost, so it went back to Finance` : `${actor}added a cost to ${entry.entityLabel}, so it went back to Finance`;
    case "depreciation.policy": {
      const life = diff?.lifeMonths?.to as number | null | undefined;
      if (life == null) return omitEntity ? `${actor}cleared depreciation` : `${actor}cleared depreciation on ${entry.entityLabel}`;
      const pct = (diff?.salvagePercent?.to as number | null | undefined) ?? 0;
      const tail = `${lifeLabel(life)}, ${pct}% salvage`;
      return omitEntity ? `${actor}set depreciation: ${tail}` : `${actor}set depreciation on ${entry.entityLabel}: ${tail}`;
    }
    case "depreciation.override": {
      const tail = `${lifeLabel(diff?.lifeMonths?.to as number)}, ${fmtMoneyExact(diff?.salvage?.to as number)} salvage`;
      return omitEntity ? `${actor}set custom depreciation: ${tail}` : `${actor}set custom depreciation on ${entry.entityLabel}: ${tail}`;
    }
    case "depreciation.override.cleared":
      return omitEntity ? `${actor}cleared custom depreciation` : `${actor}cleared custom depreciation on ${entry.entityLabel}`;
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
      return omitEntity
        ? `${actor}moved from ${from} to ${to}${retitled}`
        : `${actor}moved ${entry.entityLabel} from ${from} to ${to}${retitled}`;
    }
    case "offboarding.completed": {
      const items = diff?.decisions?.to;
      const n = Array.isArray(items) ? items.length : 0;
      const tail = n ? ` · ${n} item${n === 1 ? "" : "s"} settled` : "";
      return omitEntity ? `${actor}completed offboarding${tail}` : `${actor}completed offboarding for ${entry.entityLabel}${tail}`;
    }
    // Phase 15: direct IT lifecycle changes. Subject-first, no refNo — the
    // approval row exists (already EXECUTED) but the sentence is about the asset.
    case "lifecycle.assign": {
      const phrase = `assigned to ${String(diff?.assignee?.to ?? "someone")}${suffix}`;
      return omitEntity ? `${actor}${phrase}` : `${actor}assigned ${entry.entityLabel} to ${String(diff?.assignee?.to ?? "someone")}${suffix}`;
    }
    case "lifecycle.transfer": {
      const to = diff?.assignee?.to;
      const tail = `${to ? ` to ${String(to)}` : ""}${suffix}`;
      return omitEntity ? `${actor}transferred${tail}` : `${actor}transferred ${entry.entityLabel}${tail}`;
    }
    case "lifecycle.return": {
      const to = diff?.status?.to;
      const tail = diff?.returnedAt?.to ? `for triage${suffix}` : `as ${to ? statusLabel(String(to)) : "?"}${suffix}`;
      return omitEntity ? `${actor}returned ${tail}` : `${actor}returned ${entry.entityLabel} ${tail}`;
    }
    case "lifecycle.change-status": {
      // Phase 40 §6: the status's word ("Loan"), never the enum.
      const to = diff?.status?.to ? statusLabel(String(diff.status.to)) : "?";
      return omitEntity ? `${actor}changed to ${to}${suffix}` : `${actor}changed ${entry.entityLabel} to ${to}${suffix}`;
    }
    case "lifecycle.replace": {
      if (diff?.replacedBy) {
        const tail = `with ${String(diff.replacedBy.to)}${suffix}`;
        return omitEntity ? `${actor}replaced ${tail}` : `${actor}replaced ${entry.entityLabel} ${tail}`;
      }
      const tail = `in place of ${String(diff?.replaces?.to ?? "?")} for ${String(diff?.assignee?.to ?? "someone")}${suffix}`;
      return omitEntity ? `${actor}put ${tail}` : `${actor}put ${entry.entityLabel} ${tail}`;
    }
    case "lifecycle.triage":
      return omitEntity
        ? `${actor}triaged: ${String(diff?.triage?.to ?? "?")}${suffix}`
        : `${actor}triaged ${entry.entityLabel}: ${String(diff?.triage?.to ?? "?")}${suffix}`;
    // Phase 26 (spec §4.1): holds are placed and released on the asset.
    case "reservation.placed": {
      const until = diff?.expiresAt?.to;
      const tail = `for ${String(diff?.hold?.to ?? "someone")}${typeof until === "string" ? ` until ${fmtDate(new Date(until))}` : ""}`;
      return omitEntity ? `${actor}reserved ${tail}` : `${actor}reserved ${entry.entityLabel} ${tail}`;
    }
    case "reservation.released":
      return omitEntity ? `${actor}released the hold` : `${actor}released the hold on ${entry.entityLabel}`;
    case "comment":
      return omitEntity ? `${actor}commented` : `${actor}commented on ${entry.entityLabel}`;
    case "unit-update":
      return omitEntity ? `${actor}updated a unit` : `${actor}updated a unit on ${entry.entityLabel}`;
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
        typeof status === "string" && status !== "SPARE" ? ` as ${statusLabel(status)}`
        : typeof employment === "string" && employment !== "ACTIVE"
          ? ` as ${Object.hasOwn(EMPLOYMENT_LABEL, employment) ? EMPLOYMENT_LABEL[employment as keyof typeof EMPLOYMENT_LABEL] : employment}`
        : "";
      return omitEntity ? `${actor}imported${suffix}` : `${actor}imported ${entry.entityLabel}${suffix}`;
    }
    case "import-update":
      return omitEntity ? `${actor}updated ${fieldList(diff)} by import` : `${actor}updated ${fieldList(diff)} on ${entry.entityLabel} by import`;
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
      return omitEntity ? `${actor}created` : `${actor}created ${entry.entityLabel}`;
    case "stock.item.updated": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return omitEntity ? `${actor}updated ${fields}` : `${actor}updated ${fields} on ${entry.entityLabel}`;
    }
    case "stock.item.archived":
      return omitEntity ? `${actor}archived` : `${actor}archived ${entry.entityLabel}`;
    case "stock.item.restored":
      return omitEntity ? `${actor}restored` : `${actor}restored ${entry.entityLabel}`;
    case "stock.category.created":
      return omitEntity ? `${actor}created the category` : `${actor}created the category ${entry.entityLabel}`;
    case "stock.category.updated": {
      const fields = diff ? Object.keys(diff).join(", ") : "fields";
      return omitEntity ? `${actor}updated ${fields} on the category` : `${actor}updated ${fields} on the category ${entry.entityLabel}`;
    }
    case "stock.category.archived":
      return omitEntity ? `${actor}archived the category` : `${actor}archived the category ${entry.entityLabel}`;
    case "stock.category.restored":
      return omitEntity ? `${actor}restored the category` : `${actor}restored the category ${entry.entityLabel}`;
    case "stock.received": {
      const qty = diff?.quantity?.to;
      const qtyStr = typeof qty === "number" ? qty : "stock";
      return omitEntity ? `${actor}received ${qtyStr}` : `${actor}received ${qtyStr} of ${entry.entityLabel}`;
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
      const tail = typeof dept === "string" ? ` to ${dept}` : "";
      return omitEntity ? `${actor}issued ${qty ?? "stock"}${tail}` : `${actor}issued ${qty ?? "stock"} of ${entry.entityLabel}${tail}`;
    }
    case "stock.adjusted": {
      const from = diff?.balance?.from;
      const to = diff?.balance?.to;
      const delta = typeof from === "number" && typeof to === "number" ? to - from : null;
      // Real minus (U+2212), never a hyphen-minus — the same convention
      // `stocktake-review.tsx`'s `fmtVariance` uses for a negative.
      const deltaStr = delta === null ? "an amount" : delta >= 0 ? `+${delta}` : `−${Math.abs(delta)}`;
      const reason = diff?.reason?.to;
      const tail = `by ${deltaStr}${typeof reason === "string" ? ` · ${reason}` : ""}`;
      return omitEntity ? `${actor}adjusted ${tail}` : `${actor}adjusted ${entry.entityLabel} ${tail}`;
    }
    case "stocktake.opened": {
      const scope = diff?.scope?.to;
      const lines = diff?.lines?.to;
      const lineSuffix = typeof lines === "number" ? ` · ${lines} item${lines === 1 ? "" : "s"}` : "";
      const tail = `for ${typeof scope === "string" ? scope : "all categories"}${lineSuffix}`;
      return omitEntity ? `${actor}opened ${tail}` : `${actor}opened ${entry.entityLabel} ${tail}`;
    }
    case "stocktake.posted": {
      const adjusted = diff?.adjusted?.to;
      const skipped = diff?.skipped?.to;
      const tail = `${typeof adjusted === "number" ? adjusted : 0} adjusted, ${typeof skipped === "number" ? skipped : 0} not counted`;
      return omitEntity ? `${actor}posted · ${tail}` : `${actor}posted ${entry.entityLabel} · ${tail}`;
    }
    case "stocktake.cancelled":
      return omitEntity ? `${actor}cancelled the stocktake` : `${actor}cancelled the stocktake ${entry.entityLabel}`;
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
      const tail = typeof reason === "string" && reason ? ` — ${reason}` : "";
      return omitEntity ? `${actor}wrote off ${qty ?? "stock"}${tail}` : `${actor}wrote off ${qty ?? "stock"} of ${entry.entityLabel}${tail}`;
    }
    case "stock.lot-cost-set": {
      const cost = diff?.unitCost?.to;
      const costStr = typeof cost === "number" ? `₱${cost.toFixed(2)}` : "a cost";
      return omitEntity ? `${actor}priced a lot at ${costStr}` : `${actor}priced a lot of ${entry.entityLabel} at ${costStr}`;
    }
    case "stock.document-added": {
      const kind = diff?.kind?.to;
      const label = typeof kind === "string" ? (LOT_DOCUMENT_ARTICLE_LABEL[kind] ?? "a document") : "a document";
      return omitEntity ? `${actor}attached ${label}` : `${actor}attached ${label} to ${entry.entityLabel}`;
    }
    // Phase 27 (spec §3.5): every action that can reach a feed reads as a sentence.
    case "document.uploaded": {
      const doc = String(diff?.document?.to ?? "a document");
      return omitEntity ? `${actor}attached ${doc}` : `${actor}attached ${doc} to ${entry.entityLabel}`;
    }
    case "document.signed": {
      // the writer (inventory/document-actions.ts) keys this diff by the file name alone
      const fileName = diff ? Object.keys(diff)[0] ?? "a document" : "a document";
      return omitEntity ? `${actor}marked ${fileName} signed` : `${actor}marked ${fileName} signed on ${entry.entityLabel}`;
    }
    case "loan.due-changed": {
      const to = diff?.loanDueAt?.to;
      if (to) {
        return omitEntity
          ? `${actor}moved the loan due date to ${fmtDate(String(to))}`
          : `${actor}moved the loan due date of ${entry.entityLabel} to ${fmtDate(String(to))}`;
      }
      return omitEntity ? `${actor}cleared the loan due date` : `${actor}cleared the loan due date of ${entry.entityLabel}`;
    }
    case "secret.created": {
      const phrase = `added the secret "${String(diff?.label?.to ?? "")}"`;
      return omitEntity ? `${actor}${phrase}` : `${actor}${phrase} to ${entry.entityLabel}`;
    }
    case "acknowledgement.recorded": {
      const items = plural(Number(diff?.items?.to ?? 0), "item");
      return omitEntity ? `${actor}recorded a signed acknowledgement of ${items}` : `${actor}recorded ${entry.entityLabel}'s signed acknowledgement of ${items}`;
    }
    case "policy.exception.added": {
      const reason = diff?.reason?.to;
      const tail = reason ? ` — ${String(reason)}` : "";
      return omitEntity
        ? `${actor}added the exception slot ${String(diff?.slot?.to ?? "")}${tail}`
        : `${actor}added the exception slot ${String(diff?.slot?.to ?? "")} for ${entry.entityLabel}${tail}`;
    }
    case "policy.exception.waived": {
      const reason = diff?.reason?.to;
      const tail = reason ? ` — ${String(reason)}` : "";
      return omitEntity
        ? `${actor}waived ${String(diff?.slot?.from ?? "")}${tail}`
        : `${actor}waived ${String(diff?.slot?.from ?? "")} for ${entry.entityLabel}${tail}`;
    }
    case "policy.exception.removed":
      return omitEntity
        ? `${actor}removed the exception slot ${String(diff?.slot?.from ?? "")}`
        : `${actor}removed the exception slot ${String(diff?.slot?.from ?? "")} for ${entry.entityLabel}`;
    case "supplier-set": {
      const to = diff?.supplier?.to;
      if (to) {
        return omitEntity ? `${actor}set ${String(to)} as the supplier` : `${actor}set ${String(to)} as the supplier on ${entry.entityLabel}`;
      }
      return omitEntity ? `${actor}cleared the supplier` : `${actor}cleared the supplier on ${entry.entityLabel}`;
    }
    // Phase 37 (spec §4.5, §4.6): notes and IT setup are written on the employee; the diff keeps the text / label.
    case "note.added":
      return omitEntity ? `${actor}added a note` : `${actor}added a note on ${entry.entityLabel}`;
    case "note.edited":
      return omitEntity ? `${actor}edited a note` : `${actor}edited a note on ${entry.entityLabel}`;
    case "note.deleted":
      return omitEntity ? `${actor}deleted a note` : `${actor}deleted a note on ${entry.entityLabel}`;
    case "employee.setup": {
      // one diff key: the field's label ("Entra / Intune", "VPN" …) → { from, to } with the value as words
      const label = diff ? Object.keys(diff)[0] ?? "IT setup" : "IT setup";
      const value = String(diff?.[label]?.to ?? "Not recorded");
      return omitEntity ? `${actor}set ${label} to ${value}` : `${actor}set ${entry.entityLabel}'s ${label} to ${value}`;
    }
    case "purchase.recorded": {
      // Phase 34 (spec §7.3): one row per Register submit, entityLabel is the tag range.
      const n = typeof diff?.quantity?.to === "number" ? diff.quantity.to : 0;
      const what = `a purchase of ${n} item${n === 1 ? "" : "s"}`;
      return omitEntity ? `${actor}recorded ${what}` : `${actor}recorded ${what} (${entry.entityLabel})`;
    }
    default:
      return omitEntity ? `${actor}${entry.action}` : `${actor}${entry.action} ${entry.entityLabel}`;
  }
}

/**
 * Phase 30 (T1, spec §4.1 line via task-3-brief): the "Last change" line's phrase — the same sentence
 * `auditSentence` builds, minus the leading actor and the entity label, so the caller can show
 * `{phrase} · {date} · {actor}` without the actor or the tag appearing twice.
 */
export function auditPhrase(entry: { action: string; diff: unknown }): string {
  return auditSentence({ actorLabel: "", action: entry.action, diff: entry.diff, entityLabel: "" }, { omitActor: true, omitEntity: true });
}
