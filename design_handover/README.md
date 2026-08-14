# Handoff: Backroom IT — Inventory v2 UI redesign

## Overview

A full visual + IA overhaul of an internal IT asset management system: 39 routes covering asset
lifecycle (purchase → assignment → repair → disposal), an approval queue gating sensitive changes,
an append-only audit trail, four role-gated workspaces, and an offboarding wizard.

The design's central thesis: **this is a dense operational tool, so state must be legible
peripherally and nothing may shift after load.** Two deliverables carry most of the value —
a complete primitive layer (the current app has none, which is why 39 routes each hand-roll their
own controls) and a six-family status system that all ~30 domain enum values map into predictably.

`original-brief.md` in this folder is the client's functional brief. It is the source of truth for
*what each screen must do*; this README covers *how it looks and behaves*.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended
look and behaviour, not production code to copy. The task is to **recreate these designs in the
target codebase's existing environment** (per the brief: Next.js app router, server actions,
`src/app` + `src/components`) using its established patterns. Do not port the HTML structure,
the inline styles, or the demo state machinery.

Specifically **do not** carry over:
- Inline styles (the prototype uses them so it streams; the real app should use its own CSS approach)
- The `.dc.html` wrapper, `<sc-for>` / `<sc-if>` / `x-dc` tags, or `support.js` — prototype runtime only
- The `.dv-turn` / `.dv-opt` scaffolding and the `1a`/`2b`/`7f` badges — those are review affordances
- Hard-coded sample data (asset tags, people, amounts)

**Do** carry over: the token values, the status-family mapping, the motion spec, layout structure,
copy, and the state/interaction rules described below.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, border radii, shadows and motion timings are
all specified and should be reproduced closely. Layout proportions are intentional (column widths,
row heights, the 41px/33px density pair). Copy is final-ish — it was written to be read, and the
microcopy carries real product decisions ("Request swap", not "Save"). Icons are a deliberate
16-item geometric set; reproduce them or map them to the nearest equivalents in an existing icon
library at the same 1.4px stroke weight.

---

## Design tokens

### Colour — light theme

| Token | Value | Use |
|---|---|---|
| `canvas` | `#F6F7F9` | Page background behind cards |
| `surface` | `#FFFFFF` | Cards, tables, inputs |
| `surface-subtle` | `#FCFCFD` | Table headers, card footers, zebra-free row hover |
| `surface-accent` | `#F8FBFE` | Selected/active regions, editor panels |
| `border` | `#E4E7EC` | Card and table borders |
| `border-strong` | `#D0D5DD` | Input borders, segmented controls |
| `border-faint` | `#F2F4F7` | Row separators inside a table |
| `text` | `#101828` | Primary text |
| `text-secondary` | `#475467` | Body copy, table cells |
| `text-muted` | `#667085` | Hints, metadata |
| `text-faint` | `#98A2B3` | Mono metadata, placeholder |
| `accent` | `#2563A8` | Primary buttons, links, focus ring, active nav |
| `accent-hover` | `#1D4E87` | Primary button hover, link hover |
| `accent-soft-bg` | `#EFF6FC` | Accent pill background |
| `accent-soft-border` | `#CFE2F4` | Accent pill border |
| `accent-tint` | `#F2F7FC` | Selected row, active nav item background |

### Colour — dark theme

Dark is **re-derived, not inverted**: surfaces get lighter as they come closer, tint chroma drops so
pills stay quiet, and the accent lifts to hold contrast.

| Token | Value |
|---|---|
| `canvas` | `#0F1115` |
| `surface` | `#171A20` |
| `surface-subtle` | `#1A1E25` |
| `surface-raised` | `#1D2129` |
| `border` | `#262B33` |
| `border-strong` | `#333A45` |
| `border-faint` | `#1E232B` |
| `text` | `#E6E9EF` |
| `text-secondary` | `#C7CDD8` |
| `text-muted` | `#9AA4B2` |
| `text-faint` | `#6B7480` |
| `accent` | `#6AA9E0` (foreground on accent: `#0B1119`) |
| `accent-soft-bg` / `border` | `#152435` / `#274864`, text `#8FC0EA` |

Dark status dots: settled `#34B47C`, in-flight `#6AA9E0`, neutral `#8B95A2`, attention `#E79C33`,
fault `#EF6A5F`, closed `1.5px solid #6B7480` ring.
Dark status pills: settled `#0F2A1E`/`#1D4634`/`#5FD39B`, in-flight `#152435`/`#274864`/`#8FC0EA`,
neutral `#1D2129`/`#333A45`/`#A8B2C0`, attention `#2D2214`/`#4A3A1D`/`#E7B168`,
fault `#2D1917`/`#4D2622`/`#F28B80`, closed `transparent`/`#3A424E`/`#8B95A2`.

### Typography

- **Sans:** `"Helvetica Neue", Helvetica, Arial, sans-serif`
- **Mono:** `ui-monospace, Menlo, monospace` — carries **every** ID, serial, date, count and enum
  value, always with `font-variant-numeric: tabular-nums` so columns align.

| Role | Spec |
|---|---|
| Page title | 20px / 600 / 1.2 / `-0.015em` |
| Card title | 15px / 600 / 1.2 |
| Section heading | 12.5–13px / 600 |
| Body | 13px / 400 / 1.65 |
| Table cell | 12.5–13px / 400 |
| Table cell (mono) | 12–12.5px / 400 |
| Column header | 9.5–10px / 500 / mono / uppercase / `0.06em` |
| Metadata | 10–11px / 400 |
| Status pill | 9.5–10px / 500 / mono / uppercase |
| Eyebrow label | 10px / 600 / mono / uppercase / `0.09em` |

Minimum text size anywhere is 8.5px, used only for label microcopy on printed forms and label sheets.

### Spacing, geometry, elevation

- Spacing steps: **4 / 8 / 12 / 16 / 24 / 34**
- Radius: **8** cards and inputs, **7** buttons and selects, **6** small controls and pills,
  **5** micro pills, **0** inside table cells, **99px** dots and avatars
- Borders: 1px everywhere; 1.5px only on hollow status dots; 2px only on the audit-form rule
- Elevation:
  - card `0 1px 2px rgba(16,24,40,.05)`
  - popover `0 12px 30px -10px rgba(16,24,40,.30)`
  - drawer `-14px 0 34px -10px rgba(16,24,40,.28)`
  - dialog/overlay `0 28px 60px -16px rgba(16,24,40,.50)`
  - toast `0 16px 32px -12px rgba(16,24,40,.55)`
- **Focus ring is always** `outline: 2px solid #2563A8; outline-offset: 2px` — never a colour swap.
  Text inputs additionally get `border-color:#2563A8; box-shadow:0 0 0 3px rgba(37,99,168,.12)`.
- Error input: `border-color:#FDA29B; box-shadow:0 0 0 3px rgba(217,45,32,.08)`

### Density

A **comfortable / compact** toggle, stored in a cookie (like theme and workspace), that changes
**row height only**: 41px → 33px. Font sizes, column widths and paddings do not change, so switching
never re-wraps a cell. Below 1200px compact also drops the avatar and two lowest-priority columns.

---

## The status system (implement this first)

Six semantic families. Every enum in the app maps into exactly one; **nothing gets a bespoke
colour.** The family is decided by *what the row needs from the reader*, not by which enum it came
from — `PENDING` on an approval and `PENDING` on a purchase unit are both Attention because in both
cases somebody must act.

| Family | Dot | Pill bg / text / border | Members |
|---|---|---|---|
| Neutral — exists, at rest | `#667085` | `#F2F4F7` / `#475467` / `#E4E7EC` | `SPARE`, `DRAFT` |
| In flight — someone owes an action | `#2563A8` | `#EFF6FC` / `#1D4E87` / `#CFE2F4` | `SUBMITTED`, `IT_REVIEWED`, `CLAIMED`, reservation `ACTIVE`, M365 `offboarding` |
| Settled — went the right way | `#079455` | `#ECFDF3` / `#067647` / `#ABEFC6` | `DEPLOYED`, `APPROVED`, `COMPLETED`, `EXECUTED`, `FULFILLED`, M365 `active` |
| Attention — fine now, wrong if ignored | `#DC6803` | `#FFFAEB` / `#B54708` / `#FEDF89` | approval/unit `PENDING`, `TEMPORARY`, M365 `pending` |
| Fault — human "no", or a machine broke | `#D92D20` | `#FEF3F2` / `#B42318` / `#FECDCA` | `DEFECTIVE`, `REJECTED`, `EXECUTION_FAILED` |
| Closed — off the books | `1.5px ring #98A2B3`, hollow | `transparent` / `#667085` / `#D0D5DD` | `DONATED`, `BUYOUT`, `DISPOSE`, `CANCELLED`, `EXPIRED`, `RELEASED`, M365 `inactive` |

Two rules that matter:

1. **`EXECUTION_FAILED` must not look like `REJECTED`.** Same Fault hue, but a **dashed** border
   (`1px dashed #F97066`) and a **rotated-square (diamond) mark** instead of a round dot. A system
   failure is not a colleague's decision.
2. **Closed is hollow, never filled.** A terminal record should read as absent.

Unknown/client-defined status values (e.g. a custom M365 status) map to **Neutral** rather than
inventing a colour.

### Where to use which treatment

Three treatments were compared; the chosen combination is:

- **In tables: dot + plain text.** A 7px dot in its own 17–19px column, status text in mono at
  10.5px in `text-secondary`. The dot column becomes a vertical colour strip readable peripherally
  while the row still scans as data.
- **Everywhere else: tinted pill.** Detail page headers, cards, timelines, the approval queue detail.
- Rejected alternative: a row-edge accent bar — strongest peripherally but it double-books the edge,
  where selection and focus live.

The dot is for when status is an *attribute*; the pill is for when status is the *subject*.

---

## Motion spec

Motion does exactly three jobs: confirm a click landed, explain where something came from, and hold
your place while the server catches up. **Nothing animates into its final position on page load**
except a ≤180ms total stagger on freshly fetched rows.

| Duration | Curve | Used for |
|---|---|---|
| 90ms | `linear` | Hover, focus ring, checkbox, pill tint |
| 140ms | `cubic-bezier(.2,0,0,1)` | Menu, popover, tooltip, chip removal |
| 200ms | `cubic-bezier(.2,0,0,1)` | Row enter, skeleton→content swap, tab underline |
| 260ms | `cubic-bezier(.2,0,0,1)` | Drawer, dialog, mobile nav — the only travel over 20px |
| 340ms | `cubic-bezier(.4,0,1,1)` (exit) | Row leave: height→0, opacity→0, translateX 30px |
| 420ms | `cubic-bezier(.34,1.4,.64,1)` | Earned confirmations only: slot filled, approval executed |

Named keyframes used in the prototype:

- `fade` — `opacity 0→1, translateY 7px→0`; row and panel entrance
- `pop` — `scale .84→1.05→1` with opacity; confirmations, checkbox tick, dialog entrance
- `grow` — `scaleX 0→1`, `transform-origin:left`; progress/summary bar reveals
- `ring` — `box-shadow 0 0 0 0 rgba(37,99,168,.4) → 0 0 0 10px transparent`; claim acknowledgement
- `spin` — 700ms linear; pending spinners (1.7–1.8px ring, top border in accent)
- `shim` — background-position `-220px → 220px`, 1.2s linear; skeleton shimmer
- `pulse` — opacity `1 → .45 → 1`, ~1.9s ease-in-out; **the only looping animation in the app**,
  reserved for overdue/SLA-breached indicators
- `toast` — `opacity 0→1, translateY 14px→0, scale .97→1`
- `sheet` / `veil` — `translateX(100%)→0` / `opacity 0→1`, both 260ms, fired together
- `sweep` — travelling highlight `translateX(-110% → 240%)`; decorative overlays only, never for
  filling a bar (use `grow`)

Press feedback: `transform: scale(.965)` for 70ms on `:active` for every button. Below the threshold
of noticing, above the threshold of feeling.

Segmented controls slide their indicator (`left`, 220ms, `cubic-bezier(.34,1.3,.64,1)`) rather than
jumping. Row actions (`⋯`, "Open ⏎") fade in on hover at 120ms.

**`@media (prefers-reduced-motion: reduce)` must set all animation and transition durations to
`0.01ms` and iteration count to 1.** This is a hard requirement, not an enhancement.

---

## Primitives to build

### Missing today — must be created

`Button` (primary / secondary / ghost / danger; sm 6×10 11.5px, md 9×14 13px, lg 11×18 14px;
loading state keeps its width and shows a 11px spinner; icon-only 34×34) · `IconButton` · `Input` ·
`Textarea` · `Select` · `Combobox` (typeahead + result list, keyboard-first) · `Radio` · `Switch`
(32×18 track, 14px knob, knob transition 180ms spring) · `FormField` (label 12px/500, required
`*` in `#D92D20`, hint 11px, error 11px/500 in `#B42318`) · `Table` (sortable headers with numbered
multi-sort badges, row selection with indeterminate state, sticky header, row actions, density-aware)
· `Badge`/`StatusDot` · `Tabs` (2px inset underline in accent) · `Drawer` (right sheet, 376px on
list pages, 252–330px in panels) · `Dialog` (352px, centred, pop entrance — reserved for
irreversible decisions) · `Tooltip` (`#101828` bg, 11px, radius 5) · `Menu`/`Dropdown` ·
`Breadcrumb` (`/` separators in `#D0D5DD`) · `SegmentedControl` · `ProgressBar` (6px, radius 99) ·
`Banner`/`Alert` · `DescriptionList` (96–104px label column) · `Stat`/`KpiTile`

### Existing — redesign, keep the role

`Avatar` (19/20/24/26/34/62px, initials in mono 600) · `Card` · `Checkbox` (16–17px, radius 4–5,
tick pops on check) · `CopyLinkButton` (flips to a green "Copied" pill for 1.8s) · `DatePicker`
(range endpoints solid, span tinted `#EFF6FC`; presets at the bottom) · `DensityToggle` ·
`EmptyState` · `FormError` · `Modal` · `Icon` · `PageHeader` · `Pagination` · `Pill` · `Skeleton`
· `ThemeToggle` · `Toast`

### Composite patterns

`ActivityFeed` (one row = avatar, domain pill, one sentence subject-first, relative time, status dot;
the domain pill is the *only* difference between the five activity routes — scoped logs hide it) ·
`ActivityFilters` · `ChipFilterRow` · `FacetDropdown` (search field, per-option counts, zero-count
options dimmed but present, URL updates only on **Apply**) · `RowActionsMenu` · `SortableHeader` ·
`TimelineList` · `CommandPalette` (⌘K; groups Assets / People / Requests / Actions; `G then P`
style shortcuts; footer legend) · `AttentionCard` · `RecentActivityCard` · `EmployeePicker`

### Icon set

16 icons on an 18×18 grid, 1.4px stroke, square terminals, **geometry only** (rect / circle / line /
polyline / one rotated square), no fills except the alert dot — so an icon never competes with a
status colour:

`laptop` `monitor` `phone` `dock` `headset` `inventory` `employee` `approval` `audit` `search`
`filter` `sla` `alert` `secret` `export` `add`

Anything not on this list ships as a text label rather than a guessed glyph.

---

## Screens

Route paths and query-param contracts are fixed by the brief. Grouped by workspace; the prototype
card id for each is given in brackets so you can find it in the HTML.

### Shell — all workspaces `[1d, 1e]`

- **Sidebar** 238px, white, right border. Brand (24px `#101828` square, "BR" in mono 700) →
  workspace switcher → role-filtered sections → user footer (26px avatar, name 12px/500, role in
  mono 9.5px, `⋯` account menu).
- **Workspace switcher**: 6px accent dot, workspace name 12.5px/600, `br.dept · 4 available` in mono
  9.5px, `▲▼` affordance. Opens a popover listing all four with per-workspace counts. For
  single-workspace roles it degrades to a **static label with no chevron** — not a disabled control.
- **Section headings**: mono 9.5px/500 uppercase `0.08em` in `#98A2B3`. **Nav items**: 12.5px, 7×10
  padding, radius 7; active = `#F2F7FC` background + `inset 2px 0 0 #2563A8` + accent text.
  Trailing count in mono 10px; **Approvals badge** is a pill with a pulsing dot when any item is
  past SLA (`#FEF3F2`/`#B42318`/`#FECDCA`), otherwise neutral.
- Each workspace has a **completely different sidebar** — see the brief §2 for the four IAs. Admin,
  being shortest, uses the workspace name as a heading rather than a switcher.
- **Topbar** 52px: ⌘K search trigger (320px, canvas-filled, `⌘K` kbd chip), then right-aligned
  density toggle, theme toggle, help.
- **Mobile**: sidebar becomes an overlay drawer with backdrop, body scroll locked, focus trapped,
  ESC closes; the hamburger keeps its position so the header never jumps. Tables become two-line
  rows — dot + tag on line one, model + holder on line two. **The asset tag never truncates.**

### Home `/` `[6a` — current; `1d`, `1e`, `5d` for role variants and the degraded state`]`

Role-aware. The redesigned IT version deliberately **has no KPI tile row** — "742 deployed" is a
number nobody acts on, and it was occupying the most valuable strip on the page.

- **Your shift** (main card): 5 rows ordered by *what breaks first*, not recency. Each row = status
  dot, 52px kind chip (`SLA` `EXEC` `HIRE` `LEAVE` `DATA`), title 12.5px/500, mono metadata line,
  and the one action that clears it. Cleared items leave for the rest of the day rather than
  reappearing — the count is a promise, not a feed.
- **Fleet**: one 12px stacked bar over all seven statuses + a legend with counts and shares, then the
  line that matters: *spare pool covers 4 of the 5 slots the incoming hires need*.
- **Age**: 5-bucket histogram (`<1y` … `4y+`), 74px max bar; only the `4y+` bar changes colour
  (`#DC6803`) because it's next year's capex conversation.
- **Claimed by you** sits above the pool — a forgotten claim is worse than an unclaimed item.
- **Warranty runway** (next 90 days) surfaces that two identical laptops expire the same week.
- **Jump to** quick links with counts.
- **Focus** toggle (cookie) drops everything except the queue and your claims.
- **Every section degrades independently.** `1d` shows the failed-section design: a card with a
  `FAILED` pill, an explanation, and a "Retry this section" button, while the rest of the page is
  unaffected.
- Purchasing Home leads with a to-do list + spend; **Finance Home leads with money and age**
  ("₱208k waiting, oldest 2 days"), not counts. Viewer Home is the same layout minus every mutating
  affordance and minus Needs-attention (it's an action queue).

### IT workspace

| Route | Card | Notes |
|---|---|---|
| `/inventory` | `1f` `1g` `7f` | Toolbar: search + 4 facet dropdowns + result count + density. Chip filter row below, echoing the URL verbatim. Selection bar (accent tint) with "Select all 148 matching" and bulk actions. Columns: ☐ · dot · tag(104) · model(flex) · category(84) · assigned(168) · status(88) · purchased(104) · warranty(72) · ⋯(26). Saved views are named URLs; column chooser is per-user, **not** in the URL. Two sort keys max, with numbered badges. |
| `/inventory/new` | `3b` | Three sections in the order a person holding the box reads it: Identity → Procurement → Initial state. Only `SPARE`/`DEPLOYED`/`TEMPORARY` are offered on creation. Derived fields are pre-filled and greyed, never blank. Picking an assignee flips status to `DEPLOYED` and routes through `lifecycle.assign`. |
| `/inventory/[id]` | `3d` | Tabs; DescriptionList overview; warranty as text + mini bar. |
| `/inventory/[id]/edit` | (variant of `3b`) | Same form, populated. |
| `/inventory/[id]/history` | `7c` | **One row per field, not per save.** Struck-through old value → coloured new value. Two rows sharing a timestamp were one action. |
| `/inventory/[id]/timeline` | `7c` `3d` | TimelineList. |
| `/inventory/[id]/documents` | `7c` | Upload states: uploaded, `SIGNED`, in-progress with %, rejected type with the allow-list, plus dropzone. |
| `/inventory/[id]/reservations` | `7c` | Per-asset holds. |
| `/inventory/[id]/secrets` | `3d` | Tab carries an `AUDITED` chip. Masked by default; **Reveal** writes `SECRET_READ` and the row itself shows "revealed 09:41 · hides in 27s". Auto-hide after 30s. |
| `/inventory/activity` | `4b` | ActivityFeed, domain pill hidden. |
| **Repairs** (saved view over `?status=DEFECTIVE`) | `7b` | Stage chips: `TO ASSESS` / `AT VENDOR` / `RETURNED OK` / `BEYOND REPAIR` — **no new enum**, vendor fields on the asset. The **Down** column (days) is what changes behaviour. Detail panel: repair timeline, vendor + RMA + quote, and a warning when the quote exceeds a sensible share of a new unit. |
| `/employees` | `3a` | Two columns a normal HR list wouldn't have — **Items** and **Loadout** (`complete` / `n missing`) — because those are why IT opens this page. "Policy gaps only" is a highlighted filter. |
| `/employees/[id]` | `1i` `7d` | **The loadout view** — see below. |
| `/employees/[id]/edit` | `4f` | M365 status is a **Select sourced from the tenant directory** with the four canonical values plus a `custom…` option for client-defined values (stored as-is, mapped to Neutral). A never-synced account shows `no sync yet`, never a false `inactive`. Save morphs idle → spinner → ✓ Saved and holds its width. |
| `/employees/[id]/timeline` | `7g` | One person's story, links out to the signed form. |
| `/employees/activity` | `4b` `7g` | Same renderer as above. |
| `/employees/[id]/form` | `7e` | **Printable equipment accountability form** — letterhead, employee block, item table with serials and issue dates, acknowledgement paragraph, two signature rules, and a scan code. Generated from live records, not typed; the signed scan uploads back to the employee's documents. Also generated at offboarding. |
| `/approvals` | `1k` `2c` | Tabs Open / Mine / Unclaimed / Failed / Closed. Columns: dot · id(82) · change(flex, 2 lines) · priority(84) · SLA(106) · owner(96) · state(104). Owner `—` means unclaimed; **rows you own get no highlight** — the Owner column suffices and tinting would collide with the status dot. Overdue SLA is 600 weight in `#B42318`. |
| `/approvals/[id]` | `1k` | Header (id, state pill, priority pill, SLA line), **What the system checked** (3 machine findings with dots), **Before → after** panel, then actions. **Approve only appears after you claim** — you can't approve what you don't own, so the button doesn't exist rather than sitting disabled. Separate cards for `EXECUTION_FAILED` (with the worker error verbatim and Retry / Reject instead) and for background-pending execution. |
| `/audit` | `3g` | Filter bar + 5 columns. **No row menus, no checkboxes, no hover actions — the absence is the design.** The only interaction is following an entity link. |
| `/offboarding` | (list; `6a` row + `3e` detail) | Queue of employees pending offboarding. |
| `/offboarding/[employeeId]` | `3e` `5b` | **4-step wizard**: Review holdings → Collect items → Accounts & M365 → Farewell report. Per item, a 4-way segmented control: Returned / Defective / Buyout / **Missing** — Missing is first-class; pretending everything comes back is why spreadsheets drift. A reason is required for anything other than Returned. Each decision creates its own `lifecycle.return` approval immediately, so a half-finished offboarding is still N correct records. Continue is blocked while any item is undecided. Step 4 is a receipt naming outcomes and value recovered, exportable and emailable to HR. |
| `/reservations` | `5c` | Reserved stock **still shows as `SPARE`** in inventory with a hold marker — pretending it's gone creates phantom spares. `EXPIRED` (clock) and `RELEASED` (person) both sit in Closed but stay distinguishable. |
| `/admin/equipment-policies` | `4a` | Per department/role standard loadout. Solid chips = required (an unfilled one is the policy gap that lights up elsewhere), grey = optional. Role policy beats department policy. Editing never touches existing assignments — it changes what counts as complete from that moment, which is why the audit entry records both slot lists. |
| `/admin/asset-categories`, `/asset-types`, `/departments` | `4c` | **One table design serves all three.** Inline add row rather than a dialog — reference data is entered in batches. `Uncategorised` is a locked row. |

### Loadout view — `/employees/[id]` `[1i, 7a, 7d]`

The distinctive screen. Equipment policies already define a fixed set of expected items per role, so
"what does this person have" and "what are they missing" become the same glance.

- **Left, 250px:** character panel — 62px avatar, name, title · department, `EMP-0042 · joined …` in
  mono, **Loadout vs policy** progress bar (filled accent + hatched amber remainder) with `6 / 8`,
  the policy name, then a 2×2 stat grid (items held, book value, oldest item, open requests).
- **Centre:** slot grid, 4 columns, 11px gap. A **filled tile** is a 56px striped image placeholder
  (drop real product shots here) with a status dot, then slot name in mono 10.5px, model 11.5px/500,
  asset tag in accent mono, and a footer with age + hover actions (`⇄` swap, `−` return).
  An **empty tile** is dashed, `box-sizing:border-box`, with a 30px `+` circle, the slot name, and
  `type · required|optional`. **An empty required slot is a visible policy gap.**
- **Holding area** below: reserved items and items whose assignment is queued (background-pending),
  plus a "Reserve an asset" affordance.
- **Right, 296px:** the fill-slot panel (spare picker with availability and "held by X · needs
  transfer" for non-spares, reason, Request assign) and this person's history.
- A **Slots / Table** toggle keeps the dense list one click away.
- Keyboard: arrows move between slots, `Enter` opens the filler, `Backspace` starts a return. Each
  tile is one button with an accessible name like "Headset slot, empty, required".
- **Every `+` and `−` opens a request, not a write.** Tiles show a pending badge until execution.
- States: **day one** (all slots empty, reads as a checklist, one button assigns everything already
  reserved), **leaving** (slots frozen — no `+` on a leaver — with an offboarding progress card
  linking into the wizard), **never synced / holds nothing**.

### Purchasing workspace

| Route | Card | Notes |
|---|---|---|
| `/purchases` | `4d` `1h` | Tabs write `?state=`; the sidebar's "By status" links land on them. A second line under State carries *how long it's been there* ("back from finance", "awaiting finance 2 d") — not derivable from the enum. |
| `/purchases/new` | `3f` | Units as editable rows, not a repeated form. Autosaved DRAFT chip. "Add from a policy loadout". Vague specs are allowed on submit (that's what IT review is for); prices are not. |
| `/purchases/[id]` | `1j` | **The bounce-back is the design problem.** A red-left-bordered banner names who sent it back, when, the verbatim reason, and the transition (`IT_REVIEWED → SUBMITTED · nothing was cleared`), with "Jump to unit 04" and "Reply in thread". A 4-stop stepper shows the loop explicitly: the return path is a dashed amber/red connector labelled "← sent back", and `SUBMITTED` is marked `NOW · 2nd time`. Per-unit rows carry their own `PENDING/APPROVED/REJECTED/CANCELLED` state, readable alongside the header state. Role-specific editors (IT slot editor / Finance unit editor) appear inline on the same page; saving a unit does **not** re-submit the request. The notes field is an **append-only thread** across three parties, rendered as a conversation with actor + action chip + timestamp — never a textarea that overwrites. |
| `/purchases/[id]/edit` | (variant of `3f`) | Draft editing. |
| `/purchases/activity` | `4b` | ActivityFeed. |

### Finance workspace

`/finance/assets` (capitalized/approved assets — table pattern of `1f` with value columns),
`/finance/activity` `[4b]`, plus `/purchases` and `/approvals` with filters applied. Finance Home
`[5d]`.

### Admin workspace `[3h]`

`/admin/users` — role selects per row, **except the permanent admin**, which shows a `LOCKED` chip
and static text and is tinted one step back. The constraint is stated before the click, never
discovered through a failed save. `/admin/webhooks`, `/admin/webhooks/deliveries` (delivery attempts
with `DEAD · 5/5` dead-letter rows and "Replay 4 dead-lettered"), `/admin/flags` (switch rows with
a description line).

### Auth `[3i]`

`/login` — centred 11px-radius card on canvas: brand, "Sign in", domain note, **Continue with
Microsoft** (when the SSO flag is on), OR divider, email + password, primary button, and a line
explaining that signup is domain-restricted and role decides where you land.
`/signup` — same shell, domain-restricted.
`/bootstrap` — first-run admin creation, presented on the **dark** surface to mark it as a
once-only screen: name, admin email, allowed domain (with the note that it's changeable later under
Flags), and "Create admin and open IT". Permanently 404s afterwards — design it anyway; it's the
first screen anyone ever sees.

### Import / export `[5a, 1m, 7g]`

- **Import**: 3-step stepper — Upload → Validate → Results. Validation is an explicit **dry run**
  ("no writes yet"): the whole verdict arrives at once rather than a climbing counter. Results show
  a proportional bar (`grow` reveal), counts of new / updates / blocked, and blocked rows
  **grouped by cause** — 18 identical "duplicate serial" lines is a wall; one line with a fix button
  ("Update instead", "Create category", "Leave as spare") is a decision. **Partial import is the
  default.** Rate limited to 10 imports/min.
- **Export**: at the 10,000-row cap, refuse rather than truncate silently, and offer split-by-year
  chips sized to their counts.
- **Label sheet**: printable 3×4 A4 sheet of asset tags with scan codes, printed straight from a bulk
  selection or a completed purchase so sticker and record are created in the same minute.
- **Scanning**: a USB scanner is just a keyboard — any screen with search focused accepts a scan, an
  exact tag match opens the record instead of listing it, and in the offboarding wizard a scan ticks
  the matching row.

---

## Every screen's states `[1b, 1m, 7f]`

Design these explicitly; inconsistency here is half the "clunky" feeling.

- **Loading** — skeletons match the final row rhythm exactly (41px comfortable / 33px compact) and
  the same column widths, so the swap is a cross-fade, not a jump. Shimmer, not spin — a skeleton
  has a shape to promise. Rows fade up 7px on a 55ms stagger; beyond ten rows the stagger stops
  incrementing rather than turning a table into a wave.
- **Empty — two different sentences.** "Nothing exists yet" offers the create + import actions;
  "your filters matched nothing" states the filter count and offers **Clear filters**. Never one
  generic "no results".
- **Error** — a failed section inside a working page: red-bordered card, plain explanation, "Retry
  section". The rest of the page renders.
- **Forbidden** — one line and a door back to the role's own workspace. Redirect server-side; this
  screen only appears on a direct link.
- **Read-only (viewer)** — mutating affordances are **absent, not disabled**; one `READ-ONLY · VIEWER`
  badge in the page header explains why. No row menus, no checkboxes.
- **Rate-limited** — amber card, "You've made 60 changes this minute — the cap", an explicit
  "**Nothing was lost:** this form still holds your input", and a countdown bar that retries
  automatically.
- **Optimistic / pending** — buttons show progress, keep their width, and prevent double-submit.
- **Background-pending** — an approved approval queued for async execution gets its own card with a
  pulsing dot and the honest caveat that the asset still reads `SPARE` everywhere else.

---

## Interaction & state summary

State that must exist in the real app (the prototype fakes it with local component state):

| Concern | Where it lives | Notes |
|---|---|---|
| Filters, sort, page, tab | **URL search params** | Fixed contract. Sort is one `sort` param: `-purchasedAt,model`. Tabs write `state`. |
| Active workspace | Cookie `br.dept` | Drives which sidebar renders. |
| Theme | Cookie | Light / dark / system. |
| Density | Cookie | Row height only. |
| Column visibility & order | Per-user preference (**not** URL) | A shared link shows your columns, not theirs. |
| Focus mode (Home) | Cookie | Collapses Home to the queue. |
| Saved views | Named URLs | `Repairs` is just `?status=DEFECTIVE&sort=-updatedAt`. |
| Row selection | Component state | Indeterminate for page-vs-all; "Select all N matching" acts on the filter, not the page. |
| Facet draft selection | Component state | URL updates only on **Apply**. |
| Approval claim/approve | Server actions | Claim rings the dot (700ms, no layout change); approve collapses the row out (340ms exit) and the sidebar badge decrements **only after the row is gone** — the moment it becomes true. |
| Slot fill | Server action → approval | Tile: pop on request → shimmer + pending approval badge → green sweep + ring on execution. Tag and model appear **immediately** on request, greyed by the shimmer rather than absent, so nothing moves when execution lands. |
| Save (forms) | Server action | Button morphs idle → `Saving…` → `✓ Saved` (reverts after ~3s), plus a green "audit entry written" line. Width is constant. |
| Copy link | Clipboard | Flips to a `Copied` pill for 1.8s. |
| Secret reveal | Server action, audited | 30s auto-hide, `SECRET_READ` written, reveal visible in the row. |
| Import | Dry-run validate → commit | Two calls; the first writes nothing. |

Accessibility requirements (axe runs in the e2e suite): skip link, visible focus rings, labelled
controls, ESC closes every overlay, focus trapped in drawer/dialog and returned on close, correct
roles and landmarks, and keyboard paths for the queue (`J`/`K` move, `C` claim, `A` approve,
`R` reject, `E` escalate) and the loadout grid.

---

## Assets

No real imagery was available. Everywhere a product photo belongs — loadout tiles, holding-area
items, policy chips, document thumbnails — the prototype uses a **striped CSS placeholder**
(`repeating-linear-gradient(135deg, #EEF1F5 0 6px, #F7F9FB 6px 12px)`) with a mono label naming
what goes there (`laptop`, `monitor`, `headset`). Replace these with real asset photography or
category illustrations; keep the aspect ratios.

Scan codes and barcodes are also placeholders (striped gradients) — generate real ones from the
asset tag.

No brand fonts or logos were supplied; the wordmark is a 24px dark square with "BR" in mono 700.
Swap in the real mark.

## Files in this bundle

| File | What it is |
|---|---|
| `Inventory v2.dc.html` | The full design — 7 review turns, ~50 cards, several interactive. Open in a browser with `support.js` beside it. |
| `support.js` | Prototype runtime. **Not part of the deliverable.** |
| `original-brief.md` | The client's functional brief: routes, enums, workflow rules, constraints. |

### How to read the design file

The page is a review canvas, newest work at the top. Each `<section class="dv-turn">` is one round
of work, each `.dv-opt` is one card with a stable id badge (`1a`, `2b`, `7f`…). Those ids are
referenced throughout this README so you can jump to any screen. Cards marked interactive respond to
clicks — `2b` slot fill, `2c` claim/approve, `2d` skeleton→rows, `2e` drawer, `4f` M365 select and
Save, `4g` press states, `5a` import, `5e` dialog and facet, `6a` Focus, `7f` column chooser.

Reading order for implementation:

1. `1a` foundations and the status system → build tokens and `StatusDot`/`Badge` first
2. `1b` primitives sheet → build the primitive layer
3. `2a` motion spec → wire the durations and curves as tokens
4. `1d`/`1e` shell → then screens in whatever order the roadmap wants

## Open items

- The three `/inventory/[id]` sub-tabs exist as full-page designs in `7c`; the `Overview` tab's
  full-page treatment is in `3d`.
- Vendor management for repairs (`7b`) assumes a vendor list exists; if it doesn't, it needs a
  small reference-data table like `4c`.
- Real copy for the accountability form's acknowledgement paragraph (`7e`) should be reviewed by
  whoever owns HR policy.
