# Users & access (admin access management): design

**Date:** 2026-10-24
**Status:** written from the owner's answers in chat. Calls I made are marked **(my call)**.
**Mockup:** the claude.ai canvas "Access Management" (artifact `BKQQWocPUap8yvMGmUjg9w`), row "Version 2 — refined and responsive". The boards are `Users2` (laptop), `Tablet2`, `Phone2`, `PhoneAdd2`, `Account2`, `PhoneAccount2` and `PhoneFirst2`. The owner said "its good". Row 1 is the earlier draft and is context only.

## 1. Why

CRIS still runs on staging "quick sign-in", and that shortcut is due to be removed on 5 Nov. After that, people need real accounts. The owner needs to create those accounts, decide what each person can open, link each account to the person's employee record, and get people back in when they forget their password. Each person needs a place to change their own password.

**Success looks like this:**
- An admin can create an account for a new hire in under a minute and hand them a temporary password.
- The new hire signs in and chooses their own password.
- From then on, only the admin can change their role or access.

## 2. Owner's decisions

1. **Access comes from the role.** "He will get all the Finance part."
   - The five existing roles stay: Admin, IT staff, Purchasing, Finance, Viewer.
   - Choosing individual functions per person is a later major update, not this one.
2. **Department means linking the account to the person's employee record.** The department or client shown for an account comes from that record.
3. **Passwords are reset with a temporary password from an admin.**
   - The person must choose their own password at their next sign-in.
   - Email reset links come later, after an email service is set up.
4. **Account settings let people change their own password only.**
5. **Sign-up stays, and every sign-up waits for an admin to approve it** (owner, 2026-10-24: "sign up is not removed… Wait for an admin to approve the account"). Admins can also create accounts directly from Users & access.
6. **The look is the V2 mockup:**
   - a list with a details panel on a laptop;
   - details slide in from the right on a tablet;
   - cards, plus a full-screen details sheet, on a phone;
   - Add user as a side sheet;
   - Reset password as ask-then-show-once;
   - an "Account active" on/off switch, with an inline confirm when turning it off;
   - an "Unsaved changes" bar.
7. **Three wrong passwords pause sign-in** (owner, 2026-10-24: "too many wrong password only has 3 failed tries").

## 3. What exists today (survey, 2026-10-24)

**Sign-in**
- Auth.js with Credentials. Sessions are JWTs that last 8 hours and carry `id` and `role` (`src/server/auth/config.edge.ts`).
- `requireUser` and `actionUser` re-read the User row on every request. They sign the person out when the account is missing, disabled, or its role differs from the token's (`src/server/auth/guards.ts:24-55`).
- There is no session version, no last-sign-in tracking, and no sign-in rate limit.
- Microsoft Entra is wired up but not working, and is unused.
- Quick sign-in (`QUICK_LOGIN_EMAILS`) is a staging-only extra provider.

**Sign-up**
- `signUp` (`src/server/auth/actions.ts:87-132`) creates a `viewer`. When `SIGNUP_REQUIRES_APPROVAL=1` the account starts disabled, and "approving" it means an admin enables it.
- The `/signup` page, the "Create an account" link and the steps are in `src/components/login/*`.
- The allowed email domain is the `allowed_domain` flag (`src/lib/auth-shared.ts`).

**Passwords**
- `bcryptjs`, cost 10.
- The only rule is a minimum of 10 characters (`src/lib/signup-rules.ts`).

**Admin**
- `/admin/users` ("Users & roles") has a role select and Enable/Disable.
- The actions are `setUserRole` and `setUserDisabled`, in `src/server/modules/admin/user-actions.ts`.
- The rules are in `src/lib/admin-users.ts`. The permanent admin is locked; self-disable is refused; self-demotion is allowed with a warning.
- Audit codes in use: `signup`, `bootstrap`, `role-change`, `disable`, `enable`.

**Employees**
- `Employee` has `employeeNo` (unique, "EMP-0042"), `name`, `department` (whose `kind` is INTERNAL or CLIENT) and `employment`.
- It has no email field.
- There is no link between `User` and `Employee` yet.
- People search uses `searchPeople` and `PeopleCombobox`.

**Settings and shell**
- Only `/settings/cris` exists.
- The account menu (`src/components/shell/account-menu.tsx`) and the mobile drawer (`mobile-nav.tsx`) have Cris settings and Sign out.
- Routes are gated default-deny in `src/lib/workspaces.ts`.

## 4. The design

### 4.1 Data (one migration)

Fields added to `User`:
- **`employeeId String? @unique`**, linking to `Employee`.
  - One account per employee **(my call)**.
  - It is optional, for shared or service accounts.
  - The link uses `onDelete: SetNull`.
- **`mustChangePassword Boolean @default(false)`**: true after an admin creates the account or resets its password.
- **`passwordChangedAt DateTime?`**: when the password was last set, by the person or by an admin.
- **`lastSignInAt DateTime?`**: set on every successful sign-in, by any provider.
- **`sessionVersion Int @default(0)`**: carried in the JWT. The guards compare it with the database and sign the person out when they differ.
- **`approvalState` enum `ApprovalState { APPROVED PENDING DECLINED }`, default `APPROVED`**, plus `approvalDecidedAt DateTime?` and `approvalDecidedById String?`.
  - A sign-up creates the account `PENDING`. A `PENDING` or `DECLINED` account can't sign in.
  - This is kept separate from `disabled`, so "waiting for approval" never looks like a deliberately disabled account.
  - The migration sets existing accounts to `APPROVED`. Existing disabled accounts that came from earlier sign-ups (audit `signup`, never enabled) become `PENDING` **(my call)**.

Existing rows get the defaults. Existing passwords stay valid, and nobody is forced to change. The owner chose to leave existing accounts as they are (2026-10-24), including the shared seed password. Handling those accounts is the owner's job; the handover notes call out the risk.

### 4.2 Signing people out (session version)

**When the version goes up**
- A password reset by an admin.
- The person changing their own password. Their current session gets a fresh token, so they stay signed in on the device they used, and everywhere else signs out.
- A role change.
- Disabling the account.
- An email change.
- Unlinking or relinking the employee record does **not** sign the person out **(my call)**.

**How it is checked**
- `requireUser` and `actionUser` already read the User row. They add `sessionVersion !== token.sessionVersion` to their logout conditions.
- Middleware keeps trusting the token only for route gating, as it does today.

### 4.3 Temporary passwords and the first sign-in

**Generating it**
- The server generates the temporary password: three parts (word, 4 digits, word), about 16 characters, for example `Harbor-4207-cedar`.
- It is shown to the admin exactly once, in the create or reset result, with Copy. It is never stored in plain text and never logged.

**Signing in with it**
- `mustChangePassword` is set, and it goes into the token as well.
- While it is true:
  - `requireUser` sends every page to **`/welcome/password`**, the "Choose your own password" screen, `PhoneFirst2`;
  - server actions refuse with "Choose your own password first", except the one that sets the password.
- `/welcome/password` is reachable while signed in, by every role. It offers Sign out.

**Rules for any new password**
- at least 10 characters (the existing rule);
- letters and at least one number;
- not the same as the current or temporary password.

The rules show as a checklist that ticks as the person types, and the server enforces them as well.

After saving, `mustChangePassword` becomes false, `passwordChangedAt` is set to now, and the session continues with a refreshed token.

### 4.4 Users & access (`/admin/users`, admin only)

Rename the page to **Users & access**. Rebuild it per the `Users2`, `Tablet2` and `Phone2` boards.

**List**
- Role tabs with counts (All, Admin, IT, Purchasing, Finance, Viewer). On a phone they become a select.
- A status filter: Any, Waiting for approval, Active, Must set password, Disabled, Declined.
- When any sign-ups are waiting, a **"Waiting for approval · N"** chip sits above the list and opens that filter. The admin nav item for Users & access shows the same count.
- Search across name, email, employee number and department.
- Rows show:
  - avatar initials, name and email;
  - role;
  - the employee record (`EMP-1042`, and Department or "Client: X");
  - status (Waiting for approval, Active, Must set password, Disabled, Declined), as a dot plus words;
  - last sign-in, as a relative time, or "Never".
- Sorted by name, paged when long.
- On a phone, rows are cards.

**Details panel**
- Header: initials, name, email. A Close button appears below 1180 px.
- **Access:** the five roles as radio cards, each saying what it opens. Picking a different role shows: "Moves {first name} from {old} to {new}: opens {new workspaces} instead of {old}. They're signed out when you save."
- **Employee record:** the linked record, with Change, using a search limited to ACTIVE employees with no account yet, and Unlink.
  - When a linked employee is offboarding or offboarded, the account is **not** changed automatically. The list and the panel show an amber "Employee offboarded" note, and the admin decides whether to disable it **(my call)**.
- **Name and email:** editable inline (pencil, then fields) **(my call; the owner asked for "edit users")**. The email must match the allowed domain and be unique.
- **Sign-in:** status, last sign-in, password (the date the person set it, or "Temporary, given {date}"), and "Account created {date} by {admin}". It has **Reset password…**.
- **Account:** an **"Account active" on/off switch** (owner, 2026-10-24: "on/off to disable their account is still needed").
  - Turning it **off** asks inline first: "Turn off {name}'s account? They're signed out now and can't sign in. Their history stays." Confirming disables the account and bumps `sessionVersion`.
  - Turning it **on** needs no confirm.
  - The switch is `role="switch"` with `aria-checked`, and is labelled "Account active".
  - It is greyed out, with the reason, for the permanent admin and for your own account.
- An **Unsaved changes** bar (Discard / Save) appears only when a field differs. A save writes every changed field in one action.

**Approving a sign-up.** A `PENDING` account's panel replaces Sign-in and Account with an **Approve sign-up** section:
- the name, email and "Signed up {date}" as the person entered them;
- the role, defaulting to Viewer, which the admin picks;
- the employee record, a suggested match by name where one exists;
- **Approve** sets `APPROVED`, enables the account, saves the role and link, and writes audit `user.approve`;
- **Decline** asks once, then sets `DECLINED` and writes audit `user.decline`. A declined person can't sign in. An admin can later Approve them from the Declined filter.
- The person keeps the password they chose at sign-up, so `mustChangePassword` stays false.

**Add user** is a side sheet, full screen on a phone:
- Full name and work email. The email must be on the allowed domain, with the domain shown in the hint.
- Role, as radio cards.
- Employee record (optional).
- Temporary password, generated, with Copy and "make a new one".
- **Create account** makes the account with `mustChangePassword = true`, selects it, and confirms: "Account created for {name} — give them the temporary password".

**Reset password…** opens a dialog. It asks first ("Their current password stops working and they're signed out everywhere…"), then shows the new temporary password once with Copy.

**Rules** (existing ones kept, plus new ones):
- The permanent admin can't be demoted or disabled.
- An admin can't disable themselves.
- Self-demotion warns, as today.
- An admin may reset their own password from Account settings, not from this page **(my call)**.
- **The permanent admin's account is locked against every admin action on this page (owner, 2026-10-24).** Nobody can reset its password, change its email or name, or relink it here. The panel shows why: "The permanent admin's account can only be changed by its owner."
- **Recovery (owner, 2026-10-24).** If the permanent admin forgets their password, the owner runs a recovery command against the database: `npm run admin:recover -- --email <address>`, in the style of `scripts/supabase/dump.ps1`, with the URL read from the environment and never printed. It sets a new temporary password, prints it once, sets `mustChangePassword`, bumps `sessionVersion` and writes the audit entry `password.reset` with source `cli`.
- Admins can reset each other's passwords, except the permanent admin's.

**Audit**
- New codes: `user.create`, `user.approve`, `user.decline`, `user.update` (name, email or employee link, with the diff), `password.reset` (by an admin) and `password.change` (by the person).
- The existing `role-change`, `disable` and `enable` stay.
- All of them are registered in the audit labels and sentences.
- The panel links "See this person's access history →" to Activity, filtered to that user.

### 4.5 Account settings (`/settings/account`, every role)

Per the `Account2` and `PhoneAccount2` boards.

**Your account** (read-only):
- initials, name and email;
- role, with what it opens;
- employee record;
- account created, with date and the admin who created it;
- "Something here wrong? Ask an admin to change it."

**Password**
- Shows "Last changed {date}" and a **Change password** button that opens the form.
- The form has current password, new password and type it again, each with Show/Hide.
- The checklist rules from §4.3 apply.
- Saving shows: "Password changed. You stay signed in here; your other devices are signed out."
- A wrong current password reads "That isn't your current password". This check is rate-limited.

**Where it's linked:** an "Account settings" link in the account menu, before Sign out, and in the mobile drawer. Its route rule allows every role.

### 4.6 Sign-up with approval, and sign-in hardened

**Sign-up stays** (owner, 2026-10-24).
- The `/signup` page, the "Create an account" link and the steps stay as they are. The `allowed_domain` flag still limits which emails can sign up.
- Every sign-up now waits for approval. The account is created `PENDING` with role Viewer, and the `SIGNUP_REQUIRES_APPROVAL` switch is retired **(my call: the owner wants approval always)**.
- The sign-up done step says: **"Wait for an admin to approve your account."**, followed by "You can sign in once it's approved."
- Signing in to a `PENDING` account shows **"Your account is waiting for an admin to approve it."**
- Signing in to a `DECLINED` account shows **"Your sign-up wasn't approved. Ask an admin if you think this is a mistake."**
  - Neither message is shown unless the password is right, so neither reveals that an account exists.
- Each new sign-up raises the admin nav count (§4.4). No email is sent.

**Sign-in rate limit** (owner: 3 tries)
- After **3** failed attempts for one email within 15 minutes, further attempts are refused for 15 minutes with: "Too many tries — wait 15 minutes or ask an admin to reset your password."
- Failures are counted per lower-cased email, whether or not an account exists, so the message never reveals which emails have accounts. They go in a new small table, `SignInAttempt` (`emailKey`, `createdAt`), because `RateEvent` needs a user **(my call)**.
- Rows older than a day are pruned by the existing worker tick.
- A successful sign-in, or an admin reset, clears the count.

**Other sign-in changes**
- `lastSignInAt` is written on every successful sign-in.
- Quick sign-in is untouched. Its removal on 5 Nov is a separate task.

## 5. Non-goals

- Per-person function permissions or custom roles (a later major update).
- Email reset links, or any email sending.
- Microsoft sign-in.
- Two-factor sign-in.
- People editing their own name, email or other profile details.
- Deleting accounts. Disable stays the way to remove access, and history is kept.

## 6. Anti-goals

- A temporary password visible anywhere after its one showing, in a log, an audit diff or a URL.
- Locking the system out of itself. The permanent admin always remains.
- A role change or reset that leaves the person signed in with their old access.

## 7. Left to the builder

- The exact components, reusing the app's Drawer, Dialog, Table and toast with Undo where sensible.
- Whether name and email are edited inline or in a small sheet. Keep it consistent with the panel.
- Paging size for long user lists.
- The word list for temporary passwords. Avoid words that look alike, and words that could offend.

**Tests must cover:**
- every new action's rules (permanent admin, self-disable, domain, unique email, unique employee link);
- session version bumps and the guard logout;
- the `mustChangePassword` gate on pages and actions;
- the password rules on the server;
- the sign-in rate limit;
- the temporary password never appearing in an audit row;
- e2e:
  - create → first sign-in → choose password → land on the role's workspace;
  - reset → old session signed out;
  - role change → access changes;
  - disable → signed out;
  - account settings password change;
  - sign-up → "Wait for an admin to approve your account" → sign-in refused while pending → admin approves with a role and employee link → sign-in works; decline → refused with the declined copy;
  - three wrong passwords → paused, then works after the window;
  - axe in light and dark at 375 px and 1440 px.
