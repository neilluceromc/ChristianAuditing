# Phase 36 — Own tags, real types, people search, a schedule that scales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff type every asset tag themselves, and Register always asks a real type; the Laptop types are fixed by a data-only migration. Employee pickers and the Assigned filter search the server instead of shipping 600 names. The depreciation Schedule shows categories first, with paged drill-down.

**Architecture:**
- **One tag rule.** `TAG_SHAPE` in `src/lib/tag-key.ts` changes, with one shared refusal message `TAG_RULE`. Every consumer (Register, receiving, import, search jump) follows it.
- **Register.** It drops its tag suggestion (`nextTags` / `prefixFor` / the prefix fold-out) and makes every tag box editable and empty. The model box stops setting the type; a plain Type select is required whenever the category has two or more types.
- **Server.** The server rule becomes "the category has types ⇒ a type is required".
- **Data.** Migration 29 renames and adds Laptop types and moves BR-LT-0201. The seed matches.
- **People search.** One server action `searchPeople` (≤10 results) feeds a `PeopleCombobox` (every holder picker) and a searchable Assigned filter. Pages stop loading every employee.
- **Schedule.** It shows the category summary by default; `?cat=` drills into one category, paged. The export is unchanged.

**Tech Stack:** Next.js 15 App Router, Prisma 6 / Postgres 16, zod, vitest (pure), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-16-own-tags-and-real-types-design.md` (`efa6b1c`, §4–§5 added after the scale measurement). Read it first; it is the authority.

## Global Constraints

**Where the work happens**
- Do the work in the worktree `.claude/worktrees/phase-36-own-tags-real-types`, on branch `phase-36-own-tags-real-types`.
- `.env` there points at `inventory_dev` with `APP_BASE_URL=http://192.168.1.193:3100`, and has no `SEED_PASSWORD` or `QUICK_LOGIN_EMAILS`.
- Never read or print `.env`. Never touch the `inventory` database or port 3000.

**Database and migrations**
- Apply migrations with `npx prisma migrate deploy` only. Never run `prisma migrate dev` or `prisma migrate reset`.
- `npm run db:seed` runs only on `inventory_dev`, last after e2e work.

**Playwright**
- Run it in the **foreground only**: `E2E_PORT=3100 npx playwright test <files> --workers=1 --global-timeout=540000`, with a Bash timeout of 600000.
- Never use `run_in_background` or the Monitor tool. One process at a time.
- Check port 3100 before and after each run.

**Git**
- Never amend. Never run `git stash`, `checkout`, `restore`, `reset` or `switch`.
- `git add` new files before a pathspec commit. Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Repo files are CRLF. Use the Edit tool (never `sed -i`); new files are CRLF.

**House rules**
- Product aria-labels near a field never contain that field's label word.
- `AuditEntry` is append-only.
- Server actions follow `actionRole` → `checkRate` → zod.

**Spec values**
- **Tag shape:** `TAG_SHAPE = /^[A-Z0-9][A-Z0-9._-]{0,19}$/`, tested after `trim().toUpperCase()`.
- **Refusal text** (`TAG_RULE`): **"Tags are 1–20 letters, digits, - _ or ., no spaces"**.
- **Empty tag in Register:** **"Enter a tag for every unit"**.
- **Type:**
  - the Type select is shown when the category has ≥2 types;
  - it is required, with refusal **"Pick the type"**, and starts empty;
  - with exactly 1 type it is set silently;
  - with 0 types the asset gets no type;
  - the model never sets the type.
- **Migration 29** `20261016090000_laptop_types`, data only, on the IT-class category named `Laptop`:
  1. rename "Dell Latitude" → "Standard";
  2. rename "ThinkPad" → "High-performance";
  3. insert "MacBook" unless it exists (case-insensitive);
  4. set BR-LT-0201's type to MacBook when that asset exists in Laptop.

  Every step is guarded, and no audit rows are written.
- **Seed:** Laptop types `["Standard", "High-performance", "MacBook"]`; BR-LT-0201 uses MacBook.
- **People search:**
  - `searchPeople({ q, scope: "active" })` (pickers only; the Assigned filter uses `searchAssignees`), where `q` is 1–60 characters trimmed, matched case-insensitively as a substring of the name or employee no.;
  - at most **10** results, ordered by name then employee no.;
  - debounce **250 ms**;
  - Recent shows at most **5** active people.
  - Empty-result text: **"No match — check the spelling or the employee no."**
- **Assigned filter:** the value `none` = Unassigned (`assigneeId IS NULL`); the button reads "Assigned" / "Assigned: {n}".
- **Schedule:** the default is the category summary; `?cat=<categoryId>` shows the drill-down paged by `ENTITY_PAGE_SIZE`, with the category subtotal and a "← All categories" link. The export is unchanged.

## Review Focus

1. **A tag typed in lower case, or with spaces around it.** It saves upper-cased and trimmed, and the uniqueness check sees `acc-1` and `ACC-1` as one. *(Task 1 test on `tagKey` + `TAG_SHAPE`; Task 3 e2e types lower-case.)*
2. **A pasted tag column longer than the batch, or with blank lines.** It grows the batch up to 200 and skips nothing silently: blank cells become empty tags that then refuse. *(Task 2 test of `pasteColumn`.)*
3. **An old seeded tag typed again (`BR-LT-0148`).** It refuses as already registered, with the link. *(Task 3 e2e.)*
4. **Changing category after choosing a type.** The type resets and is asked again. Typed tags are kept. *(Task 2 test of the pure form rule.)*
5. **Migration 29 on a database where Laptop has no "Dell Latitude"** (a fresh seed or the dev DB). It changes nothing and does not fail. *(Task 4: run `migrate deploy` on `inventory_dev` after a fresh seed and check the type list.)*

## Decisions taken in this plan

- **P-1.** `nextTags`, `prefixFor`, `RUN_REFUSAL` and the tag-number helpers in `src/lib/receiving.ts` are **deleted** if nothing else uses them after Task 3 (`grep -rn "nextTags\|prefixFor" src`), together with their tests. The register page stops loading `highestByPrefix` / `prefixCountsByCategory`. Category `tagPrefix` stays in the data and Admin (spec ruling 5).
- **P-2.** The Register **"Tag prefix and notes"** fold-out loses its prefix field; Notes stays (in the same fold-out, renamed **"Notes"**).
- **P-3.** The Type select's accessible name becomes **"Type"**, which replaces "New model — which type?". The model list rows stop showing a type.
- **P-4.** `newModelNeedsType` and `NEW_MODEL_TYPE` (`register-queries.ts`) are replaced by `typeRequired(categoryId, typeId)` with the message `TYPE_REQUIRED = "Pick the type"`, used by both `createAsset` and `registerAssets`.
- **P-5.** `KnownModel.typeId` and `resolveModelType` are removed if nothing else uses them (`src/lib/known-models.ts` keeps `mergeKnownModels` / `matchModels`).
- **P-7.** `activeEmployeeOptions()` is deleted if no caller remains after Task 5. `facetOptions` stops loading every assignee (Task 6).
- **P-8.** `scheduleYear` stays (the export uses it). The page uses a new `scheduleSummary` (category rows + total, no asset rows) and `scheduleCategory` (one category's rows, paged).
- **P-6.** e2e pins that pick "ThinkPad" via "New model — which type?" become "High-performance" via "Type". Pins that relied on a suggested tag type their own tag: a unique `E2E-<n>-<rand>` built per test.

---

## File structure

**Create**
- `prisma/migrations/20261016090000_laptop_types/migration.sql`
- `src/lib/register-type.ts` and `src/lib/register-type.test.ts`: the pure Type rule.
- `e2e/own-tags-types.spec.ts`

**Modify**
- `src/lib/tag-key.ts` (and its test, if any).
- `src/lib/register-rows.ts` and `src/lib/register-rows.test.ts`
- `src/lib/import-vocabulary.ts`, `src/lib/import-assets.ts` and tests.
- `src/lib/receiving.ts` (P-1).
- `src/lib/known-models.ts` (P-5).
- `src/server/modules/inventory/actions.ts`, `src/server/modules/purchases/receiving.ts`, `src/server/modules/inventory/register-queries.ts`
- `src/components/inventory/register-form.tsx`, `serial-section.tsx`, `register-rows.tsx`, `model-combobox.tsx`
- The register page (`grep -rln "RegisterForm" "src/app/(app)"`).
- `src/app/dev/kitchen-sink/page.tsx` (hint text).
- `prisma/seed.ts`
- e2e specs that pin "ThinkPad" / "New model — which type?" / suggested tags; the docs.

---

### Task 1: One tag rule everywhere

**Files:**
- Modify: `src/lib/tag-key.ts`, `src/lib/register-rows.ts`, `src/lib/import-vocabulary.ts`, `src/lib/import-assets.ts`, `src/server/modules/inventory/actions.ts`, `src/server/modules/purchases/receiving.ts`, `src/app/dev/kitchen-sink/page.tsx`
- Test: `src/lib/tag-key.test.ts` (create if missing), `src/lib/register-rows.test.ts`, `src/lib/import-assets.test.ts`

**Interfaces — Produces:**

```ts
// src/lib/tag-key.ts
export const TAG_SHAPE: RegExp;   // /^[A-Z0-9][A-Z0-9._-]{0,19}$/
export const TAG_RULE: string;    // "Tags are 1–20 letters, digits, - _ or ., no spaces"
// tagKey(raw) unchanged: trim + upper-case
// src/lib/register-rows.ts
export const TAG_EMPTY: string;   // "Enter a tag for every unit"
export function badTags(rows: readonly RegisterRow[]): { message: string | null; rows: Set<number> }; // `example` param removed
```

- [ ] **Step 1: Failing tests.** Add to `src/lib/tag-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TAG_RULE, TAG_SHAPE, tagKey } from "./tag-key";

describe("TAG_SHAPE (Phase 36 spec §2.1)", () => {
  it("accepts any 1-20 letters, digits, - _ . starting alphanumeric", () => {
    for (const t of ["BR-LT-0148", "ACC-LAP-001", "2026-0042", "A", "LT_1.2", "X".repeat(20)]) expect(TAG_SHAPE.test(t)).toBe(true);
  });
  it("refuses empty, a leading - or ., spaces, slashes, 21 chars and non-ASCII", () => {
    for (const t of ["", "-LT", ".X", "A B", "A/B", "X".repeat(21), "Ñ"]) expect(TAG_SHAPE.test(t)).toBe(false);
  });
  it("tagKey trims and upper-cases before the test (Review Focus 1)", () => {
    expect(tagKey("  acc-1 ")).toBe("ACC-1");
    expect(TAG_SHAPE.test(tagKey(" acc-1 "))).toBe(true);
  });
  it("names the rule", () => {
    expect(TAG_RULE).toBe("Tags are 1–20 letters, digits, - _ or ., no spaces");
  });
});
```

  In `register-rows.test.ts`, replace the `badTags` cases with these:

```ts
it("badTags: empty tags ask for a tag; bad shapes name the rule", () => {
  expect(badTags([{ tag: "", serial: "" }, { tag: "ok-1", serial: "" }]).message).toBe("Row 1 · Enter a tag for every unit");
  expect(badTags([{ tag: "A B", serial: "" }]).message).toBe("Row 1 · A B: Tags are 1–20 letters, digits, - _ or ., no spaces");
  expect(badTags([{ tag: "acc-1", serial: "" }]).rows.size).toBe(0);
  expect(badTags([{ tag: "", serial: "" }, { tag: "", serial: "" }]).message).toBe("Row 1 · Enter a tag for every unit and 1 more");
});
```

  Run `npx vitest run src/lib/tag-key.test.ts src/lib/register-rows.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement.**
  - In `tag-key.ts`, replace the `TAG_SHAPE` block (and its doc comment) with:

```ts
/**
 * Phase 36 (spec §2.1): the asset tag is whatever staff type — 1-20 letters, digits, `-`, `_` or `.`,
 * starting with a letter or digit, tested after `tagKey` (trim + upper-case). No spaces and no `/`,
 * because the tag is one segment of `/inventory/scan/<tag>`; no leading `.` so `.`/`..` never occur.
 * ONE definition: Register, receiving, the CSV import and the search jump all use it.
 */
export const TAG_SHAPE = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
export const TAG_RULE = "Tags are 1–20 letters, digits, - _ or ., no spaces";
```

  - In `register-rows.ts`, `badTags` drops `example`:

```ts
export const TAG_EMPTY = "Enter a tag for every unit";

/** Phase 36: rows with no tag, or a tag outside TAG_SHAPE (upper-casing is the server's job, so case is forgiven). */
export function badTags(rows: readonly RegisterRow[]): { message: string | null; rows: Set<number> } {
  const bad = rows.flatMap((r, i) => (TAG_SHAPE.test(tagKey(r.tag)) ? [] : [i]));
  if (bad.length === 0) return { message: null, rows: new Set() };
  const first = rows[bad[0]].tag.trim();
  const what = first ? `${first}: ${TAG_RULE}` : TAG_EMPTY;
  return { message: `Row ${bad[0] + 1} · ${what}${more(bad.length - 1)}`, rows: new Set(bad) };
}
```

    Fix its one caller in `register-form.tsx` (`rowFeedback`/`badTags(…, example.tag)`) to drop the argument, and import `TAG_RULE` where needed.
  - In `actions.ts` (`createSchema.tag`) and `purchases/receiving.ts` (`tags` array), replace `"Format: BR-XX-0000"` with `TAG_RULE`.
  - In `import-vocabulary.ts` (around line 289), the bad-tag explanation becomes: "The Tag column on these rows isn't a valid tag — " + TAG_RULE + "." Update the `import-assets.ts` comment at line ~483. In `import-assets.test.ts`, any case that expected `bad-tag` for a value now valid (e.g. `LT-0001`) changes its input to something invalid (`LT 0001`).
  - In `kitchen-sink/page.tsx`, the hint becomes `TAG_RULE`.
  - Run `grep -rn "BR-XX-0000" src` and fix any remaining user-facing text.

- [ ] **Step 3: Run.** Run `npx vitest run && npx tsc --noEmit && npm run lint`. Expected: green.
- [ ] **Step 4: Commit.**

```bash
git add src/lib src/server/modules/inventory/actions.ts src/server/modules/purchases/receiving.ts src/app/dev/kitchen-sink/page.tsx src/components/inventory/register-form.tsx
git commit -m "feat(tags): one tag rule -- any 1-20 letters, digits, - _ . (upper-cased, unique) for Register, receiving, import and the search jump"
```

---

### Task 2: The Type rule and the server

**Files:**
- Create: `src/lib/register-type.ts`, `src/lib/register-type.test.ts`
- Modify: `src/server/modules/inventory/register-queries.ts`, `src/server/modules/inventory/actions.ts` (`createAsset`), `src/server/modules/purchases/receiving.ts` (`registerAssets`), `src/lib/register-rows.ts` (+test)

**Interfaces — Produces:**

```ts
// src/lib/register-type.ts
export const TYPE_REQUIRED = "Pick the type";
export function typeChoice(types: ReadonlyArray<{ id: string }>): { show: boolean; required: boolean; auto: string | null };
// 0 types → { show:false, required:false, auto:null }; 1 → { show:false, required:false, auto:id }; ≥2 → { show:true, required:true, auto:null }
export function typeAfterCategoryChange(): string; // always "" — the type is asked again
// src/server/modules/inventory/register-queries.ts
export async function typeRequired(categoryId: string, typeId: string | undefined): Promise<boolean>; // true when no typeId and the category has ≥1 type
// src/lib/register-rows.ts
export function pasteColumn(rows: readonly RegisterRow[], at: number, values: readonly string[], field: "tag" | "serial"): { rows: RegisterRow[]; pasted: number };
```

- [ ] **Step 1: Failing tests** (`src/lib/register-type.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { TYPE_REQUIRED, typeAfterCategoryChange, typeChoice } from "./register-type";

describe("typeChoice (Phase 36 spec §3.1)", () => {
  it("0 types: nothing asked, no type", () => expect(typeChoice([])).toEqual({ show: false, required: false, auto: null }));
  it("1 type: set silently", () => expect(typeChoice([{ id: "t1" }])).toEqual({ show: false, required: false, auto: "t1" }));
  it("2+ types: asked and required, never pre-filled", () =>
    expect(typeChoice([{ id: "a" }, { id: "b" }])).toEqual({ show: true, required: true, auto: null }));
  it("a category change asks again (Review Focus 4)", () => expect(typeAfterCategoryChange()).toBe(""));
  it("message", () => expect(TYPE_REQUIRED).toBe("Pick the type"));
});
```

  Add to `register-rows.test.ts` (Review Focus 2):

```ts
it("pasteColumn fills tags or serials from the row down, growing to at most 200; blanks stay blank", () => {
  const out = pasteColumn([{ tag: "", serial: "" }], 0, ["a-1", "", "a-3"], "tag");
  expect(out.rows.map((r) => r.tag)).toEqual(["a-1", "", "a-3"]);
  expect(out.pasted).toBe(3);
  const s = pasteColumn([{ tag: "x", serial: "" }], 0, ["S1"], "serial");
  expect(s.rows).toEqual([{ tag: "x", serial: "S1" }]);
  expect(pasteColumn([], 0, Array.from({ length: 250 }, (_, i) => `t${i}`), "tag").rows).toHaveLength(200);
});
```

  Run them. Expected: FAIL.

- [ ] **Step 2: Implement.**
  - **`register-type.ts`:**

```ts
/** Phase 36 (spec §3.1): Register always asks the type — never copied from an older asset of the same model. */
export const TYPE_REQUIRED = "Pick the type";

export function typeChoice(types: ReadonlyArray<{ id: string }>): { show: boolean; required: boolean; auto: string | null } {
  if (types.length === 0) return { show: false, required: false, auto: null };
  if (types.length === 1) return { show: false, required: false, auto: types[0].id };
  return { show: true, required: true, auto: null };
}

export function typeAfterCategoryChange(): string {
  return "";
}
```

  - **`register-rows.ts`:** replace `pasteSerials` with `pasteColumn`. There are no suggested tags any more, so `resizeRows` / `retagRows` drop their `runTags` parameter; new rows are `{ tag: "", serial: "" }`.

```ts
/** Resize to `count` rows: existing rows stay as typed, new rows are empty (Phase 36: no suggested tags). */
export function resizeRows(rows: readonly RegisterRow[], count: number): RegisterRow[] {
  return Array.from({ length: count }, (_, i) => rows[i] ?? { tag: "", serial: "" });
}

/** Paste a column of tags or serials at row `at`: fills that row and those below, growing (never shrinking) up to MAX_BATCH. */
export function pasteColumn(rows: readonly RegisterRow[], at: number, values: readonly string[], field: "tag" | "serial") {
  const pasted = Math.max(0, Math.min(values.length, MAX_BATCH - at));
  const grown = resizeRows(rows, Math.max(rows.length, at + pasted));
  return { rows: grown.map((r, i) => (i >= at && i < at + pasted ? { ...r, [field]: values[i - at] } : r)), pasted };
}
```

    Delete `retagRows` and `pasteSerials`. Update their tests: delete the cases that pinned suggested tags, and keep the resize semantics with empty new rows.
  - **`register-queries.ts`:** replace `NEW_MODEL_TYPE` / `newModelNeedsType` with:

```ts
/** Phase 36 (spec §3.1, plan P-4): a category with types needs one picked; no model ever supplies it. */
export async function typeRequired(categoryId: string, typeId: string | undefined): Promise<boolean> {
  if (typeId) return false;
  return (await prisma.assetType.count({ where: { categoryId } })) > 0;
}
```

    If `register-queries.ts`'s known-model loader returns `typeId` per model only for the type copy, drop that field (P-5) and simplify `src/lib/known-models.ts` (remove `resolveModelType` and `KnownModel.typeId`) once Task 3 no longer uses them. Leave the removal to Task 3 if Task 3's file still imports them; note it in the report.
  - **`actions.ts` (`createAsset`) and `purchases/receiving.ts` (`registerAssets`):** `else if (category && (await typeRequired(d.categoryId, d.typeId))) errors.typeId = TYPE_REQUIRED;`.

- [ ] **Step 3: Run.** Run `npx vitest run && npx tsc --noEmit && npm run lint`. Expected: green. (`register-form.tsx` breaks on the removed helpers. Make the minimal compile fix: `resizeRows(rs, n)` and `pasteColumn(..., "serial")`. Task 3 rebuilds the form.)
- [ ] **Step 4: Commit.**

```bash
git add src/lib src/server/modules/inventory src/server/modules/purchases/receiving.ts src/components/inventory/register-form.tsx
git commit -m "feat(register): the Type rule -- asked whenever the category has types, never copied from a model; paste fills tags or serials; server requires a type when the category has any"
```

---

### Task 3: Register — typed tags and the Type select

**Files:**
- Modify: `src/components/inventory/register-form.tsx`, `serial-section.tsx`, `register-rows.tsx`, `model-combobox.tsx`, the register page (loader props), `src/lib/known-models.ts` (P-5), `src/lib/receiving.ts` (P-1) and their tests.

**Interfaces:**
- Consumes: `TAG_SHAPE`, `TAG_RULE`, `tagKey` (Task 1); `badTags`, `TAG_EMPTY`, `pasteColumn`, `resizeRows` (Tasks 1–2); `typeChoice`, `TYPE_REQUIRED` (Task 2).
- Produces the DOM contract (e2e relies on it):
  - **One unit:** next to the serial box there is a text input labelled **"Tag"**, empty, `autoComplete="off"`. It is placed **before** Serial in the DOM order. The old read-only "tag BR-…" chip is gone.
  - **Batch:** each row has inputs labelled **"Tag {n}"** and **"Serial {n}"**, tag first, both empty on growth.
    - Pasting multiple lines into a Tag box fills that row and those below, with the status note "Pasted {k} tags" (or "Pasted {k} of {m} tags — the rest were not added.").
    - The serial paste keeps its wording.
    - The hint reads "Paste a column of tags or serials into any row to fill it and the rows below."
  - **Type:** when `typeChoice(types).show`, a `<select>` labelled **"Type"** (P-3) with a first empty option "Pick a type…" and the category's types by name. Required: the status line lists "the type", and submit refuses with `TYPE_REQUIRED` under it.
    - Choosing a model never changes it.
    - Changing the category resets it to "".
    - With one type, the type is set silently and no select shows.
  - **Model list:** rows show the model name and stock count only (no type).
  - **Empty tags:** they block submit with `badTags`' message (Task 1 wording). The status line lists "{n} tags".
  - **"Register and add another":** clears every tag box (one empty row); the category, model and type are kept per the existing rule R7.
  - **Fold-out (P-2):** "Tag prefix and notes" becomes **"Notes"**, with the prefix field removed.

- [ ] **Step 1: Strip the suggestion (P-1).**
  - Remove from `register-form.tsx`: `prefix` state, `written`, `highestOf`, `runFor`, `run`, `prefixError`, `needsPrefix`, `changePrefix`, the prefix input, the `nextTags` / `prefixFor` / `RUN_REFUSAL` import, and the `highestByPrefix` / `prefixCountsByCategory` props.
  - Remove the matching loader fields on the register page (find the page with `grep -rln "highestByPrefix" src`). Remove their queries if now unused.
  - Then `grep -rn "nextTags\|prefixFor\|RUN_REFUSAL" src`. If only `src/lib/receiving.ts` and its test remain, delete those functions and their tests (P-1). Keep any other export still imported elsewhere.
- [ ] **Step 2: Editable tags.**
  - `serial-section.tsx` (single unit): replace the `tag {rows[0].tag || "—"}` span with an `Input` labelled "Tag" (via a visible `<label>` or `FormField`), placed before the serial box. Mark it invalid when `invalidTags.has(0)`, and on change call `onTag(0, value)`.
  - `register-rows.tsx`: keep the tag input (already present). Remove `tagPlaceholder` (no example tag; placeholder "e.g. ACC-LAP-001").
  - Add an `onPasteTags` prop mirroring `onPasteSerials`. The form's `pasteColumn(rows, at, values, "tag" | "serial")` drives both.
  - Keep `useIdentifierCheck` (live "already registered" link) unchanged.
- [ ] **Step 3: The Type select.**
  - In `model-combobox.tsx`, remove `types` / `typeId` / `onType` / `typeError` props, `takeType`, `resolveModelType` use, the auto-set effect and the type select. It becomes a model box only, and its rows drop the type name.
  - In `register-form.tsx`, render the Type `<select>` after the model box per the DOM contract.
    - Use `typeChoice(types)`. In `chooseCategory`, set `typeId` to `typeChoice(newTypes).auto ?? typeAfterCategoryChange()`.
    - The status line: replace the `newModelNeedsType` / `resolveModelType` lines with `if (typeChoice(types).required && !typeId) still.push("the type")`.
    - Submit refuses client-side with `TYPE_REQUIRED` in `errors.typeId`.
  - In `src/lib/known-models.ts`, remove `resolveModelType` and `KnownModel.typeId` if unused (P-5), with their tests. Remove the loader's per-model `typeId` if it only fed this.
- [ ] **Step 4: Run.**
  - Run `npx tsc --noEmit && npm run lint && npx vitest run`.
  - Then run the foreground Playwright `e2e/register-labels.spec.ts` alone to see what breaks (expected: pins on suggested tags / "New model — which type?"). **Do not fix e2e here**; record the failures in the report for Task 5.
  - Smoke the page with `npm run dev -- -p 3100` and a curl of `/inventory/register` (expect 307 to login). Stop the server.
- [ ] **Step 5: Commit.**

```bash
git add -A src
git commit -m "feat(register): staff type every tag (single box or rows, paste a column), no suggested numbers or prefix; Type is its own required select, never set by the model"
```

---

### Task 4: Migration 29 (Laptop types) and the seed

**Files:**
- Create: `prisma/migrations/20261016090000_laptop_types/migration.sql`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: The migration (data only, guarded, idempotent):**

```sql
-- Phase 36 (spec §3.2): Laptop types become real kinds. Data only; each step is a no-op when its source is missing.
DO $$
DECLARE
  laptop TEXT;
  mac TEXT;
BEGIN
  SELECT id INTO laptop FROM "AssetCategory" WHERE name = 'Laptop' AND cls = 'IT';
  IF laptop IS NULL THEN
    RETURN;
  END IF;

  -- 1. "Dell Latitude" → "Standard" (assets and kit slots keep the same row)
  UPDATE "AssetType" SET name = 'Standard'
   WHERE "categoryId" = laptop AND name = 'Dell Latitude'
     AND NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = laptop AND lower(name) = 'standard');

  -- 2. "ThinkPad" → "High-performance"
  UPDATE "AssetType" SET name = 'High-performance'
   WHERE "categoryId" = laptop AND name = 'ThinkPad'
     AND NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = laptop AND lower(name) = 'high-performance');

  -- 3. "MacBook", unless present in any case
  IF NOT EXISTS (SELECT 1 FROM "AssetType" WHERE "categoryId" = laptop AND lower(name) = 'macbook') THEN
    INSERT INTO "AssetType" (id, name, "categoryId") VALUES (gen_random_uuid()::text, 'MacBook', laptop);
  END IF;
  SELECT id INTO mac FROM "AssetType" WHERE "categoryId" = laptop AND lower(name) = 'macbook';

  -- 4. BR-LT-0201 (MacBook Air M3) → MacBook, only when it is a Laptop
  UPDATE "Asset" SET "typeId" = mac WHERE tag = 'BR-LT-0201' AND "categoryId" = laptop;
END $$;
```

  Before writing it, check `model AssetType` in `prisma/schema.prisma` for other NOT NULL columns without defaults (e.g. `createdAt`). Add them to the INSERT if needed. Check that `cls` is the column name on `AssetCategory`.
- [ ] **Step 2: Seed.**
  - In `prisma/seed.ts` line ~82: `Laptop: { cls: "IT", types: ["Standard", "High-performance", "MacBook"], prefix: "LT" }`.
  - BR-LT-0201's `mk(...)` call gains `{ typeId: cats["Laptop"].typeIds[2], … }`, merged into its existing options object.
  - Grep the seed for any other use of the old names.
- [ ] **Step 3: Verify both paths (Review Focus 5).**
  1. Run `npx prisma migrate deploy` on `inventory_dev` (it currently holds the OLD seed: Dell Latitude/ThinkPad). Expected: 29 migrations; the Laptop types read Standard, High-performance, MacBook; BR-LT-0201 is MacBook. Check with a `npx prisma db execute --stdin` SELECT, or a small `tsx` script that prints the names (no `.env` printing).
  2. Run `npm run db:seed` (inventory_dev only), then `npx prisma migrate deploy` again. Expected: "No pending migrations"; the seed itself yields the same three types.
  3. Re-running the migration's SQL body manually against `inventory_dev` must change nothing (idempotent).
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`.
- [ ] **Step 5: Commit.**

```bash
git add prisma/migrations/20261016090000_laptop_types/migration.sql prisma/seed.ts
git commit -m "feat(db): migration 29 -- Laptop types Standard / High-performance / MacBook (rename Dell Latitude and ThinkPad, add MacBook, BR-LT-0201 to MacBook; guarded, data only); seed matches"
```

---

### Task 5: People search and the PeopleCombobox

**Files:**
- Create: `src/lib/people-search.ts` (+ `.test.ts`), `src/server/modules/employees/people-search.ts` ("use server"), `src/components/patterns/people-combobox.tsx`
- Modify: `src/server/modules/employees/queries.ts` (add `recentPeopleOptions`; delete `activeEmployeeOptions` if unused, P-7), the pages `src/app/(app)/inventory/page.tsx`, `src/app/(app)/inventory/[id]/(record)/layout.tsx`, `src/app/(app)/inventory/register/page.tsx`, `src/app/(app)/stock/issue/page.tsx`, and the pickers `src/components/inventory/holder-control.tsx`, `bulk-drawer.tsx`, `replace-control.tsx`, `register-initial-state.tsx`, `inventory-table.tsx`, `record-actions.tsx`, `register-form.tsx`, `src/components/stock/issue-form.tsx`.

**Interfaces — Produces:**

```ts
// src/lib/people-search.ts (pure)
export const PEOPLE_LIMIT = 10;
export const PEOPLE_DEBOUNCE_MS = 250;
export const RECENT_PEOPLE = 5;
export const PEOPLE_NONE = "No match — check the spelling or the employee no.";
export const peopleQuerySchema; // z.object({ q: z.string().trim().min(1).max(60), scope: z.literal("active") })
export function peopleWhere(q: string, scope: "active" | "assignees", cls?: AssetClass): Prisma.EmployeeWhereInput;
// server action
export async function searchPeople(input: unknown): Promise<ActionResult<ComboOption[]>>; // ComboOption = { value, label, sub }
// queries
export async function recentPeopleOptions(userId: string): Promise<ComboOption[]>; // the user's recent employee picks, ACTIVE only, max 5
// client
export function PeopleCombobox(props: { id?: string; "aria-describedby"?: string; invalid?: boolean; value: string | null; valueLabel?: string | null; recent: ComboOption[]; onChange: (id: string | null, option?: ComboOption) => void; placeholder?: string }): JSX.Element;
```

- [ ] **Step 1: Failing tests** (`src/lib/people-search.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { peopleQuerySchema, peopleWhere } from "./people-search";

describe("people search (Phase 36 spec §4.1)", () => {
  it("q is 1-60 trimmed characters; scope is required", () => {
    expect(peopleQuerySchema.safeParse({ q: " ana ", scope: "active" }).success).toBe(true);
    expect(peopleQuerySchema.safeParse({ q: "  ", scope: "active" }).success).toBe(false);
    expect(peopleQuerySchema.safeParse({ q: "x".repeat(61), scope: "active" }).success).toBe(false);
    expect(peopleQuerySchema.safeParse({ q: "ana" }).success).toBe(false);
  });
  it("active scope: ACTIVE employees by name or employee no.", () => {
    expect(peopleWhere("ana", "active")).toEqual({
      employment: "ACTIVE",
      OR: [{ name: { contains: "ana", mode: "insensitive" } }, { employeeNo: { contains: "ana", mode: "insensitive" } }],
    });
  });
  it("assignees scope: anyone holding an asset of the class", () => {
    expect(peopleWhere("042", "assignees", "IT")).toEqual({
      assets: { some: { cls: "IT" } },
      OR: [{ name: { contains: "042", mode: "insensitive" } }, { employeeNo: { contains: "042", mode: "insensitive" } }],
    });
  });
});
```

  Run them (FAIL), then implement `people-search.ts` to match.
- [ ] **Step 2: Server.**
  - **`searchPeople`:** guard `actionRole("admin", "it_staff", "purchasing_staff")` → `checkRate(user.id, "check")` (the live-check kind, 240/min, so typing never spends the write budget) → `peopleQuerySchema`. Then `prisma.employee.findMany({ where: peopleWhere(...), orderBy: [{ name: "asc" }, { employeeNo: "asc" }], take: PEOPLE_LIMIT, select: { id, name, employeeNo } })`, mapped to `{ value: id, label: name, sub: employeeNo }`.
  - **`recentPeopleOptions(userId)`:** `recentPicks(userId, "employee")` → first `RECENT_PEOPLE` ids → active employees in that order.
- [ ] **Step 3: `PeopleCombobox`.**
  - Wrap `EntityCombobox` (read `src/components/patterns/entity-combobox.tsx` first; extend it minimally if it cannot take externally changing `options` or report typed text).
  - **Before typing:** options = `recent`.
  - **On input:** debounce `PEOPLE_DEBOUNCE_MS`, call `searchPeople({ q, scope: "active" })`, set options to the result. Show `PEOPLE_NONE` when empty.
  - **Value:** the selected value is always in `options` (add `{ value, label: valueLabel }` if missing) so the input shows its name.
  - **Races:** ignore out-of-order responses (a request counter).
- [ ] **Step 4: Swap the pickers.**
  - Every picker that took `employees: ComboOption[]` (plus `recentEmployees`) takes `recentPeople: ComboOption[]` instead and renders `PeopleCombobox`.
  - The four pages pass `recentPeopleOptions(user.id)` and stop calling `activeEmployeeOptions()`.
  - Where a picker shows a current holder by name (e.g. Replace), pass `valueLabel`.
  - Then `grep -rn "activeEmployeeOptions" src`; delete it if unused (P-7).
- [ ] **Step 5: Run.** Run `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: green.
- [ ] **Step 6: Commit.**

```bash
git add -A src
git commit -m "feat(people): holder pickers search the server as you type (10 results, recent picks first); pages stop loading every employee"
```

---

### Task 6: The Assigned filter searches

**Files:**
- Create: `src/components/patterns/people-facet.tsx`
- Modify: `src/lib/inventory-list.ts` (+test), `src/server/modules/inventory/queries.ts` (`facetOptions`), `src/server/modules/employees/people-search.ts` (counts), `src/components/inventory/inventory-toolbar.tsx`

**Interfaces:**
- Consumes: `searchPeople`, `peopleWhere`, `PEOPLE_DEBOUNCE_MS`, `PEOPLE_NONE` (Task 5).
- Produces:

```ts
// src/lib/inventory-list.ts
export const UNASSIGNED = "none";
export function assigneeWhere(values: readonly string[]): Prisma.AssetWhereInput | null; // ids and/or "none"
// src/server/modules/employees/people-search.ts
export async function searchAssignees(input: unknown): Promise<ActionResult<Array<{ value: string; label: string; sub: string; count: number }>>>;
// input: { q, cls, listQS } — listQS is the serialized list state; counts use buildAssetWhere(without("assignee"))
```

- [ ] **Step 1: Failing test** (`inventory-list.test.ts`):

```ts
it("assigneeWhere: ids, Unassigned, and both", () => {
  expect(assigneeWhere([])).toBeNull();
  expect(assigneeWhere(["e1", "e2"])).toEqual({ assigneeId: { in: ["e1", "e2"] } });
  expect(assigneeWhere(["none"])).toEqual({ assigneeId: null });
  expect(assigneeWhere(["e1", "none"])).toEqual({ OR: [{ assigneeId: { in: ["e1"] } }, { assigneeId: null }] });
});
```

  Implement it, and use it in `buildAssetWhere` in place of `where.assigneeId = { in: f.assignee }` (push into the `and` list).
- [ ] **Step 2: `facetOptions`.**
  - Drop the `prisma.employee.findMany({ where: { assets: { some: { cls } } } })` and the all-assignee groupBy.
  - Instead return `assignee`: the **selected** people (ids from `state.filters.assignee` minus `none`) with names and counts (one groupBy restricted to those ids), plus `{ value: "none", label: "Unassigned", count }`.
- [ ] **Step 3: `searchAssignees`.** Guard `actionRole("admin", "it_staff", "purchasing_staff", "finance_staff", "viewer")` plus `canSeeClass(role, cls)` (and `checkRate(user.id, "check")`). It parses `listQS` with `parseListState(new URLSearchParams(listQS), INVENTORY_LIST_CONFIG)`, then finds people with `peopleWhere(q, "assignees", cls)` (`take` 10), and counts their assets with `groupBy assigneeId` over `buildAssetWhere(without assignee)` restricted to those ids.
- [ ] **Step 4: `PeopleFacet` (client)** replaces `FacetDropdown` for `assignee` in `inventory-toolbar.tsx`.
  - **Button:** "Assigned" or "Assigned: {n}".
  - **Popover:** a search input labelled "Search people", the selected people as removable chips (`aria-label="Remove {name}"`), an "Unassigned {count}" checkbox, and typed results as checkboxes "{name} · {employeeNo} {count}".
  - **Behaviour:** `PEOPLE_NONE` when empty. Apply and Clear behave like `FacetDropdown`'s (read `src/components/patterns/facet-dropdown.tsx` and mirror its apply / keyboard behaviour).
- [ ] **Step 5: Run.** Run `npx tsc --noEmit && npm run lint && npx vitest run`.
- [ ] **Step 6: Commit.**

```bash
git add -A src
git commit -m "feat(inventory): the Assigned filter searches people (10 results with counts), keeps the chosen ones as chips, and offers Unassigned; the page no longer loads every assignee"
```

---

### Task 7: The Schedule — categories first, drill-down paged

**Files:**
- Modify: `src/server/modules/finance/depreciation-queries.ts` (+ a pure helper in `src/lib/depreciation.ts` with a test), `src/app/(app)/finance/depreciation/page.tsx`, `src/components/finance/schedule-table.tsx`

**Interfaces — Produces:**

```ts
// src/lib/depreciation.ts
export function sumYearRows(rows: readonly YearRow[], year: number, asOf: MonthIndex): YearRow; // element-wise sum; projected = the year's flags
// depreciation-queries.ts
export async function scheduleSummary(cls: AssetClass, year: number, now?: Date): Promise<{ categories: Array<{ categoryId: string; category: string; assets: number; row: YearRow }>; total: YearRow | null; notStarted: number; noPolicy: number; asOf: MonthIndex; years: number[] }>;
export async function scheduleCategory(cls: AssetClass, year: number, categoryId: string, page: number, now?: Date): Promise<{ category: string; rows: ScheduleGroup["rows"]; subtotal: YearRow; total: number; page: number; pageCount: number } | null>;
```

- [ ] **Step 1: Failing test** for `sumYearRows`:

```ts
it("sumYearRows adds element-wise and keeps the year's projected flags", () => {
  const a = { opening: 100, months: Array(12).fill(1), projected: Array(12).fill(false), total: 12, closing: 88 };
  const b = { opening: 50, months: Array(12).fill(2), projected: Array(12).fill(false), total: 24, closing: 26 };
  const s = sumYearRows([a, b], 2026, 2026 * 12 + 8);
  expect([s.opening, s.total, s.closing, s.months[0]]).toEqual([150, 36, 114, 3]);
  expect(s.projected).toEqual([...Array(9).fill(false), true, true, true]);
});
```

  Implement it, and refactor `scheduleYear` to use it for subtotals and the total, so there is one summing rule.
- [ ] **Step 2: Queries.**
  - **`scheduleSummary`:** reuse the `depRows` + `yearGrid` pass from `scheduleYear`, but return per-category `{ assets: rowCount, row: sumYearRows(...) }` and no asset rows.
  - **`scheduleCategory`:** the same pass restricted to `categoryId`, sorted by tag, sliced to the page with `pageOf` / `ENTITY_PAGE_SIZE`, with the subtotal computed over **all** of the category's rows. It returns null if the category is not in `cls`.
- [ ] **Step 3: Page.**
  - **No `cat`:** the summary table `aria-label="Depreciation schedule {year}"`, with one row per category (its name a link to `?tab=schedule&year=&cls=&cat=<id>`, with an "{n} assets" muted note) and the **Total** row. The empty-year sentence and the not-depreciating line stay.
  - **With `cat`:** a heading "{category} — {year}", a "← All categories" link, the asset rows (as today), a `Subtotal — {category}` row, and `Pagination`.
  - **Export link:** unchanged (`scheduleYear`).
- [ ] **Step 4: Run.** Run `npx tsc --noEmit && npm run lint && npx vitest run`.
- [ ] **Step 5: Commit.**

```bash
git add -A src
git commit -m "feat(finance): the depreciation Schedule shows category totals first with a paged drill-down per category; one summing rule; export unchanged"
```

---

### Task 8: e2e, adapted pins, battery and docs

**Files:**
- Create: `e2e/own-tags-types.spec.ts`
- Modify: every e2e spec pinning "ThinkPad", "Dell Latitude" (as a type), "New model — which type?", suggested tags, the tag chip or the prefix field. Start with `grep -rln "ThinkPad\|which type\|Tag prefix\|BR-[A-Z][A-Z]-0" e2e`, and add the failures recorded in the Task 3 report. Also `docs/HANDOVER.md`, `docs/PICKUP.md`, `docs/HANDOVER-PENDING.md`, the spec's Status and this plan's D-block.

- [ ] **Step 1: `e2e/own-tags-types.spec.ts`** (house shape: `login`, `waitForHydration`, `expectNoSeriousAxe` from `e2e/queues-records-ux.spec.ts:62-85`; `beforeAll` seeds; `afterAll` disconnects; unique tags per run like `OWN-${Date.now().toString(36).toUpperCase()}-1`). Cases:
  1. **One unit.** it@ on Register (IT): Laptop category, type a new model "Asus Vivobook 15 (e2e)". The "Type" select shows, is empty, and the status line asks for "the type". Pick "High-performance", type the tag in **lower case** (`own-…-1`), enter a serial, Register.
     - The record's tag is upper-case; its type is High-performance.
     - The label preview (Labels tab / queue) shows the tag.
     - `/inventory/scan/<TAG>` opens the scan card.
  2. **Known model.** Picking "Dell Latitude 5420" leaves Type empty and required (the model never sets it).
  3. **Batch of 3 with pasted tags** (dispatch a paste event of three lines into "Tag 1"): rows 1–3 filled, note "Pasted 3 tags".
     - A duplicate within the batch shows the in-batch message.
     - Typing the seeded `BR-LT-0148` shows "already registered" with a link (Review Focus 3).
     - An empty tag refuses with "Enter a tag for every unit".
     - Register a clean batch and check that 3 assets exist with those tags.
  4. **Bad shape.** The tag "A B" refuses with TAG_RULE.
  5. **Data fix.**
     - In DB, the Laptop types are exactly Standard, High-performance, MacBook, and BR-LT-0201's type is MacBook.
     - The Finance standard policy's "laptop" slot type is Standard: check on the Admin equipment policy page or in the DB.
  6. **Axe** on Register with the Type select and a tag box visible.
  7. **People picker.**
     - On a SPARE laptop's record, Assign: before typing, Recent shows (after one earlier assign).
     - Typing "EMP-00" lists at most 10.
     - Typing part of a seeded name finds it, and assigning works.
     - The inventory page HTML does not contain a seeded active employee's name that holds nothing (spec §4.2).
  8. **Assigned filter.**
     - Search a seeded holder, tick, Apply: rows narrow and the button reads "Assigned: 1".
     - Unassigned narrows to assets with no holder.
     - The chip's × removes it.
  9. **Schedule.**
     - Set a Laptop policy (fixture).
     - `/finance/depreciation` shows a "Laptop" category row and Total, and no asset tag cells.
     - Clicking "Laptop" shows its asset rows with `Subtotal — Laptop`.
     - "← All categories" returns.
     - The export still has asset rows.
  10. **Axe** on the Assigned popover open and on the Schedule summary.
- [ ] **Step 2: Adapt pins (P-6).** Run each changed file alone in the foreground.
- [ ] **Step 3: The battery.**
  - Run the seven chunks from `docs/HANDOVER.md` §0 item 9, with the new file in the chunk that holds `register-labels.spec.ts`. Split slow chunks.
  - `npx playwright test --list | tail -1`, `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npx prisma migrate status` (29).
  - `npm run db:seed` runs last.
- [ ] **Step 4: Docs.**
  - **`HANDOVER.md`:** a status prefix on line 3 and a new lettered block "(ac)": Phase 36, migration 29 data-only, staging deploys by pulling the CI image, and on deploy staging's Laptop types are renamed and BR-LT-0201 moved.
  - **`PICKUP.md`:** branch row, battery row, database row (29), §4 item 1.
  - **`HANDOVER-PENDING.md`:** if the tag-suggestion or type items are listed there, mark them done.
  - **The spec:** Status → code-complete.
  - **This plan:** fill the D-block.
  - **State everywhere:** code-complete, unmerged and unpushed.
- [ ] **Step 5: Commit.**

```bash
git add e2e docs/HANDOVER.md docs/PICKUP.md docs/HANDOVER-PENDING.md docs/superpowers/specs/2026-10-16-own-tags-and-real-types-design.md docs/superpowers/plans/2026-10-16-phase-36-own-tags-and-real-types.md
git commit -m "test(e2e)+docs: Phase 36 -- typed tags, Type always asked, Laptop types data fix, people search (pickers + Assigned filter), Schedule by category; adapted pins; battery; migration 29"
```

---

## D-block (decisions made during execution)

- **D-1** (Task 1) - tags capped at 20 characters (spec said 30) — the label's barcode fits ~22 characters at the minimum module, so 30 would print labels with no scannable barcode; spec/plan updated in the fix round — cost if wrong: one number (tags 21–30 refused)
- **D-2** (Task 5) - accept the swap of four extra pages (scan, work, home, reservations) that also loaded every employee — same intent as spec §4.2; activeEmployeeOptions deleted — cost if wrong: none
- **D-3** (Task 5) - searchPeople uses checkRate(user.id, "check") (the live-check budget), not the mutation budget the plan implied — typing must not starve real writes — cost if wrong: one argument
- **D-4** (Task 6) - the Reservations page's Employee facet stays a list — it shows only people with holds in the current tab (holds expire in 7 days, so the list stays short) — cost if wrong: a third search scope later
- **D-5** (Task 6) - include the failed-search message fix (Minor 2) in fix round 1 since the same file is being touched and a rate-limited search saying 'No match' misleads — cost if wrong: one string
- **D-6** (Task 7) - the plan's scheduleSummary interface omitted Cost; spec §5 requires it — add costC per category and a total cost — cost if wrong: one column
- **D-7** (Task 7) - include the O(n²) grouping fix and a 'Category not found' note in the fix round (same files, cheap) — cost if wrong: none
- **D-8** (Task 8) - Register's label preview shows the tag upper-cased and trimmed (`register-form.tsx`, one line) - the stored tag is upper-case, so a lower-case preview barcoded something that would never be saved - cost if wrong: none
- **D-9** (Task 8) - e2e specs that registered through a suggested tag now type their own (`E<base36>-n` style, 20 characters at most); `ThinkPad` picks became `High-performance` through the select named `Type` - the model no longer sets the type - cost if wrong: one string per spec
- **D-10** (Task 8) - the import fixtures use type `Standard` (`e2e/fixtures/make.ts`; only the four .xlsx files that carry a Laptop type were regenerated, the rest restored byte-for-byte) - `Dell Latitude` no longer exists after migration 29 - cost if wrong: re-run `npx tsx e2e/fixtures/make.ts`
- **D-11** (Task 8) - `quick-forms` case 2 now expects the employee picker to list only Recent before typing (no `All` heading) - spec 4.2 - cost if wrong: one assertion
- **D-12** (Task 8) - the idle-employee check in `own-tags-types` case 7 creates its own active employee, because every seeded active employee holds an asset or a reservation and so legitimately appears on the page - cost if wrong: one fixture row
- **D-13** (final review, ruling) - `searchAssignees` also allows `viewer`: /inventory is the viewer's landing page and viewers already see /employees; it keeps its `canSeeClass` check - cost if wrong: one role string
- **D-14** (final review, ruling) - `searchPeople` is pickers only: roles admin, it_staff, purchasing_staff (finance_staff dropped), `scope: "active"` only, no `cls`; the assignees branch lives only in `peopleWhere` for `searchAssignees` - spec 4.1 and this plan updated - cost if wrong: one guard line
- **D-15** (final review) - Register and add another focuses `#register-tag`; in one-unit mode the empty or bad tag is said under the Tag box (`aria-describedby`) as "Enter a tag for every unit" or "{tag}: {TAG_RULE}", with no "Row 1 ·" - cost if wrong: one focus target
- **D-16** (final review) - the Assign dialog preselects a hold's person only if ACTIVE (`heldFor.active`); a leaver reads "Held for {name}, who has left — pick someone else." - cost if wrong: one prop
- **D-17** (final review) - the Register label preview shows `YOUR-TAG` while the Tag box is empty (never a real asset's tag); the Schedule drill-down subtotal row shows the category's Cost - cost if wrong: one string, one cell
- **D-18** (final review) - added `own-tags-types` case 11 (a viewer's Assigned search); no drill-down page-2 e2e because the seed has at most 12 depreciating assets in a category (page size 25) - cost if wrong: one case
- **D-13** (final review, ruling) - `searchAssignees` also allows `viewer`: /inventory is the viewer's landing page and viewers already see /employees; it keeps its `canSeeClass` check - cost if wrong: one role string
- **D-14** (final review, ruling) - `searchPeople` is pickers only: roles admin, it_staff, purchasing_staff (finance_staff dropped), `scope: "active"` only, no `cls`; the `assignees` scope lives only in `peopleWhere` for `searchAssignees` - spec 4.1 and this plan updated - cost if wrong: one guard line
- **D-15** (final review) - Register and add another focuses `#register-tag`; in one-unit mode the empty or bad tag is said under the Tag box (`aria-describedby`) as "Enter a tag for every unit" or "{tag}: {TAG_RULE}", with no "Row 1 ·" - cost if wrong: one focus target
- **D-16** (final review) - the Assign dialog preselects a hold's person only if ACTIVE (`heldFor.active`); a leaver reads "Held for {name}, who has left — pick someone else." - cost if wrong: one prop
- **D-17** (final review) - the Register label preview shows `YOUR-TAG` while the Tag box is empty (never a real asset's tag); the Schedule drill-down subtotal row shows the category's Cost - cost if wrong: one string, one cell
- **D-18** (final review) - added `own-tags-types` case 11 (a viewer's Assigned search); no drill-down page-2 e2e because the seed has at most 12 depreciating assets in a category (page size 25) - cost if wrong: one case
