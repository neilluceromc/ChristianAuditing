# Backroom IT — Inventory v2: UI Redesign Brief

A functional brief for a full visual + IA overhaul. Everything below describes **what each screen must do**. Visual direction is deliberately unspecified — that's the design work.

---

## 1. What this product is

An internal IT asset management system for a single company (~1 office, team-scale, not multi-tenant). It tracks physical IT equipment from purchase through assignment to an employee, through repair/replacement, to disposal — with a full immutable audit trail and an approval workflow gating sensitive changes.

It is a **dense, operational back-office tool**, not a consumer app. Users are staff doing repetitive record work: looking things up, filtering long lists, filling forms, approving requests. Speed of scanning and low click-cost matter far more than visual delight.

**Primary jobs to be done:**
- "Who has this laptop?" / "What does this person have?"
- "Register the equipment we just bought and route it for approval."
- "Approve or reject this pending change."
- "This person is leaving — collect their equipment."
- "Show me what changed and who changed it."

---

## 2. Users and workspaces

Five roles. The app is organised into **four workspaces** ("departments"), and a role determines which workspaces it may enter. The active workspace is stored in a cookie (`br.dept`) and switched via a workspace switcher at the top of the sidebar. **Each workspace has a completely different sidebar.**

| Role | Workspaces allowed | Default landing |
|---|---|---|
| `admin` | IT, Purchasing, Finance, Admin | `/` (home) |
| `it_staff` | IT | `/inventory` |
| `purchasing_staff` | Purchasing | `/purchases` |
| `finance_staff` | Finance | `/finance/assets` |
| `viewer` | IT (read-only) | `/inventory` |

Only `admin` sees the switcher meaningfully — everyone else is locked to one workspace. Design the switcher so it degrades gracefully to a static workspace label for single-workspace users.

### Workspace sidebars (current IA — treat as the requirement, not the solution)

**IT** — Overview: Home · Tracking: Inventory, Employees, Approvals, Audit log · People lifecycle: Offboarding, Equipment policies, Reservations · Records & admin *(admin/it_staff only)*: Asset categories, Asset types, Departments · Activity logs: Inventory activity, Employee activity

**Purchasing** — Overview: Home · Procurement: All requests, Register purchase, Activity log · By status: My drafts, Awaiting IT, Awaiting finance, Completed · Reference: Inventory

**Finance** — Overview: Home · Capitalized assets: Approved assets, Activity log · Approvals & spend: PR approvals · By status: Awaiting finance, Approved, Cancelled, All purchases

**Admin** — Overview: Home · Identity & access: Users & roles · Integrations & flags: Webhooks, Feature flags

Note the "By status" pattern: these are just saved filters on a list page (`/purchases?state=SUBMITTED`). The nav must show one of them as active when the URL's query params match. **A redesign should decide whether saved-filter-links-as-nav is the right pattern or whether it belongs in the list page itself.**

The sidebar also carries a **live badge** on Approvals (open count, with an "urgent" variant when any are past SLA).

---

## 3. Hard constraints — do not break these

1. **The server contract is fixed.** All data comes from existing server actions and queries. The redesign must not require new backend endpoints. Forms submit via server actions; lists are server-rendered with URL search params driving filters/sort/pagination.
2. **URL is the source of truth for list state.** Filters, sort, page, and tab selection all live in query params so views are linkable and shareable. Preserve this.
3. **Role gating is real, not cosmetic.** Anything a role can't do must not render an action they'll get a 403 from. Design "forbidden" and "read-only" as first-class states.
4. **Light and dark themes both ship**, with an explicit toggle.
5. **A comfortable/compact density toggle ships** and materially changes row heights in tables.
6. **Keyboard and screen-reader support are tested** (axe runs in the e2e suite). Skip link, focus rings, labelled controls, ESC-closes-overlay, and correct roles/landmarks are requirements.
7. **Responsive down to mobile.** The sidebar becomes a drawer with a hamburger and backdrop; body scroll locks while open.

---

## 4. The component system to design (this is the core ask)

The current app has **no primitive layer** — no shared Button, Input, Select, Table, or Form component exists, so all 39 routes hand-roll their own. This is the root cause of the inconsistency. **The most valuable output of this redesign is a complete primitive set.**

### Primitives that must be designed (currently missing)

`Button` (variants: primary, secondary, ghost, danger; sizes; loading + disabled states, icon-only) · `IconButton` · `Input` · `Textarea` · `Select` · `Combobox` · `Radio` · `Switch` · `FormField` (label + hint + error + required marker) · `Table` (sortable headers, row selection, sticky header, row actions, density-aware, zebra optional) · `Badge`/`StatusDot` · `Tabs` · `Drawer` (right-side sheet) · `Dialog` · `Tooltip` · `Menu`/`Dropdown` · `Breadcrumb` · `SegmentedControl` · `ProgressBar` · `Banner`/`Alert` · `DescriptionList` (key–value detail blocks) · `Stat`/`KpiTile`

### Primitives that already exist (redesign, keep the role)

`Avatar` · `Card` (+ `CardHeader`, `CardBody`) · `Checkbox` · `CopyLinkButton` · `DatePicker` · `DensityToggle` · `EmptyState` · `FormError` · `Modal` · `Icon` (named icon set) · `PageHeader` · `Pagination` · `Pill` · `Skeleton` · `ThemeToggle` · `Toast`

### Composite patterns that already exist (redesign, keep the role)

`ActivityFeed` (cross-domain event stream, optional domain pill per row) · `ActivityFilters` · `ChipFilterRow` (active filters as removable chips) · `FacetDropdown` (multi-select filter) · `RowActionsMenu` · `SortableHeader` · `TimelineList` (per-record chronological history) · `CommandPalette` (global ⌘K search/jump) · `AttentionCard` (things needing action) · `RecentActivityCard` · `EmployeePicker` (typeahead)

---

## 5. Domain vocabulary the UI must express

These are real enums. The design needs a consistent, legible treatment for each set — and they must be distinguishable at a glance in a dense table.

**Asset status** (7): `DEPLOYED` · `SPARE` · `DEFECTIVE` · `DONATED` · `TEMPORARY` · `BUYOUT` · `DISPOSE`

**Purchase request state** (5): `DRAFT` → `SUBMITTED` → `IT_REVIEWED` → `COMPLETED`, plus `CANCELLED`

**Purchase unit state** (4): `PENDING` · `APPROVED` · `REJECTED` · `CANCELLED`

**Approval state** (6): `PENDING` · `CLAIMED` · `APPROVED` · `REJECTED` · `EXECUTED` · `EXECUTION_FAILED`

**Approval type** (5): `lifecycle.assign` · `lifecycle.replace` · `lifecycle.transfer` · `lifecycle.return` · `lifecycle.change-status`

**Reservation state** (4): `ACTIVE` · `FULFILLED` · `RELEASED` · `EXPIRED`

**Microsoft 365 account status** (4): `pending` · `active` · `offboarding` · `inactive`

Design guidance: that's ~30 distinct status values across the app. A single flat palette of coloured pills will not scale — the design needs a **system** (e.g. semantic families: neutral/in-progress/success/warning/danger/terminal) that any of these maps into predictably.

---

## 6. The two workflows that carry the product

### 6.1 Purchase request lifecycle

A three-party handoff: Purchasing drafts → IT specs it → Finance approves the money.

```
DRAFT ──submit──▶ SUBMITTED ──it-review──▶ IT_REVIEWED ──complete──▶ COMPLETED
  ▲                   │  ▲                      │
  └───it-reject───────┘  └──request-info────────┘
        (back to DRAFT)        (back to SUBMITTED)

any non-terminal state ──cancel──▶ CANCELLED
```

Exact rules:
- **submit** — only from `DRAFT`. Stamps `submittedAt`.
- **it-review** — only from `SUBMITTED`. Stamps reviewer + timestamp, may attach notes.
- **it-reject** — only from `SUBMITTED`; sends it **back to `DRAFT`** so purchasing can edit and resubmit. Reason is *appended* to existing notes, never overwritten.
- **request-info** — Finance bouncing it back; only from `IT_REVIEWED`, returns to `SUBMITTED` so IT can revisit per-unit fields without losing captured data. Reason appended to notes.
- **cancel** — from anything except `COMPLETED`/`CANCELLED`. Requires a reason.
- **complete** — only from `IT_REVIEWED`.

**Design implications:** rejection is a *loop*, not a dead end — the UI must make "this came back to you, and here's why" unmissable. The notes field is an append-only conversation log across three parties; it deserves better than a textarea. Each request also contains **multiple units**, each with its own `PENDING/APPROVED/REJECTED/CANCELLED` state — so a request's header state and its per-row unit states must be readable together without confusion. There are dedicated per-role editing surfaces (an IT slot editor and a Finance unit editor) on the same detail page.

### 6.2 Approval queue

Gates sensitive asset lifecycle changes. Claim-based, so two people don't work the same item.

```
PENDING ──claim──▶ CLAIMED ──approve──▶ APPROVED ──▶ EXECUTED
   │                  │                     │            ▲
   │                  └──release──▶ PENDING └─▶ EXECUTION_FAILED
   │                                                     │
   └──────────────reject──▶ REJECTED ◀──────────────────┘
```

Exact rules:
- **claim** — only from `PENDING`; assigns to the claiming user.
- **release** — only from `CLAIMED`; returns to the pool.
- **approve** — only from `CLAIMED`. You must own it to approve it.
- **reject** — from `PENDING`, `CLAIMED`, or `EXECUTION_FAILED`. Reason required.
- **escalate** — from `PENDING` or `CLAIMED`; changes priority, keeps state.
- Execution is asynchronous (background worker): `APPROVED` → `EXECUTED` or `EXECUTION_FAILED`. A failed execution can be retried or rejected.
- `REJECTED` and `EXECUTED` are terminal.

**Design implications:** the queue needs to communicate ownership ("mine" vs "unclaimed" vs "someone else's"), **priority/escalation**, and **SLA breach** — the sidebar badge turns urgent when items are overdue. `EXECUTION_FAILED` is a genuinely different thing from `REJECTED` (system failure vs human decision) and must not look similar.

---

## 7. Screen inventory

39 routes. Grouped by workspace.

### Shell (all workspaces)
- **App shell** — sidebar (brand, workspace switcher, role-filtered sections, collapse toggle, user footer with account menu + sign out) + topbar + main content. Mobile: sidebar becomes an overlay drawer.
- **Command palette** — global keyboard-invoked search/jump across records.

### Home — `/`
Role-aware dashboard. Composed of: KPI tiles (different sets for IT / Purchasing / Finance / viewer), a **Needs attention** card (integrity findings + SLA-breached approvals), a **Recent activity** card (merged cross-domain feed), a **Recent purchases** list with inline state filters, and role-specific quick links. Every section degrades independently — if one query fails the rest of the page still renders. **Design the degraded state, not just the happy one.**

### IT workspace
- `/inventory` — main asset list. Filtering, faceted search, sorting, pagination, density, bulk selection → bulk action drawer, export.
- `/inventory/new` — create asset form.
- `/inventory/[id]` — asset detail.
- `/inventory/[id]/edit` — edit form.
- `/inventory/[id]/history` — change history.
- `/inventory/[id]/timeline` — chronological event timeline.
- `/inventory/[id]/documents` — attached documents.
- `/inventory/[id]/reservations` — reservations against this asset.
- `/inventory/[id]/secrets` — sensitive credentials. **Reads are audited** (`SECRET_READ`); treat reveal as a deliberate, logged action.
- `/inventory/activity` — inventory-scoped activity log.
- `/employees` — employee list.
- `/employees/[id]` — employee detail with assigned equipment.
- `/employees/[id]/edit` — edit form.
- `/employees/[id]/timeline` — employee event timeline.
- `/employees/activity` — employee-scoped activity log.
- `/approvals` — approval queue (see 6.2).
- `/approvals/[id]` — approval detail with claim/approve/reject/escalate actions and a recommendation summary.
- `/audit` — full immutable audit log, filterable. Append-only by DB trigger.
- `/offboarding` — employees pending offboarding.
- `/offboarding/[employeeId]` — **multi-step wizard** collecting equipment back from a departing employee.
- `/reservations` — reservation list.
- `/admin/equipment-policies` — per-role/department standard equipment definitions.
- `/admin/asset-categories`, `/admin/asset-types`, `/admin/departments` — reference data CRUD tables *(admin/it_staff only)*.

### Purchasing workspace
- `/purchases` — request list, filterable by state.
- `/purchases/new` — create request (multi-unit form).
- `/purchases/[id]` — request detail: header state, per-unit rows, notes thread, and role-specific editors (IT slot editor / Finance unit editor / IT review view).
- `/purchases/[id]/edit` — edit a draft.
- `/purchases/activity` — purchasing activity log.

### Finance workspace
- `/finance/assets` — capitalized/approved assets.
- `/finance/activity` — finance activity log.
- (shares `/purchases` and `/approvals` with filters applied)

### Admin workspace
- `/admin/users` — users and role assignment. Note: there is a permanent admin account whose role cannot be changed — the UI must express that as a locked row, not a failed action.
- `/admin/webhooks` — webhook endpoint config.
- `/admin/webhooks/deliveries` — delivery attempts, including dead-lettered ones.
- `/admin/flags` — feature flags.

### Auth (outside the app shell)
- `/login` · `/signup` · `/bootstrap` (first-run admin setup). Optional Microsoft 365 SSO with a domain allowlist — when enabled, sign-in offers a Microsoft button and email/password signup is restricted to the allowed domain.

### Non-visual routes
Exports (`assets`, `audit`, `employees`, `farewell-report`) produce Excel downloads and **error at a 10,000-row cap** rather than silently truncating — design the cap-exceeded message. Imports (`assets`, `employees`) accept spreadsheet uploads and are rate-limited; design the upload → validate → per-row results flow, including partial failure.

---

## 8. States every screen needs

Design these explicitly — the current app handles them inconsistently, which is half the "clunky" feeling.

- **Loading** — server-rendered with streaming; skeletons should match final layout to avoid shift.
- **Empty** — distinguish "nothing exists yet" (offer the create action) from "your filters matched nothing" (offer clear-filters).
- **Error** — a failed section inside an otherwise working page (see Home).
- **Forbidden** — role lacks permission; redirect to their workspace home rather than showing a dead end.
- **Read-only** — `viewer` role sees data with all mutating affordances absent.
- **Rate-limited** — mutations are capped at 60/min per user, bulk imports at 10/min. Needs a real message.
- **Optimistic/pending** — server actions in flight; buttons must show progress and prevent double-submit.
- **Background-pending** — an approved approval is queued for async execution and isn't done yet.

---

## 9. What good looks like

- A dense table of 50 assets is scannable in one pass; status is identifiable peripherally, without reading text.
- A purchasing user landing on a bounced-back request understands *why* it came back within two seconds.
- An approver can clear a queue of 20 items using the keyboard.
- Nothing shifts, flashes, or reflows after load.
- The same concept (a status, a date, a person, a record link) looks identical on every one of the 39 screens.

---

## 10. Out of scope

Backend, database schema, server actions, migrations, job queue, auth mechanics. The redesign replaces `src/app` presentation and `src/components` only. Route paths and query-param contracts stay as-is unless a change is explicitly agreed.
