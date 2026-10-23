# Users & access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real account management for CRIS:
- admins create, edit, approve and turn accounts on or off;
- admins reset passwords with a one-time temporary password;
- people choose their own password at first sign-in and change it in Account settings;
- sign-up stays, but always waits for approval;
- three wrong passwords pause sign-in.

**Architecture:**
- One migration adds the account fields, an `ApprovalState` enum and a `SignInAttempt` table.
- The JWT gains `sessionVersion` and `mustChangePassword`.
- The existing per-request guards (`requireUser`, `actionUser`) compare `sessionVersion` with the database. That is how "signed out everywhere" works.
- Middleware sends a token with `mustChangePassword` to `/welcome/password`.
- The admin actions live in `src/server/modules/admin/user-actions.ts`, beside the existing role and disable actions. Their pure rules are in `src/lib/admin-users.ts`.
- The Users & access page is rebuilt from the V2 mockup.

**Tech Stack:** Next.js 15 App Router, React 19, Auth.js v5 (Credentials, JWT), Prisma 6 / Postgres, bcryptjs (cost 10), Tailwind v4, vitest (node, `renderToStaticMarkup`), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-24-access-management-design.md` (binding). Mockup: the claude.ai canvas "Access Management" (`BKQQWocPUap8yvMGmUjg9w`), row "Version 2". The boards are `Users2`, `Tablet2`, `Phone2`, `PhoneAdd2`, `Account2`, `PhoneAccount2` and `PhoneFirst2`.

## Global Constraints

**Roles**
- Five, unchanged: `admin`, `it_staff`, `purchasing_staff`, `finance_staff`, `viewer`.
- What each role opens comes from `ROLE_WORKSPACES` in `src/lib/workspaces.ts`.

**Password rules** (server and client, one function)
- At least 10 characters.
- Letters and at least one number.
- Not equal to the current password, or to the temporary one.
- Hash with bcryptjs, cost 10.

**Temporary password**
- Shape: `Word-NNNN-word`, about 16 characters.
- Generated server-side with `crypto.randomInt`.
- Returned to the admin exactly once, in the action result.
- Never stored in plain text, never in an audit diff, never logged, never in a URL.

**Sign-in pause**
- 3 failed attempts for one lower-cased email within 15 minutes pauses that email for 15 minutes.
- This applies whether or not an account exists.
- A successful sign-in clears the count, and so does an admin reset.

**Copy (verbatim)**
- Sign-in pause: "Too many tries — wait 15 minutes or ask an admin to reset your password."
- After sign-up: "Wait for an admin to approve your account." then "You can sign in once it's approved."
- Sign-in by a PENDING account: "Your account is waiting for an admin to approve it."
- Sign-in by a DECLINED account: "Your sign-up wasn't approved. Ask an admin if you think this is a mistake."
- First sign-in, title: "Choose your own password"
- First sign-in, button: "Save and continue"
- An action while a new password is still owed: "Choose your own password first"
- Account settings saved: "Password changed. You stay signed in here; your other devices are signed out."
- Wrong current password: "That isn't your current password"
- Role-change note: "Moves {first name} from {old} to {new}: opens {new} instead of {old}. They're signed out when you save."
- Turning an account off: "Turn off {name}'s account? They're signed out now and can't sign in. Their history stays."
- Add user done: "Account created for {name} — give them the temporary password"
- Permanent admin lock: "The permanent admin's account can only be changed by its owner."
- Account settings help line: "Something here wrong? Ask an admin to change it."
- Statuses: "Waiting for approval", "Active", "Must set password", "Disabled", "Declined"
- Waiting chip: "Waiting for approval · {n}"
- Offboarded note: "Employee offboarded"

**Audit codes**
- New: `user.create`, `user.approve`, `user.decline`, `user.update`, `password.reset`, `password.change`.
- Existing: `role-change`, `disable`, `enable`.
- Every code is registered in `AUDIT_ACTIONS`, `ACTION_LABELS` and `auditSentence` (`src/lib/audit-actions.ts`).

**Locks**
- The permanent admin (`isPermanentAdmin`) is refused for role, disable, reset, name, email and employee-link changes from any admin action.
- An admin can't turn off their own account.
- Self-demotion warns, as today.

**Process: house rules**
- Never read `.env`.
- No destructive git.
- CRLF files stay CRLF.
- One hand-written migration, `prisma/migrations/20261024090000_access_management/migration.sql`. Never use `prisma migrate dev`, `reset` or `db push`. Apply it with `npx prisma migrate deploy` to the local dev DB.
- Browser tests run only in the last task: port 3100, `--workers=1`, `--global-timeout=540000`, chunks of 4 files or fewer, reseed first and last.

## Review Focus

1. **An admin changes someone's role while that person has two open browsers.** Both sessions end at their next request, and neither keeps the old access. Pinned by Task 1's guard test, plus Task 5's e2e with a second context.
2. **A person signs in with a temporary password and goes straight to a deep link such as `/finance/assets`.** They land on `/welcome/password`. A server action called from a stale tab is refused with "Choose your own password first". Pinned by Task 2's middleware test and action test.
3. **Two admins edit the same account at once**, for example one turns it off while the other changes its role. The second save is refused with the existing "changed by someone else" copy, and nothing half-saves. Task 3 uses optimistic `updateMany` guards on `updatedAt`.
4. **Someone signs up with an email that differs only in case or spaces from an existing account.** The sign-up is refused, and the PENDING list never shows duplicates. Pinned by Task 3's sign-up test, using `normalizeEmail`.
5. **An attacker tries passwords against a real admin email.** After 3 tries the email is paused, and the response looks the same for unknown emails. Pinned by Task 1's rate-limit test.

---

### Task 1: Account data, session version, sign-in pause, approval states at sign-in

**Files:**
- Migration: `prisma/migrations/20261024090000_access_management/migration.sql` and `prisma/schema.prisma`:
  - `User` gains `employeeId String? @unique` (→ Employee, `onDelete: SetNull`), `mustChangePassword Boolean @default(false)`, `passwordChangedAt DateTime?`, `lastSignInAt DateTime?`, `sessionVersion Int @default(0)`, `approvalState ApprovalState @default(APPROVED)`, `approvalDecidedAt DateTime?`, `approvalDecidedById String?` (→ User, SetNull) and `createdById String?` (→ User, SetNull).
  - New `enum ApprovalState { APPROVED PENDING DECLINED }`.
  - New `model SignInAttempt { id, emailKey String, createdAt DateTime @default(now()) }`, with `@@index([emailKey, createdAt])`.
  - Data step: users with `disabled = true` whose only lifecycle audit is `signup` (no `enable` ever) become `PENDING` and `disabled = false`. All others stay `APPROVED`.
- `src/server/auth/config.edge.ts`: the `jwt` callback copies `sessionVersion` and `mustChangePassword` from `user`. On `trigger === "update"` it accepts `{ sessionVersion, mustChangePassword }` from the session update. `session` exposes both. Update `types.d.ts` to match.
- `src/server/auth/guards.ts`: `readRequestUser` and `actionUser` also log out (redirect `/logout`, or return null) when `user.sessionVersion !== token.sessionVersion` or `user.approvalState !== "APPROVED"`.
- `src/server/auth/index.ts` (`authorize`): refuse `approvalState !== "APPROVED"`. Return `sessionVersion` and `mustChangePassword`.
- `src/server/auth/sign-in-limit.ts` (new):
  - `signInPaused(emailKey: string, now?: Date): Promise<boolean>`
  - `recordSignInFailure(emailKey: string): Promise<void>`
  - `clearSignInFailures(emailKey: string): Promise<void>`
  - `SIGN_IN_LIMIT = { tries: 3, windowMs: 15*60_000 }`
- `src/server/auth/actions.ts` (`signInWithCredentials`):
  1. If paused, return the pause copy.
  2. Otherwise verify the password once with bcrypt.
  3. On a wrong password, record the failure.
  4. On a correct password with PENDING or DECLINED, return that copy and do not record a failure.
  5. On success, clear failures, set `lastSignInAt`, then call `signIn`.
- Quick sign-in also sets `lastSignInAt`.
- The worker tick prunes `SignInAttempt` rows older than 24 h. Find the worker's job list and add it there.
- `src/lib/audit-actions.ts`: register the six new codes.

**Interfaces:**
- **Produces:**
  - the new `User` fields;
  - the `SignInAttempt` model;
  - token fields `sessionVersion: number` and `mustChangePassword: boolean`;
  - `bumpSessionVersion(tx, userId): Promise<number>` in `src/server/auth/session-version.ts`, which increments the counter and returns the new value;
  - the sign-in limit functions above;
  - the audit codes.

- [ ] **Step 1: Write the failing tests**
  - `guards.test.ts`:
    - "logs out when the token's sessionVersion is behind": DB 2, token 1 → redirect `/logout`. `actionUser` → null.
    - "logs out a PENDING account".
  - `sign-in-limit.test.ts`:
    - three failures in 15 min → `signInPaused` true;
    - the third failure at 14:59 after the first → paused;
    - failures older than 15 min don't count;
    - `clearSignInFailures` resets.
  - `actions.test.ts`:
    - three wrong passwords for an unknown email → the 4th attempt returns the exact pause copy;
    - same for a known email;
    - right password for PENDING → the PENDING copy, with no failure recorded;
    - right password for DECLINED → the DECLINED copy;
    - success clears failures and writes `lastSignInAt`.
  - `config.edge.test.ts`: jwt `trigger:"update"` sets both fields.
  - Migration test (SQL read, like earlier migration tests): the enum, the columns, the unique `employeeId`, the index, and the data step's `UPDATE`.
- [ ] **Step 2:** Run `npx vitest run src/server/auth`. They fail.
- [ ] **Step 3:** Implement. Write the migration by hand, then `npx prisma generate && npx prisma migrate deploy` against local dev.
- [ ] **Step 4:** `npx vitest run`, `npx tsc --noEmit`, and eslint on the touched files are green.
- [ ] **Step 5: Commit**: `feat(auth): session version, approval states at sign-in, and a three-try sign-in pause`

### Task 2: Password rules, first sign-in, Account settings

**Files:**
- `src/lib/password-rules.ts` (new):
  - `passwordChecks(pw: string, { current?: string; temporary?: string }): { long: boolean; mixed: boolean; fresh: boolean }`
  - `passwordProblem(...)`: string | null.
  - It replaces the minimum-length check in `src/lib/signup-rules.ts`, which now calls it.
- `src/server/auth/temp-password.ts` (new): `generateTempPassword(): string` (Word-NNNN-word, from a curated list of at least 64 neutral, non-confusable words).
- `src/server/modules/account/actions.ts` (new):
  - `setOwnPassword({ password, confirm })`: only while `mustChangePassword`; checks the rules; clears the flag; sets `passwordChangedAt`; bumps the version; writes audit `password.change`; returns `{ sessionVersion }` so the page can call `update()`.
  - `changeOwnPassword({ current, password, confirm })`: verifies `current`, giving "That isn't your current password". The check is rate-limited through `checkRate(user,"mutation")`. Then the same rules, bump and audit.
- `src/middleware.ts`: a token with `mustChangePassword` is redirected to `/welcome/password`, except `/welcome/password`, `/logout` and the auth API.
- `actionUser`: returns null when `mustChangePassword`, except for the `setOwnPassword` path. Give `setOwnPassword` its own guard, `passwordOwedUser()`. Server actions surface the copy "Choose your own password first" through the shared forbidden result.
- Pages:
  - `src/app/(auth)/welcome/password/page.tsx`: the `PhoneFirst2` board, a full-screen card with Sign out.
  - `src/app/(app)/settings/account/page.tsx`: the `Account2` board.
  - Components in `src/components/account/`: `password-fields.tsx` (Show/Hide, live checklist, shared), `first-password-form.tsx`, `account-password-card.tsx`.
- `src/lib/workspaces.ts`:
  - `PATH_RULES` gains `/settings/account` for every role;
  - `/welcome/password` goes in UNGATED for signed-in users.
- `src/components/shell/account-menu.tsx` and `mobile-nav.tsx`: add an "Account settings" link before Sign out.

**Interfaces:**
- **Consumes:** Task 1's token fields and `bumpSessionVersion`.
- **Produces:** `passwordChecks`, `passwordProblem`, `generateTempPassword` (Task 3 uses them), and `PasswordFields` (Task 4 reuses it in Add user's display).

- [ ] **Step 1: Write the failing tests**
  - `password-rules.test.ts`:
    - "abcdefghij" fails `mixed`;
    - "abcdefghi1" passes all;
    - equal to `current` fails `fresh`.
  - `temp-password.test.ts`: the shape matches `/^[A-Z][a-z]+-\d{4}-[a-z]+$/`, the length is 14–20, and 1000 calls give at least 990 distinct values.
  - `account/actions.test.ts`:
    - `setOwnPassword` refused when `mustChangePassword` is false;
    - success clears the flag, bumps the version and writes audit `password.change` with no password in the diff;
    - `changeOwnPassword` with a wrong current password returns the exact copy;
    - the rules are enforced server-side.
  - `middleware.test.ts`: `mustChangePassword` token on `/finance/assets` → redirect `/welcome/password`; `/logout` is allowed.
  - Component tests: the checklist marks; Show toggles the input type; the account card's read-only facts and the help copy.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All green.
- [ ] **Step 5: Commit**: `feat(account): choose your own password at first sign-in, and change it in Account settings`

### Task 3: Admin account actions, sign-up approval, recovery command

**Files:**
- `src/lib/admin-users.ts`. Pure rules:
  - `lockReason` extended to every action, with the permanent admin copy;
  - `canTurnOff(actor, target)`;
  - `emailProblem(email, domain, takenByOther)`;
  - `roleChangeNote(name, from, to)` (verbatim copy).
- `src/server/modules/admin/user-actions.ts`. All use `actionRole("admin")`, `checkRate`, one transaction, optimistic guards and audit:
  - `createUser({ name, email, role, employeeId? }) → { id, tempPassword }`: APPROVED, `mustChangePassword`, `createdById`.
  - `updateUser({ id, name?, email?, employeeId?: string | null, role? , expectedUpdatedAt })` writes every changed field in one call. A role or email change bumps the version; an employee-link change does not.
  - `resetUserPassword({ id }) → { tempPassword }` sets `mustChangePassword`, bumps the version, clears the sign-in failures for that email, and writes audit `password.reset`.
  - `setUserDisabled` (existing): add the version bump and the `canTurnOff` rule.
  - `approveSignup({ id, role, employeeId? })` and `declineSignup({ id })`: PENDING only, set `approvalDecidedAt/ById`. Approve may also be used from DECLINED.
- `src/server/modules/admin/queries.ts` (`listUsers`) returns, for each row:
  - `status`, one of the five statuses;
  - `employee` (`{ id, employeeNo, name, groupLabel, offboarded }`);
  - `lastSignInAt`, `passwordChangedAt`, `mustChangePassword`, `createdAt`, `createdByName`, `approvalState`.

  It also returns `pendingCount`. It supports filters `role`, `status` and `q` (name, email, employeeNo, department).
- `src/server/modules/admin/employee-link-search.ts`: `searchLinkableEmployees(q)`, admin only. It returns ACTIVE employees with no linked user: `{ value, label, sub: "EMP-1042 · Finance" }`.
- Nav count: `pendingSignups` in nav counts, shown on Users & access in the admin workspace (`src/lib/workspaces.ts`, `src/server/modules/home/nav-counts.ts`).
- Sign-up (`src/server/auth/actions.ts` `signUp`):
  - always creates PENDING, with `disabled` false;
  - refuses an email that matches an existing one under `normalizeEmail`;
  - remove the `SIGNUP_REQUIRES_APPROVAL` branch and its `.env.example` line;
  - the done step in `src/components/login/sign-in-card.tsx` shows the two verbatim lines.
- Recovery command: `scripts/admin-recover.ts`, run as `npm run admin:recover -- --email <address>`.
  - It uses `DATABASE_URL` from the environment and never prints it.
  - It works only on the permanent admin's email.
  - It sets the temp password and `mustChangePassword`, bumps the version, clears failures, and writes audit `password.reset` with `source: "cli"`.
  - It prints the temp password once.
  - Add the script to `package.json`.

**Interfaces:**
- **Consumes:** Tasks 1–2 (`bumpSessionVersion`, `clearSignInFailures`, `generateTempPassword`, `passwordProblem`).
- **Produces:** the actions and list shape above, which Task 4 uses. Result shapes follow `ActionResult` (`ok` / `validationError` / `conflict` / `forbidden`).

- [ ] **Step 1: Write the failing tests** (`user-actions.test.ts`, `admin-users.test.ts`, `queries.test.ts`, `auth/actions.test.ts`, `admin-recover.test.ts`)
  - **Permanent admin:** each action on the permanent admin is refused with the lock copy.
  - **Turning off your own account** is refused.
  - **Create:**
    - creates APPROVED with `mustChangePassword` true;
    - returns `tempPassword` matching the shape;
    - the audit diff has no `tempPassword`, `passwordHash` or the password value;
    - an email outside the domain is refused, and so is a duplicate email.
  - **Update:**
    - a role and email change bumps the version once;
    - an employee-link change doesn't bump;
    - a stale `expectedUpdatedAt` gives a conflict and no write;
    - linking an employee already linked elsewhere gives a validation error.
  - **Reset:** bumps, sets `mustChangePassword` and clears failures.
  - **Approve and decline:**
    - approve sets APPROVED, role and link;
    - decline sets DECLINED;
    - approving a non-PENDING, non-DECLINED account gives a conflict.
  - **Sign-up:**
    - creates PENDING;
    - " Ana.Lim@X.com " duplicates "ana.lim@x.com" and is refused.
  - **List:**
    - statuses are mapped;
    - `pendingCount`;
    - filters;
    - an offboarded employee gives `offboarded` true.
  - **Recover:** refuses a non-permanent email; prints once; writes audit source `cli`.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** All green.
- [ ] **Step 5: Commit**: `feat(admin): create, edit, approve, reset and turn accounts on or off; sign-ups wait for approval; a recovery command for the permanent admin`

### Task 4: The Users & access page (V2 mockup, responsive)

**Files:**
- `src/app/(app)/admin/users/page.tsx`: rename it to "Users & access". Read `?role`, `?status`, `?q` and `?sel`.
- New `src/components/admin/users/` (retire `user-table.tsx` when unused):
  - `users-view.tsx`, the client shell;
  - `users-toolbar.tsx`: role segment, which becomes a select below 700 px, plus status select and search;
  - `waiting-chip.tsx`;
  - `users-table.tsx`, with a card list below 700 px;
  - `user-panel.tsx`, with these sections:
    - Access: role radio cards plus the change note;
    - Employee record: Change / Unlink, plus the offboarded note;
    - Name & email: inline edit;
    - Sign-in: status, last sign-in, password, created by, and Reset password…;
    - Account: the switch, with an inline confirm when turning it off;
    - Approve sign-up: replaces the last two sections when the account is PENDING or DECLINED. Its employee field is pre-searched with the person's name, so the closest match shows first;
    - a footer link, "See this person's access history →", to the Activity page filtered to that user (find the existing audit filter parameter for an entity or actor);
    - the Unsaved changes bar.
  - `add-user-sheet.tsx`;
  - `reset-password-dialog.tsx`;
  - `temp-password-box.tsx`, which shows the password with Copy.
- **Layout:**
  - At 1180 px and wider: list and panel side by side.
  - Below 1180 px: the panel is a Drawer.
  - Below 900 px: the app's existing mobile shell.
  - Below 700 px: cards, a full-screen sheet for details, and a bottom dialog for Reset.
- `/admin/users` keeps its nav items. The "Disabled" item becomes a status filter link.

**Interfaces:**
- **Consumes:** Task 3's actions, the `listUsers` shape, `searchLinkableEmployees` and `roleChangeNote`; Task 2's `PasswordFields`.

- [ ] **Step 1: Write the failing tests** (`renderToStaticMarkup`)
  - **List and filters:**
    - the statuses' words and dots;
    - the waiting chip appears only when `pendingCount > 0`, with "Waiting for approval · {n}";
    - role tabs with their counts.
  - **Panel by account:**
    - the PENDING panel shows Approve and Decline, and no switch;
    - the permanent admin's panel shows the lock copy, with the switch and Reset disabled;
    - your own panel has the switch disabled.
  - **Panel copy:**
    - the role-change note's verbatim copy;
    - the offboarded note;
    - the Unsaved bar shows only when a field differs.
  - **Accessibility:** the switch has `role="switch"` and `aria-checked`.
  - **Add user:** the sheet shows the domain hint and the role cards; the temp-password box has Copy.
  - **Cards:** the card list markup is present for the narrow layout.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement. Use app tokens and components (`ui/drawer`, `ui/dialog`, `ui/toast`) and match the V2 boards.
- [ ] **Step 4:** All green.
- [ ] **Step 5: Commit**: `feat(admin): Users & access — list, details panel, add, approve, reset and the account switch, on every screen size`

### Task 5: Browser tests, docs (deploy after the owner's word)

- New `e2e/access-management.spec.ts`:
  - **Create to workspace:** an admin creates a Finance user; that user signs in with the temp password, lands on `/welcome/password`, chooses a password, and lands on `/finance/assets`.
  - **Deep link while a password is owed:** `/inventory` redirects to `/welcome/password`.
  - **Reset:** the user's second browser context is signed out on its next navigation.
  - **Role change:** IT → Finance; the old IT page redirects to the Finance landing.
  - **Turn off:** the user is signed out, and sign-in is refused.
  - **Sign-up:**
    - sign-up shows "Wait for an admin to approve your account.";
    - sign-in shows the PENDING copy;
    - an admin approves with a role and link, and sign-in then works;
    - after a decline, sign-in shows the DECLINED copy.
  - **Three wrong passwords:** the pause copy, the same for an unknown email.
  - **Account settings:** change password; a wrong current password shows its copy.
  - **Permanent admin:** the panel is locked.
  - **axe:** Users & access, Add user, Account settings and `/welcome/password`, in light and dark, at 1440 and 375 px.
- Repair the specs that touch sign-up or `/admin/users`: `login-cris`, `axe-sweep`, `admin`, and any that pin "Users & roles".
- Seed: give the five seed accounts `approvalState` APPROVED. Their passwords stay as they are, per the owner.
- Docs:
  - a HANDOVER block, plus a note that existing accounts keep the shared seed password (the owner's choice), and that `npm run admin:recover` exists;
  - PICKUP status lines;
  - `.env.example`: drop `SIGNUP_REQUIRES_APPROVAL`.
- Commits: `test(e2e): users & access, first sign-in, approval, the sign-in pause` and `docs(handover): users & access`.
