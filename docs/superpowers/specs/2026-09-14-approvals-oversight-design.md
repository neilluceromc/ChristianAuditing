# Phase 21 — Approvals oversight: direct IT changes made visible, plus five correctness and quality items

**Status:** implemented on branch `phase-21-approvals-oversight` (8 tasks, `D-1`…`D-10`), code-complete
2026-09-14 at final tree `562587f`, unmerged and unpushed; battery `tsc` clean · `lint` clean ·
**22 migrations** · **1312 unit / 77 files** · **305 e2e / 29 files** by `--list`, across six foreground
chunks with explicit file paths — **A 54 (3.4m) · B 67 (3.9m) · C 63 (4.0m) · D 38 (2.6m) · E 53 (7.4m) ·
F 30 (3.3m) = 305**, zero failed, zero did-not-run. See the plan's `D`-block for what each amendment
changed and `docs/HANDOVER.md` (n) for what shipped. The user asked to run the whole method through to the
finishing menu without further check-ins; merging, pushing and redeploying stay the user's decisions.

**Plan:** `docs/superpowers/plans/2026-09-14-phase-21-approvals-oversight.md` (written next).

---

## 0. Decisions made in the brainstorm

| # | Decision | Why |
|---|---|---|
| 1 | Phase 21 takes the approvals-visibility cluster: direct IT changes become visible and distinguishable on the approvals surfaces; the record's pending banner and the employee page's `Open requests` stat keep Phase 15's meaning (genuinely open requests only). | The Phase 15 spec (§2.5) chose "applies now, no pending row" deliberately; the gap is oversight, not a missing queue entry. |
| 2 | A direct change is marked by a stored flag, `Approval.appliedDirectly`, set at creation and backfilled once. | Filterable and indexable in Prisma; a fact in the schema rather than a timestamp coincidence; no new state value to thread through every switch. |
| 3 | The Closed tab shows the flag as a `DIRECT` pill and can filter by route (`via=direct` / `via=queue`); the detail page of a direct row says who applied it and when instead of pretending a request was checked. | Oversight needs a place to look and a way to narrow. |
| 4 | Administrators get a Home section "Applied directly · last 7 days" with counts by kind and by person, on both Homes an admin can land on (the IT branch by default and the admin branch behind the workspace switch). | An admin who never switches workspace would otherwise never see it. |
| 5 | One approval appears once per screen: Home's worklist stops repeating the viewer's own claims, which already sit in "Claimed by you" directly above; `/inventory/work` (no claims list) is unchanged. | Settles the "possible approvals double-count" Phase 17's final review left undecided. |
| 6 | Every paged list reads its count and its page from one database snapshot. | Closes Phase 17's deferred "count then fetch can shift" note for all lists at once, through one helper. |
| 7 | Every reason field strips invisible characters before its length check, through one shared schema. | A three-character minimum that accepts zero-width spaces is no minimum. |
| 8 | The axe sweep's four tolerated rules are attributed to their root causes, fixed, and promoted to failing rules. | The tail has sat at the same four rules since Phase 10; nothing forces it down. |
| 9 | The rate limiter gets end-to-end coverage: one mutation cap and one import cap, each proven with the real notice. | No spec in the suite has ever seen `RateLimitNotice` render. |

---

## 1. Scope

**In:** everything in §0. **Out:** a review or reversal window for direct changes; changing the record's
pending banner or the employee page's `Open requests` stat; Purchasing direct changes (there are none —
`DIRECT_LIFECYCLE_CLASSES` is `["IT"]`); the other survey clusters (custody and repairs, inventory hygiene,
ops and sign-in safety); everything in `docs/HANDOVER-PENDING.md`.

**Behaviour that must not change:** the approval state machine and every existing state value; what a direct
change does to the asset (Phase 15); the worker; the Open / Mine / Unclaimed / Failed tab rules; every
existing URL (new query parameters only); the meaning of any reason field's minimum and maximum; every
existing e2e assertion except the two this spec names (the fresh-seed Closed count and the sweep's promoted
rules).

---

## 2. Data model — migration 22 `approval_applied_directly`

```prisma
model Approval {
  // … existing fields …
  /// Phase 21: created already EXECUTED by a direct IT change (Phase 15) — a decision recorded, never a request queued.
  appliedDirectly Boolean @default(false)
  // … existing indexes …
  @@index([appliedDirectly, resolvedAt])
}
```

Additive. The migration's one backfill marks the rows Phase 15 has been writing since 2026-09-07:

```sql
UPDATE "Approval" SET "appliedDirectly" = true
WHERE "state" = 'EXECUTED' AND "claimedAt" IS NOT NULL AND "claimedAt" = "resolvedAt";
```

A direct row is the only kind whose claim and resolution share one instant (`createApproval` writes both from
one `executed.at`); a queue row is claimed first and executed by the worker later. The seeded `APR-2031`
(EXECUTED, no `claimedAt`) stays a queue row.

`createApproval` sets `appliedDirectly: input.executed !== undefined`. No other writer touches the flag.

**Seed:** three direct rows so the Closed filter and the Home section have data on a fresh database, all
applied by the IT user (`itStaff`) on IT assets no e2e spec queries approvals for, with `claimedAt =
resolvedAt`, `appliedDirectly: true`, `refNo` below the sequence's 2041:

| refNo | type | asset | payload | resolved |
|---|---|---|---|---|
| `APR-2036` | `lifecycle_assign` | `BR-HS-0501` | `{ to: { assigneeId: <EMP-0051 id>, status: "DEPLOYED" }, reason: "assigned" }` | 1 day ago |
| `APR-2037` | `lifecycle_return` | `BR-HS-0502` | `{ from: { assigneeId: <EMP-0063 id> }, to: { assigneeId: null, status: "SPARE" }, reason: "" }` | 3 days ago |
| `APR-2038` | `lifecycle_change_status` | `BR-KB-0402` | `{ from: { status: "SPARE" }, to: { status: "DEFECTIVE" }, reason: "Two keys unresponsive" }` | 2 days ago |

Their `requestedById` is the IT user too (a direct change is requested and applied by the same person). The
fresh-seed Closed count becomes **5** (`e2e/approvals-audit.spec.ts` "fresh-seed counts render" changes
from 2 to 5; Open, Mine, Unclaimed and Failed are unchanged).

---

## 3. The approvals surfaces

### 3.1 Pure rules (`src/lib/approvals-list.ts`)

```ts
export const CLOSED_VIA = ["all", "direct", "queue"] as const;
export type ClosedVia = (typeof CLOSED_VIA)[number];
export function parseVia(raw: string | null | undefined): ClosedVia;   // unknown → "all"
export function viaWhere(via: ClosedVia): Prisma.ApprovalWhereInput;   // all → {}, direct → { appliedDirectly: true }, queue → { appliedDirectly: false }
export const CLOSED_VIA_LABEL: Record<ClosedVia, string> = { all: "All", direct: "Applied directly", queue: "Through the queue" };
export const DIRECT_WINDOW_DAYS = 7;
export const DIRECT_KIND_LABEL: Record<ApprovalType, string> = {
  lifecycle_assign: "Assigned", lifecycle_return: "Returned", lifecycle_change_status: "Status changed",
  lifecycle_replace: "Replaced", lifecycle_transfer: "Transferred",
};
```

`tabWhere` is unchanged and gains a doc comment stating the counting rules: the tabs overlap by design
(Open ⊇ Mine ∪ Unclaimed); Closed = REJECTED ∪ EXECUTED regardless of route; `via` narrows Closed only.

### 3.2 Queue (`/approvals`)

- URL contract: `?tab=closed&via=direct|queue`. `via` is read only when `tab=closed`; any other tab ignores
  it; the tab links never carry it; pagination links keep it.
- `listApprovals(tab, via, userId, role, requestedPage)` — `where = AND[tabWhere(tab), tab === "closed" ?
  viaWhere(via) : {}, approvalClassWhere(role)]`; each `ApprovalRow` gains `direct: boolean`.
- `closedViaCounts(userId, role): Record<ClosedVia, number>` — three counts under the closed rule and the
  class scope; shown only on the Closed tab.
- Under the tab bar, when `tab === "closed"`, a chip row `role="group" aria-label="Closed by route"` with
  three links: `All 5`, `Applied directly 3`, `Through the queue 2` (label, then the count in mono); the
  active chip has `aria-current="true"`; chip markup mirrors `repair-chips.tsx`.
- A direct row's State cell reads `EXECUTED` followed by a `<Pill>DIRECT</Pill>`; the keyboard row
  announcement appends ", applied directly".
- Empty states: `via=direct` with no rows → title "Nothing has been applied directly", body "Direct IT
  changes will appear here as they happen."; `via=queue` → "Nothing has come through the queue yet".

### 3.3 Detail (`/approvals/[id]`) for a direct row

- Header meta line: `{type label} · applied directly by {claimedBy.name} · {fmtDateTime(resolvedAt)}` —
  no "requested by" (it is the same person) and no SLA (nothing was waiting).
- The "What the system checked" card is replaced by a card **"How it was applied"**: "Applied directly by
  **{name}** on {fmtDateTime(resolvedAt)}. No request was queued — the change took effect the moment
  {name} confirmed it, and it is recorded in the audit trail under their name." followed by a link
  `See the asset's history →` to `/inventory/{assetId}/history` when the row has an asset.
- The facts card and `ApprovalActions` are unchanged (an EXECUTED row offers no actions today).
- A queue-executed row (`appliedDirectly = false`) renders exactly as before.

---

## 4. Home

### 4.1 "Applied directly · last 7 days"

`directChanges(now = new Date(), days = DIRECT_WINDOW_DAYS)` in `src/server/modules/home/queries.ts`:

```ts
export interface DirectChanges {
  since: Date; total: number;
  byKind: Array<{ type: ApprovalType; label: string; count: number }>;   // zero-count kinds omitted; count desc, then label
  byActor: Array<{ name: string; count: number }>;                        // count desc, then name
}
```

Two `groupBy` calls (`type`, `claimedById`) over `{ appliedDirectly: true, resolvedAt: { gte: since } }`,
actor names by one `user.findMany`. Rendered by `DirectChangesBody` (`src/components/home/direct-changes.tsx`):
a `Stat` "Applied directly" with the total, a "By kind" list (label · mono count), a "By whom" list (name ·
mono count), and the link `See them in Closed →` to `/approvals?tab=closed&via=direct`. Empty: "Nothing was
applied directly in the last 7 days."

Where it renders, as a `SectionCard` titled **"Applied directly · last 7 days"**, only for `user.role ===
"admin"`:

- the admin branch (`ws === "admin"`), below "System";
- the IT branch (an admin's default landing), inside the `!focus` block above "Fleet".

It is a secondary section, so `SHOWS_FOCUS_TOGGLE.admin` becomes `true` and the admin branch hides it under
focus like the IT branch hides Fleet — exactly the one-word change the existing comment reserved.

### 4.2 One approval, once per screen (decision 5)

`worklist(userId, role, { limit?, excludeOwnClaims? })`: with `excludeOwnClaims`, the SLA-breached rows
exclude `claimedById: userId`. Home passes `excludeOwnClaims: true` (those rows are in "Claimed by you",
which already shows the SLA and the overdue mark); `/inventory/work` passes nothing and keeps the full list.
The capped-section "N more" count comes from the same query, so it agrees.

---

## 5. One snapshot per page (decision 6)

`src/server/paged.ts`:

```ts
export async function pagedSnapshot<T>(
  size: number, requested: number,
  count: (tx: Prisma.TransactionClient) => Promise<number>,
  rows: (tx: Prisma.TransactionClient, pg: Page) => Promise<T[]>,
  client: PrismaClient = prisma,
): Promise<{ rows: T[] } & Page>
```

One interactive transaction at `RepeatableRead`: `count`, then `pageOf(total, requested, size)`, then
`rows(tx, pg)`. Under PostgreSQL both statements read one snapshot, so the total, the page clamp and the rows
agree. Every list whose count and rows are two database reads adopts it: approvals, audit, admin users,
webhook deliveries, purchases, suppliers, stock items (plain path), stocktakes, employees (plain path),
inventory (plain path), reservations (its count comes from the tab `groupBy`, run inside the same
transaction), and the asset history page. In-memory paths (repair stage, gaps, derived offboarding
progress, cursor timelines) are out of scope. Facet counts that run beside a list stay separate queries.

---

## 6. Reasons (decision 7)

`src/lib/reason.ts`:

```ts
export function cleanReason(raw: string | null | undefined): string; // remove \p{Cf} and \p{Cc}, then trim
export const REASON_MAX = 500;
export const REASON_MESSAGE = "Give a reason (at least 3 characters)";
export function reasonRequired(opts?: { min?: number; max?: number; message?: string }): z.ZodString; // default 3 / 500 / REASON_MESSAGE
export function reasonOptional(opts?: { max?: number }): z.ZodOptional<z.ZodString>;                 // cleaned, may be ""
```

Every reason field uses one of the two (messages, minimums and maximums unchanged per site): `approvals`
(reject), `employees` (:25 optional, :100 required), `exception-actions`, `inventory` (:49 bulk, :457
status request, :590 finance send-back with its own min 5 and message), `offboarding` (:72, and its manual
trim), `purchases` (:29, and its manual trim), `stock-schema` (:51 optional, :59 "Say why" max 200),
`transfer-schema` (:23 max 300), `lifecycle` (`reasonOpt`, and the two MISSING checks read
`cleanReason(d.reason).length < 3`). Unit tests: a zero-width-only reason is refused; `"​ok​"`
cleans to `ok` and is refused at min 3; `"fix"` passes; control characters are removed; the max still holds.

---

## 7. Accessibility (decision 8)

`e2e/axe-sweep.spec.ts` gains: `PROMOTED_RULES`, a set of rule ids that fail regardless of impact; and an
`AXE_DETAIL=1` mode printing `route · rule · impact · target` for every counted (non-failing) node. The task
first runs the sweep with detail to attribute the four tolerated rules (`empty-table-header`,
`page-has-heading-one`, `heading-order`, `landmark-unique`), then fixes each root cause, then adds the four
to `PROMOTED_RULES` and re-runs the sweep clean. Two causes are known already: `Tabs` renders an unlabelled
`<nav>` (it gains a required `label` prop → `aria-label`; callers: record tabs "Record sections", purchases
"Request states", reservations "Reservation states", deliveries "Delivery states"); `Th` with `aria-label`
and no children has no text (it renders `<span className="sr-only">{ariaLabel}</span>`). A rule whose cause
cannot be removed is recorded in the plan's D-block and stays tolerated.

---

## 8. Rate-limit coverage (decision 9)

`e2e/rate-limit.spec.ts`, two cases, fixtures via Prisma on `RateEvent` (the seed truncates it):

1. **Mutation cap.** Sixty `RateEvent` rows (`kind: "mutation"`, `at: now`) for `it@`; on `BR-MN-0910`'s
   record, Change status → DEFECTIVE → Confirm shows the notice "You've made 60 changes this minute — the
   cap" with "you can retry in Ns"; the asset's status is unchanged in the database; deleting the rows and
   confirming again applies the change.
2. **Import cap.** Ten rows (`kind: "import"`) for `admin@`; the employees import of `employees-clean.xlsx`
   reaches the Import step, and Import shows the notice with the import's own message (read from
   `applyEmployeeImport`'s `rateLimited(...)` call); the employee count is unchanged.

---

## 9. Tests

- **Unit:** `parseVia`/`viaWhere`/labels; `pagedSnapshot` sequencing with a fake client; `cleanReason`,
  `reasonRequired`, `reasonOptional`; `directChanges` shaping if factored pure.
- **E2E:** new `e2e/oversight.spec.ts` (7 cases — fresh-seed chips and both filters with pagination hrefs; a
  direct change lands in Closed with the pill and the detail page's "How it was applied"; a queue row keeps
  "What the system checked"; the admin Home section on the admin branch with counts by kind and by whom,
  its link, and focus hiding it; the section on the IT branch for admin and absent for `it@`; the
  double-count — an overdue claim by the viewer appears in "Claimed by you" and not in the worklist, while
  `/inventory/work` still lists it; axe on the Closed tab, a direct detail and the admin Home) and
  `e2e/rate-limit.spec.ts` (2 cases). Updated: `approvals-audit.spec.ts` (Closed 5), `axe-sweep.spec.ts`
  (promoted rules).
- **Battery:** the six chunks of Phase 20 with the two new files added to chunk F.

---

## 10. Documentation

HANDOVER: a new (n) block after (m); §0 item 9 with the measured chunks; the line-3 parenthetical. PICKUP:
Branch, Database (22), a Battery row, Last two phases (21 then 20), §5 gap lines closed (the PENDING-row
gap is answered by oversight, not a pending row). `HANDOVER-PENDING.md` §6: the direct-changes candidate
closed; webhook retention remains. The plan's D-block and this file's Status line.
