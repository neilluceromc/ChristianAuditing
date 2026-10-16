# Phase 37 — Client staff, equipment policies per client, and a better employee profile

**Status:** CODE-COMPLETE 2026-10-17 on branch `phase-37-clients-profile` (final code tree `b1f3c66`), UNMERGED and UNPUSHED; designed 2026-10-16 with the user, on the mockup canvas
(https://claude.ai/artifact/XSKxwmMGNTvFpGHdUWujdz: boards Main, AddSlot, NewHire, Org and Policies).
The user approved the mockups and said to proceed through development overnight. Merge, push and redeploy
stay the user's calls. **One migration (the 32nd): schema plus a guarded data step.**

## 1. What the user asked for, and why

**The business is an offshoring company.** Employees are either:
- **internal staff**, who belong to an internal department (Finance, HR, IT, Operations, Sales …); or
- **client staff**, who work on a client account.

Today the app only knows departments. With about 40 clients and 15 departments to come, people features must work
for both.

**The profile page is uneven and hard to act on.** On `/employees/<id>` the user said:
- the slot tiles are not aligned or symmetrical;
- loan information is duplicated (the slot, plus a separate On loan box);
- "Add a slot" offers a list of nonsense options. It is every IT type by its bare name, so "Standard", "Wired"
  and "Wireless" appear with no category.

**The user's choices, from the mockups:**
- **Profile layout A:**
  - an identity band across the top;
  - equal-size equipment tiles, required gaps first;
  - a loan shown as a status on its tile, not a separate box;
  - a ⋯ menu per tile;
  - clicking a held item opens a **side panel** with its details and actions.
- **Notes:** a dated note log on the person. The author can edit or delete their own notes; Admin can delete any.
- **IT setup on the profile:**
  - Entra / Intune connected, Autopilot and Argus, each Done / Not yet / Not needed;
  - **which VPN** they use: None, Cloudflare WARP, OpenVPN, or Other with a name.
  - The checklist belongs to the person. "Not yet" shows only on the profile, not on the Worklist or Home.
- **Add a slot:** pick a category first, then that category's types. There is **no name box**: the label fills itself.
- **Add an employee in 3 steps:**
  1. **Details**, including "Works for: Internal | Client staff" and Accounts & access.
  2. **Equipment**: a spare for each slot, or leave it as a gap.
  3. **Check & create**.

  A live policy panel sits beside the steps.
- **Departments & clients:** one page with two tabs, searchable and filterable so 40 clients stay manageable.
- **Equipment policies per client:** the user rejected a shared "kit" given to many clients. Each client and each
  department has **its own** list, chosen from a searchable list. A new list can **start from a copy** of another;
  the copy is independent afterwards. The page stays in the IT workspace.
- **No "Slot" text box in the policy editor.** The label comes from the category or type.

**Success** means:
- A person can be created as client staff for a client.
- That client's own policy decides their equipment gaps.
- The profile shows tiles of one size with one place per item.
- Notes and IT setup live on the person.
- Nobody types a slot name again.

## 2. Staff model: departments and clients

### 2.1 Data
- **One table for both.** A client is a `Department` row with a new `kind`:
  - `enum GroupKind { INTERNAL CLIENT }`, with `Department.kind GroupKind @default(INTERNAL)`;
  - `Department.archivedAt DateTime?`, where null means active.

  So `Employee.departmentId`, transfers, policies, requests, stock issues, filters and exports all work unchanged
  for clients. **Every existing row becomes INTERNAL.** Names stay unique case-insensitively across both kinds
  (the existing `Department_name_lower_key`), so a client cannot share a department's name.
- **Words.** The UI calls the pair "**Works for**".
  - An internal row reads as its name.
  - A client row reads as its name plus a small "Client" tag wherever an employee's group is shown: the profile,
    the employees list and the employee export.
- **Archived (internal) / Ended (client)** rows:
  - keep their history and their people;
  - leave every picker for new choices: the new-employee picker, the transfer picker, the purchase request's
    department, and the stock issue's department. An edit form still shows the current value when it is archived.
  - are blocked in import, with block cause `archived-department` and the text
    "{name} is archived — restore it first or pick another".

### 2.2 The Departments & clients page (`/admin/departments`)
This replaces the shared `RefTable` view for departments; categories and types keep `RefTable`.
- **Roles** are unchanged: admin and it_staff.
- **Placement:** the nav label becomes "Departments & clients", in IT → Records & admin.
- **Layout**, as on the Org board:
  - **Tabs:** Clients | Internal departments, each with its active count. `?tab=client|internal`; the default is
    `client`.
  - **Three cards:**
    1. Active clients (or Departments);
    2. People: active people in active rows;
    3. "Without an equipment policy", with a "Show them" link that sets the filter to **No policy**.
  - **Toolbar:**
    - a search box ("Find a client…" / "Find a department…") matching a substring of the name, case-insensitively;
    - segmented filters with counts: **Active · No policy · Ended** (Archived on Internal) **· All**; the default
      is Active;
    - **+ Add client** (or **+ Add department**), which opens one inline row with a name box, Add and Cancel.
      Typing a name that exists in either kind shows "A department or client with that name already exists" and
      disables Add.
  - **Table:**
    - columns: Name (with a sub-line "Client account" / "Internal department", or "Ended {date}" / "Archived
      {date}"), People, Equipment policy, Status, and actions;
    - it scrolls in its own box, with a sticky header, max height 520 px;
    - Name and People sort when their headers are clicked; names sort naturally, so 2 comes before 10.
    - The Equipment policy cell shows "{n} items", linking to that group on Equipment policies, or "No policy ·
      Set one up" with the same link.
    - **Row actions:** Rename (inline), and **End account** / **Archive** (when active) or **Restore** (when
      archived). A `locked` row shows the LOCKED pill and no actions, as today.
  - **Footer:** "Showing {shown} of {total}." plus one line saying what ending or archiving means:
    - for clients: "Ending a client account keeps its history and takes it off the "Works for" list for new hires.
      Staff still on it are listed so IT can offboard or move them."
    - for internal: "Archiving a department keeps its history and takes it off the list for new hires. People
      still in it stay until moved with a transfer."
- **Data:** all rows of both kinds load at once (≤ a few hundred). Search, filter and sort run in the browser;
  tab, filter and search are kept in the URL with `replaceState`.
- **Actions**, new in `src/server/modules/admin/group-actions.ts`: `actionRole("admin","it_staff")` →
  `checkRate` → zod.

  | Action | Input | Audit (`entityType "department"`) |
  |---|---|---|
  | `createGroup` | `{kind, name}`; name trimmed, 2–60 chars | `create`, diff `{name, kind}` |
  | `renameGroup` | `{id, name}`; refused when locked | `rename`, diff `{name}` |
  | `setGroupArchived` | `{id, archived}`; refused when locked; state-guarded `updateMany` on `archivedAt` | `archive` or `restore` |

  A name clash refuses with the text above. `deleteRefRow` stays for categories and types. The new page offers no
  delete: a mistaken row is renamed or archived.
- **Audit sentences:**
  - "{actor} added client {name}" / "… added department {name}";
  - "{actor} renamed {from} to {to}";
  - "{actor} ended the {name} account" / "{actor} archived {name}";
  - "{actor} restored {name}".

  The labels Added / Renamed / Ended or archived / Restored go into `ACTION_LABELS`.

### 2.3 Where "Works for" shows
- **Employees list:**
  - the Department column becomes **Works for** (name, plus the Client tag);
  - the Department facet becomes **Works for**, with options listing internal rows first, then clients, each
    client labelled "{name} (client)";
  - a new facet **Staff** offers Internal | Client staff (`kind` param) and filters on `department.kind`.
  - The search box still matches the group's name.
- **Employee export:**
  - the "Department" column becomes "Works for";
  - a new column **Staff** (Internal / Client) goes after it.
- **Employee import:**
  - the `department` key also accepts the headers "works for" and "client";
  - matching is unchanged: by name, across both kinds;
  - archived rows are blocked (§2.1).
- **Pickers that choose a group** show two `<optgroup>`s, "Internal departments" then "Clients", active rows
  only, sorted by name:
  - the transfer dialog ("New department" becomes "Moves to");
  - the purchase request's department;
  - the stock issue's department.
- **Not changed:**
  - offboarding, holds, reports, the scan page and the accountability form keep showing the name as today;
  - the asset-class sense of "department" (IT vs Purchasing) is a different idea and is untouched.

## 3. Equipment policies per client and department

### 3.1 Rules
- **A group's policy.** Each department or client has at most **one base policy**: `appliesToDepartmentId` =
  the group and `appliesToTitle` null.
- **Title rules inside a group.** A policy with both `appliesToDepartmentId` and `appliesToTitle` set applies to
  that title within that group only, e.g. Team Leads on [Client 7].
- **Older global title policies** (title set, no group) keep working (§3.4).
- **`resolvePolicy` order:**
  1. a title rule of the person's group whose title matches theirs (trimmed, case-insensitive);
  2. otherwise a global title policy matching their title;
  3. otherwise their group's base policy;
  4. otherwise null.

  Steps 2 and 3 keep today's "title beats department". `headcountByPolicy`, Home, the employees list and the
  profile all use this one function, so they agree.
- **One per group, enforced by the actions:**
  - creating a second base policy for a group refuses with "{group} already has a policy";
  - a second title rule for the same title in a group refuses with "{group} already has a rule for {title}".

  There is no DB index, because existing staging data is not checked for duplicates. If duplicates exist, the
  first by name wins, as today.
- **Policy names stay unique** but are now automatic: the base policy is "{group name}" and a title rule is
  "{group name} · {title}". If the name is taken (an older policy), " (2)", " (3)" … is added. Existing policy names
  are kept. A rename of a group does not rename its policies.

### 3.2 Slot labels (no typed names)
- **The label rule.** `slotLabel(categoryName, typeName)`:
  - returns the **type name** when the category is named "Other" (case-insensitive);
  - otherwise returns the **category name**.

  It lives in `src/lib/loadout.ts`.
- **Repeats are numbered.** `numberSlotLabels(labels: string[]): string[]` numbers repeats in order: the first
  "Monitor" stays "Monitor", the next becomes "Monitor 2", then "Monitor 3". It is used wherever a person's slots or
  a policy's slots are listed (profile tiles, the policy editor, Add employee step 2).
- **Stored names.** `PolicySlot.name` and an ADD exception's `name` are still stored, filled by the server with
  `slotLabel` and never typed:
  - **Policy editor:** no name column.
  - **Add a slot:** no name box.
  - **Actions:** `addSlotException` drops `name` from its schema.
- **Migration 32 data step.** Every `PolicySlot` and ADD `EmployeeSlotException` that has a type gets
  `name = slotLabel(category, type)`, for example "second monitor" → "Monitor". Display numbers it "Monitor 2".
  Slots without a type keep their name. No audit rows are written (the migration pattern since Phase 29).

### 3.3 The Equipment policies page (`/admin/equipment-policies`)
It stays in IT → People lifecycle. Viewers can read it; admin and it_staff can edit.

The layout is master-detail, as on the Policies board.
- **Left list** (sticky card):
  - Tabs: Clients | Internal, with counts. `?tab=`.
  - A search box ("Find a client…").
  - A check-box "Only those without a policy ({n})".
  - The list scrolls in its own box, max height 640 px.
  - Each row shows the name, its active people count, and a dot: green has a policy, amber has none.
  - Only active groups are listed. Ended or archived ones disappear from this page; their policies stay in the
    data.
  - The selected row is `?group=<id>`; the default is the first in the list.
- **Right detail:**
  - **Header:** a kind label ("Client" / "Internal department"), the group name, then "{n} people · {m} people
    missing something", "everyone fully equipped", or "no policy". The gap count is computed for this group's
    active people only, using `resolveMissing`. A link "See their staff →" goes to
    `/employees?department=<id>`.
  - **With a base policy:** the table "What their staff should have" has columns **Category**, **Type**,
    **Required**, **Loan** and **×**.
    - Category lists the IT categories that have at least one type.
    - Type lists that category's types and resets to the first when the category changes.
    - **+ Add slot** adds a line: Headset / first type / required.
    - A note under the table: "Each line becomes a tile on the person's profile, named after its category (or its
      type, for Other). A second line of the same kind shows as "Monitor 2"."
    - Edits are **kept locally until Save**. An impact line reads: "{n} people get {k} slots ({r} required).
      Missing items show as gaps on their profile. Nothing is taken back."
    - Buttons: **Copy to other clients…** (or departments) and **Save**. A ⋯ menu offers **Remove policy**, with
      a confirm.
    - Leaving with unsaved changes asks for confirmation (`beforeunload`, and before switching group).
  - **Title rules:** a fold "Different for a job title on {group}".
    - It lists the group's title rules, each with the same table editor, its own Save and a Remove.
    - **+ Add a title rule** asks for an exact job title (2–120 chars). The new rule starts as a copy of the base
      policy's lines.
  - **Without a base policy:** an amber dashed box: "{group} has no equipment policy yet. Their {n} staff show no
    gaps until it has one."
    - A select "Start from another client's list…" lists every group of the same kind that has a base policy,
      searchable by typing.
    - Then "or **Start empty**", which starts one line Laptop / first type / required.
    - Either opens the editor unsaved, and Save creates the policy.
  - **Viewer:** the same views without controls, plus a "READ-ONLY" pill.
- **Copy to others** opens a dialog:
  - a search box and a checklist of every other **active** group of the same kind;
  - each row says "no policy yet", or "replaces its {n} items";
  - Select all / none for the filtered rows, and a count on the button "Copy to {n}".
  - Copying writes **independent** base policies: lines are copied, and the targets' title rules are untouched.
    A target that had a base policy has its lines replaced.
  - At most 60 targets per copy.
- **The Banner** "Editing a policy never touches existing assignments" stays.

### 3.4 Older global title policies
If any exist, a fold above the list reads "Older rules by job title ({n}) — they apply in every department and
client". Each shows the title and its lines (read-only) with **Remove** (admin and it_staff). New ones cannot be
made. The seed has none.

### 3.5 Actions (`src/server/modules/admin/policy-actions.ts`, rewritten)
All use `actionRole("admin","it_staff")` → `checkRate(user.id)` → zod, one transaction, and `writeAudit` with
`entityType "equipment-policy"`. Every path revalidates `/admin/equipment-policies`, `/employees`, `/` and
`/admin/departments`.

- **`savePolicy({ departmentId, title?: string | null, policyId?: string, lines: Line[] })`**
  - A `Line` is `{ slotId?: string, assetTypeId: string, required: boolean, loaner: boolean }`.
  - **Limits:** `lines` holds 1–20 items. `title` is 2–120 characters, trimmed.
  - **Every `assetTypeId` must be an IT-class type.** Otherwise it refuses with "Unknown asset type".
  - **Group check:** the group must be active, or the existing policy must already belong to it.
  - **Creating** (no `policyId`) checks §3.1 uniqueness and auto-names the policy.
  - **Updating** (`policyId` given) checks the policy belongs to `departmentId` and has the same title.
  - **Line matching:** a line with a `slotId` that belongs to this policy updates that slot (type, required,
    loaner, name). Lines without one are created. Slots not sent are deleted, and their waivers cascade, as today.
    Names come from `slotLabel`.
  - **Audit:** `create` (diff `{name, appliesTo, slots:{from:null,to:[…]}}`) or `policy.saved` (diff
    `{slots:{from:[…],to:[…]}}`), using the existing `slotList` text.
  - **Refusals:**
    - "Add at least one item, or remove the policy"
    - "{group} already has a policy"
    - "{group} already has a rule for {title}"
- **`copyPolicy({ fromPolicyId, toDepartmentIds: string[] })`**
  - Takes 1–60 targets: distinct, active, the same kind as the source's group, not the source group.
  - For each target it creates or replaces that group's base policy lines.
  - It writes one audit per target: `create` or `policy.saved`, with diff `copiedFrom: {from: null, to: <source name>}`.
- **`deletePolicy({ id })`** is kept as it is, with audit `delete`.
- **Removed:** `createPolicy`, `addSlot`, `removeSlot` and `setSlotRequired`, along with `policy-editor.tsx`.
  No other caller uses them.
- **Audit sentences:**
  - "{actor} saved {policy}'s equipment list"
  - "{actor} copied {source} to {policy}"
  - `ACTION_LABELS` gains `"policy.saved": "Policy saved"`.

## 4. The employee profile

The page stays at `/employees/<id>` with the same data sources, rearranged.

### 4.1 Identity band (full width)
- **Left:**
  - the avatar initials;
  - the name with the employment status dot (and the offboarding due pill);
  - one line "{title} · {group} [Client tag] · {employeeNo}";
  - a muted line "Joined {date} · M365 {status}", plus "Transferred from {X} on {date}" when that applies.
- **Right:** `ProfileActions`, unchanged.
- **Stat strip:** Items held · Book value · Oldest item · Open requests, the same numbers as today. Below it, the
  progress line "{filled} of {total} slots filled · {policy name}", or "No equipment policy applies".
- **Open approval refs:** up to 5, under the strip, as today.
- `EmployeeCreatedNotice` stays above the band.

### 4.2 Main grid
The main grid has two columns, wrapping to one below 1024 px:
- **left (about 2/3):** the Equipment card;
- **right (about 1/3), in order:** Notes, IT setup, Accountability form (`AcknowledgementCard`, unchanged) and
  Transfers (`TransfersCard`, unchanged).

### 4.3 Equipment tiles
- **The grid:** a CSS grid, 3 columns (2 below 1280 px, 1 below 640 px), with `grid-auto-rows: 1fr`, so **every
  tile is the same size**.
- **The tile:**
  - top: the numbered slot label (§3.2) and the ⋯ menu;
  - middle: the model and tag;
  - bottom: a status chip.
- **Tile order:**
  1. required gaps (`orderTiles`);
  2. filled and loan-covered slots;
  3. optional gaps;
  4. **extra items**: held assets no slot claimed (from `unslotted`), labelled by category with the chip "Not in
     policy";
  5. **unclaimed loans**: TEMPORARY assets no slot claimed (from `onLoan`), labelled by category with the chip
     "On loan · due {date}" (amber when due within 3 days, red when overdue).
- **Loans are a status.** A loaner slot filled by a loan, or a standard slot covered by a loan, shows the "On loan ·
  due {date}" chip on its own tile. **The separate "On loan" card and "Also holding" card are removed**; their items
  are tiles.
- **Status chips:**

  | Tile | Chip |
  |---|---|
  | Required gap | red "Missing", with a primary **Fill** button when the user may act |
  | Optional gap | grey "Optional" |
  | Filled | green "Held" |

- **⋯ menu:** today's `tileMenuItems`, plus "Open record" on extras and loans.
- **Clicking a filled tile's body** (not the menu) opens the side panel (§4.4). Extras and loans open it too.
- **Kept, below the grid:**
  - "Holding area" (reservations and queued items);
  - "Waived for this person (n)";
  - the frozen banner when the person is not ACTIVE;
  - the Slots / Table switch. The Table view keeps its columns and gains no tiles.
- **"Add a slot for this person…"** moves into the Equipment card header.

### 4.4 Side panel (held item)
- **Behaviour:** a right-side drawer (`role="dialog"`, `aria-modal`, labelled by the item's tag and model).
  - Width 420 px; full width below 640 px.
  - Focus moves into it; Esc and the × close it, and focus returns to the tile.
  - `?item=<assetId>` is kept in the URL with `replaceState`, so it survives a refresh.
- **Content:**
  - **Heading:** the tag, model and status chip.
  - **Details list:**
    - Category · Type
    - Serial
    - Status, plus "due {date}" for a loan
    - **Held since:** the date of the newest audit entry that assigned this asset to this person. It is omitted
      when none is found.
    - Book value, when the asset has one, with the same visibility as the profile's stat.
  - **Recent history:** the asset's 5 newest audit entries as `auditSentence` lines with dates, and a "See all"
    link to the asset's record.
- **Actions** (only the ones the user may do, as the tile menu):
  - **Replace…** and **Return…** open the existing dialogs.
  - **Change status** links to `/inventory/<id>#status`.
  - **Edit details** links to `/inventory/<id>/edit`.
  - **Open full record** links to `/inventory/<id>`.
- **Data:** a read-only server action `heldItemPanel({ employeeId, assetId })`.
  - It uses `requireUser` and the "check" rate kind.
  - It refuses unless the asset is currently held by that employee.
  - It returns the fields above. Nothing new is written.

### 4.5 Notes
- **Model:** `EmployeeNote { id, employeeId (Restrict), authorId → User (Restrict), text, createdAt, editedAt? }`,
  with an index on `(employeeId, createdAt)`.
- **The card:**
  - Heading "Notes ({n})".
  - A textarea "Add a note about {name}…" (1–2000 characters, trimmed) with an **Add note** button, for admin and
    it_staff.
  - The list is **newest first**. Each entry shows the author, a date and time, an "edited" mark, and the text
    with line breaks kept.
  - The first 5 are shown, then "Show all {n}".
  - **Edit** (inline) appears on the author's own notes. **Delete** appears on the author's own notes, and on every
    note for admin. Delete asks for confirmation.
- **Rules (`canEditNote` / `canDeleteNote` in `src/lib/employee-notes.ts`):**
  - edit: the author only, and only while their role is admin or it_staff;
  - delete: the author (admin or it_staff), or any admin.
  - Notes can be added for OFFBOARDED people too.
- **Actions** (`src/server/modules/employees/note-actions.ts`): `addEmployeeNote`, `editEmployeeNote` and
  `deleteEmployeeNote`.
  - Pipeline: `actionRole("admin","it_staff")` → `checkRate` → zod.
  - Edit and delete are guarded on author and role on the server, not only in the UI.
  - **Audit** (`entityType "employee"`):

    | Action | Diff |
    |---|---|
    | `note.added` | `{ note: {from: null, to: text} }` |
    | `note.edited` | `{ note: {from, to} }` |
    | `note.deleted` | `{ note: {from: text, to: null} }` |

    The audit keeps the text: history is append-only.
  - **Sentences:**
    - "{actor} added a note on {name}"
    - "{actor} edited a note on {name}"
    - "{actor} deleted a note on {name}"
- **Deleting is a hard delete** of the note row.

### 4.6 IT setup
- **Model**, on `Employee`:
  - `enum SetupState { DONE NOT_YET NOT_NEEDED }`;
  - `entraStatus SetupState?`, `autopilotStatus SetupState?`, `argusStatus SetupState?`;
  - `vpn String?`. The values are "None", "Cloudflare WARP", "OpenVPN", or any other name of 1–40 characters.
  - **Null means "Not recorded"**, which is every existing person. Nothing is back-filled.
- **The card "IT setup":**
  - **Three rows:**
    - Entra / Intune connected
    - Autopilot
    - Argus

    Each row has a select: Not recorded (shown only while null), Done, Not yet, Not needed.
  - **A VPN row:** a select with Not recorded, None, Cloudflare WARP, OpenVPN and Other…; "Other…" shows a text box.
  - **Header chip:** "{n} not yet" when any row is NOT_YET.
  - **Saving:** each change saves on change, with a toast "Saved".
  - **Viewer:** plain text.
- **Action:** `setItSetup({ employeeId, field: "entra"|"autopilot"|"argus"|"vpn", value })`.
  - Pipeline: `actionRole("admin","it_staff")` → `checkRate` → zod. VPN values are trimmed, 1–40 characters.
  - **Audit:** `employee.setup`, diff `{ <field label>: {from, to} }`.
  - **Sentence:** "{actor} set {name}'s {Entra / Intune | Autopilot | Argus | VPN} to {value}".
- **Not shown** on the Worklist, Home or the employees list (the user's choice).

### 4.7 Add a slot (for one person)
- **The dialog "Add a slot for {name}":**
  - **Category:** IT categories with at least one type.
  - **Type:** that category's types. It is hidden and set when there is exactly one, and resets when the
    category changes.
  - **A live line:** "Shows as "{label}"", using `slotLabel` and the person's current labels for numbering.
  - **Check-boxes:** required, and "loaner slot — filled by a device on loan".
  - **A reason:** required, with chips.
- **Reason chips** are split by what is done:
  - `policy.exception.add`: "Role needs it", "Client requirement", "Remote work setup", "Accessibility need";
  - `policy.exception.waive`: "Not needed for this role", "Uses own device", "Client provides it".

  `policy.exception` is replaced by these two keys.
- **`addSlotException` schema** drops `name`; the server fills it with `slotLabel`. The audit is unchanged.

## 5. Add an employee in 3 steps (`/employees/new`)

### 5.1 Shape
- **One page** with a stepper "1 Details · 2 Equipment · 3 Check & create".
- **Right panel (sticky):** the live policy for what is entered so far, showing the matched policy name and its
  numbered lines (required / optional / loan), or "No equipment policy for {group} yet — they will start with no
  gaps." It replaces `PolicyPreview` here. It is fed by `previewPolicy`, which gains the lines.
- **Steps:** Back and Next move between steps without a server round-trip. Next checks the step's required fields
  in the browser. The server re-checks everything on create.

### 5.2 Step 1 — Details
- **Name** (2–120 characters), with the same-name check as today.
- **Works for:** a radio pair, Internal | Client staff (default Internal). Then:
  - **Department** (Internal), or **Client** (Client staff, with a type-to-search select);
  - only active rows of that kind are offered.
- **Title** (2–120 characters).
- **Employee no.:**
  - **prefilled** with the next free number (`nextEmployeeNo`) when one is found, and editable;
  - the duplicate check runs as today.
- **Start date** (the existing Joined field; today by default).
- **Accounts & access:**
  - **Entra / Intune connected, Autopilot, Argus:** three-way buttons Done / Not yet / Not needed. The default is
    Not yet.
  - **VPN:** a select None / Cloudflare WARP / OpenVPN / Other… (with a text box). The default is None.
- **First note** (optional, up to 2000 characters).
- **More:** a fold with Employment (default Active, with Complete by when Offboarding) and Account status (M365).

### 5.3 Step 2 — Equipment
- **The policy's lines**, numbered, with required ones first. Each line offers a select of **spares**: assets of that
  type that are assignable to IT (`isAssignable`, the same rule the Fill dialog uses), showing tag · model, at most
  50 per type, ordered by tag. The first option is **"Leave as a gap"**, which is the default.
- **Loaner lines** show "Filled by a loan later" and have no select.
- **Each spare can be picked once** across the lines; an asset picked on one line is disabled on the others.
- **With no policy:** "Nothing to assign yet — add equipment from their profile after creating."
- **Data:** a read-only action `spareOptions({ departmentId, title })`, on the "check" rate kind, with roles admin
  and it_staff. It returns the resolved lines and spares per type.

### 5.4 Step 3 — Check & create
- **Summary:**
  - the Details;
  - Accounts & access as one line, e.g. "Entra: Not yet · Autopilot: Done · Argus: Not needed · VPN: Cloudflare
    WARP";
  - each line as "{label}: {tag} · {model}" or "{label}: gap";
  - the first note.
- **Buttons:** **Create employee** and **Create and add another**.
- **The server** (`createEmployee`, extended) runs in one transaction:
  - it creates the employee, with `entraStatus`, `autopilotStatus`, `argusStatus` and `vpn`;
  - it writes the first note when one is given (audit `note.added`);
  - it writes the employee `create` audit as today.
- **Assignments run after that transaction**, one at a time, through the same path the profile's Fill dialog uses
  for this user:
  - **direct** (`isDirectLifecycle(role, "IT")`): `assignAsset`;
  - otherwise: `requestAssign`.

  The result returns `{ id, assigned: n, failed: [{tag, reason}] }`. A failure, such as a spare taken meanwhile,
  does not undo the employee.
- **Redirect** to `/employees/<id>?created=1`. `EmployeeCreatedNotice` gains "{n} items assigned" and, when any
  failed, "{tag} could not be assigned: {reason}" lines.
- **Schema additions to `createEmployeeSchema`:**
  - `entraStatus`, `autopilotStatus` and `argusStatus` (the `SetupState` values);
  - `vpn` (1–40 characters);
  - `note` (optional, 0–2000 characters);
  - `assign: Array<{ assetId: string }>`, at most 20 items, distinct.
- **Server rules:**
  - The department must be **active**; otherwise "That department or client is archived".
  - The edit page (`/employees/<id>/edit`) keeps its single form. Works for still changes only by Transfer.

## 6. Migration 32 (`20261016180000_clients_profile`)
1. Create the `GroupKind` enum. Add `Department.kind` (default INTERNAL, not null) and `Department.archivedAt`.
2. Create the `SetupState` enum. Add `Employee.entraStatus`, `autopilotStatus`, `argusStatus` and `vpn`, all
   nullable.
3. Create `EmployeeNote` with its foreign keys and index.
4. **Data step**, in a `DO $$` block, re-runnable: set `PolicySlot.name` and ADD `EmployeeSlotException.name` from
   §3.2 where a type is set.

No audit rows are written. The seed adds:
- two clients, "Bluepeak Telecom" (with a base policy: Workstation (PC) / Mini PC, Monitor / 24-inch ×2, Headset /
  Wired, all required) and "Harborline Billing" (no policy);
- **no new employees**, so existing e2e counts hold.

The Finance standard slots take the new labels.

## 7. Testing

### 7.1 Unit (vitest)
- **`slotLabel`:** the Other rule (case-insensitive), and every other category.
- **`numberSlotLabels`:** no repeats; three repeats; mixed.
- **`resolvePolicy`:** a group title rule beats a global title policy, which beats the group base; no match gives
  null; a title rule of another group never applies.
- **`canEditNote` / `canDeleteNote`:** author it_staff, author viewer, admin non-author, it_staff non-author.
- **Group filters on the Org page** (a pure `filterGroups` and `sortGroups`): Active, No policy, Ended, All;
  natural sort; search.
- **Policy line diff** (a pure `planSlotChanges(existing, lines)`): which slots are kept, updated, created and
  deleted.
- **Import:** the "works for" and "client" headers map to the department key; archived rows are blocked.
- **Export:** columns include Works for and Staff.
- **`auditSentence`:** each new action.
- **`setItSetup` and `createEmployee` zod:** VPN length, setup values, assign distinct.

### 7.2 E2E (Playwright: `e2e/clients-profile.spec.ts`)
1. Admin adds a client on Departments & clients; it shows under Clients with "No policy · Set one up".
2. On Equipment policies, they open that client, "Start from" Bluepeak Telecom, change a line, and Save. The left
   dot turns green.
3. Copy to others: copy Bluepeak to the new client and see "replaces its {n} items".
4. Add employee as Client staff for the new client, pick one spare, and create. The profile shows that tile
   "Held", and the other lines as gaps.
5. Clicking the held tile opens the side panel with Held since and Recent history; Esc closes it.
6. Notes: add, edit, then delete. A viewer sees notes but no controls.
7. IT setup: set Argus to Done and VPN to Other "Zscaler"; reload, and both persist.
8. Add a slot: Category Monitor → shows as "Monitor 2" (or the next number).
9. End the client account: it disappears from the Works for picker on /employees/new.
10. Axe on `/admin/departments`, `/admin/equipment-policies`, `/employees/new` (each step) and the profile with the
    panel open.

**Existing specs that change** (updated in the tasks that change their screens):
- `admin.spec.ts` (departments, the case clash);
- the equipment-policy cases;
- `employee-ux.spec.ts` (the new-employee form);
- `custody.spec.ts` (Add slot, the On loan card);
- `transfers.spec.ts` (the "Moves to" picker);
- `import-export.spec.ts` (headers);
- `axe-sweep.spec.ts`.

## 8. Rulings taken while writing (the user was asleep)
1. **Clients are `Department` rows with a `kind`**, not a new table. Every existing relation (transfers,
   requests, stock issues, policies, filters) then works for clients with no second code path. The cost: a client
   cannot share a department's exact name.
2. **Archive, not delete,** on the new page. Rows with history must not vanish; a typo is fixed by Rename.
3. **No DB uniqueness index for one-policy-per-group.** Staging may hold duplicates; the actions enforce it
   instead.
4. **Slot names are derived, and the existing ones are rewritten by the migration** ("second monitor" →
   "Monitor", shown as "Monitor 2"). This keeps every screen consistent without a typed name.
5. **The side panel's Change status and Edit details link to the asset record** rather than duplicating those
   dialogs. Replace and Return reuse the profile's dialogs.
6. **Assignments in Add employee run after the create transaction** through the existing assign path, so the
   approval / direct rules and their audits stay in one place. A failed assignment never loses the new person.
7. **IT setup is null ("Not recorded") for existing people.** "Not yet" would claim something nobody checked.
8. **Book value stays on the profile** for everyone who sees it today. No new finance gating is added in this
   phase.
9. **Notes keep their text in the audit after deletion**, because the audit log is append-only.
10. **Purchase-request and stock-issue department pickers list clients too** (optgroups), because a request or an
    issue can be for client staff. Their labels are unchanged.
