import { APPROVAL_TYPE_LABEL } from "./labels";

/**
 * Final review M5: every action code the server and the worker write to the audit log. /audit, the activity feeds
 * and the employee timeline read each one through ACTION_LABELS (src/lib/activity.ts), so a code missing a label
 * shows as a raw slug. `audit-actions.test.ts` greps src/server and src/worker for the written literals and keeps
 * this list, and the labels, complete. Call sites keep writing their own literals; this list is the check.
 */
export const AUDIT_ACTIONS = [
  // records
  "create", "update", "delete", "register", "rename", "archive", "restore", "comment", "unit-update",
  "import-create", "import-update",
  // assets: lifecycle, holds, documents, secrets
  "lifecycle.assign", "lifecycle.return", "lifecycle.change-status", "lifecycle.replace", "lifecycle.triage",
  "lifecycle.transfer", "loan.due-changed", "reservation.placed", "reservation.released",
  "document.uploaded", "document.signed", "secret.created", "SECRET_READ",
  // Phase 47: the shared asset notes and attachments (src/server/modules/assets)
  "note.posted", "note.replied", "note.resolved", "note.reopened", "attachment.uploaded",
  // approvals: the queue's transitions and the worker
  "approval.requested", "claim", "release", "approve", "reject", "escalate", "retry", "executed", "execution.failed",
  ...Object.values(APPROVAL_TYPE_LABEL).map((t) => `${t} executed`),
  // purchases (PurchaseAction) and finance
  "submit", "it-review", "it-reject", "request-info", "cancel", "complete", "supplier-set", "purchase.recorded",
  "finance.confirm", "finance.return", "finance.resubmit", "finance.reopened", "it.verify",
  "depreciation.policy", "depreciation.override", "depreciation.override.cleared",
  // Finance follow-up (src/server/modules/finance/undo-actions.ts): written from UNDONE_ACTION, so listed here by hand
  "finance.confirm.undone", "asset.return.undone", "depreciation.override.undone", "finance.confirm.reopened",
  // Purchase orders (src/server/modules/purchases/po-actions.ts): save, resubmit, send back, the PO-level fix (one
  // asset.money.fixed per asset it reached), cancel and close a line short; register from a PO (po-register.ts)
  "po.save", "po.resubmit", "po.send-back", "po.fix", "po.cancel", "po.line-closed", "asset.money.fixed", "po.register",
  // people
  "employee.transferred", "employee.setup", "offboarding.completed", "acknowledgement.recorded",
  "note.added", "note.edited", "note.deleted",
  // policies
  "policy.saved", "policy.exception.added", "policy.exception.waived", "policy.exception.removed",
  // stock and stocktakes
  "stock.received", "stock.issued", "stock.adjusted", "stock.written-off", "stock.lot-cost-set", "stock.document-added",
  "stock.item.created", "stock.item.updated", "stock.item.archived", "stock.item.restored",
  "stock.category.created", "stock.category.updated", "stock.category.archived", "stock.category.restored",
  "stocktake.opened", "stocktake.posted", "stocktake.cancelled",
  // suppliers
  "supplier.created", "supplier.updated", "supplier.archived", "supplier.restored",
  "supplier.bank.added", "supplier.bank.removed", "supplier.bank.revealed",
  // admin: accounts, flags, webhooks
  "signup", "bootstrap", "role-change", "disable", "enable",
  "flag-enable", "flag-disable", "flag-value", "cris-settings",
  "endpoint-enable", "endpoint-disable", "endpoint-delete", "rotate-secret", "replay",
] as const;
