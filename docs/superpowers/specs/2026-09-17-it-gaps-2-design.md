# Phase 24 — IT gaps 2: Replace groups, repairs view in SQL, worker retention

**Status:** design approved in conversation 2026-09-17 (scope = the three open IT items; retention 90 days
for finished deliveries and jobs; approach A "reuse what exists"; three sections approved). Not yet planned.

**Why:** After Phase 23 the parked IT list had three items still open — the rest of the list recorded in
`docs/HANDOVER-PENDING.md` §6 had already been closed in Phase 20. (1) The Replace dialog ranks same-type
spares first and tags each row "Same type" / "Other spare", but shows one flat list, so when no same-type
spare exists the "other spares" list has no heading and reads as if every spare were a match. (2) The
repairs saved view (`/inventory?status=DEFECTIVE…`, `?stage=`) still loads every repair-candidate row
with its includes and pages the array in memory, although the stage cut itself has run in SQL since
Phase 20. (3) Nothing has ever deleted a `WebhookDelivery` or a finished `Job` row; both tables grow
without bound.

**What this phase does:** a `group` label on combobox options that the existing Recent/All heading code
renders; the repairs list paging the SQL id set through the normal count/skip/take snapshot; and an hourly
worker prune of finished deliveries and jobs older than 90 days with a one-off entry point and a note on
the deliveries page. No migration, no new table, no new route, no role change.

Predecessors: Phase 15 (Replace), Phase 17 (paging, `pagedSnapshot`), Phase 20 (`repairStageIds`,
`REPAIR_STAGE_CASE_SQL`, the it-gaps e2e), Phase 23 (`EntityCombobox` Recent/All headings).

---

## 0. Decisions made in the brainstorm

1. **Scope: the three open items only.** Not in this phase: `/audit` class scoping of approval, category
   and type rows; case-insensitive uniqueness for reference data; the activity page's action facet and
   import-update sentences. Each stays recorded in PICKUP §5 / HANDOVER §8.
2. **Retention: 90 days, every finished status.** Delivery rows `DELIVERED` or `DEAD` and job rows `DONE`
   or `DEAD` older than 90 days are removed; live rows (`PENDING`, `RETRYING`, `RUNNING`, `FAILED`) are
   never touched. Rejected: 30 days (too little history for a quarterly look), and "keep failed forever"
   (a DEAD row is evidence for a while, not for ever — and `DEAD` is already replayable from the page
   while it exists).
3. **Approach A — reuse what exists.** The combobox already renders heading rows; the stage cut already
   runs in SQL; the worker already has a loop with a periodic hook (`recoverStale` every ten idle cycles).
   Rejected: a raw-SQL list query with its own ORDER BY/LIMIT for the repairs view, and a partitioned
   deliveries table with a cron — more moving parts than a team-scale fleet needs.
4. **Headings replace the per-row note.** Once the list is grouped under "Same type" and "Other spares",
   the note text on every row says the same thing twice; it goes. The it-gaps e2e case that asserted the
   note asserts the headings instead.
5. **Facet counts stay on the candidate set.** `assetFacetOptions`' documented behaviour for the `stage`
   facet is unchanged; only the list's paging moves.
6. **Jobs prune with deliveries.** The same sweep, the same cutoff — one retention rule for the worker's
   two tables, not one policy for the visible table and none for the queue behind it.

---

## 1. Scope

**In**

- `ComboOption.group?: string`; `EntityCombobox` renders a heading whenever the group changes between
  consecutive rows (after the Recent block, if any); `spareOptions` emits groups "Same type" / "Other
  spares" and no `note`.
- `listAssets` in repair mode: `repairStageIds` → `pagedSnapshot` over `{ id: { in } }`.
- `src/lib/retention.ts` (constants, cutoff, due-check), `src/worker/retention.ts` (`pruneRetention`),
  `src/worker/prune.ts` (one pass), `npm run worker:prune`, the hourly hook in `src/worker/index.ts`, the
  deliveries page note.
- Tests: two unit files, one updated e2e case, three new e2e cases.

**Out** (recorded, not built): raw-SQL list ordering for repairs; stage facet counts on the exact cut;
a retention setting in the admin UI (the constant is the policy); pruning `AuditEntry` (the audit trail is
permanent by design); pruning `RateEvent` (`src/server/rate-limit.ts` already deletes its own old rows on
each check, so it needs no sweep).

---

## 2. Data model

No schema change and no migration. Retention deletes rows from `WebhookDelivery` and `Job`; both have
`createdAt`; `Job` also has `updatedAt` (the terminal instant). Indexes already present cover the
predicates: `WebhookDelivery @@index([status, createdAt])`, `Job @@index([status, runAt])` (the job prune
filters by `status` then `updatedAt`; at these row counts the status index is enough — no new index).

---

## 3. Access and routes

None new. `/admin/webhooks/deliveries` (admin) gains one sentence under its header. `npm run worker:prune`
is an operator command, not a route.

---

## 4. Pure rules (`src/lib`)

### 4.1 `combo-groups.ts` (+ test)

```ts
export interface GroupedOption { value: string; group?: string }
/**
 * The heading to render BEFORE row `i` of `shown`, or null. `recentCount` rows at the front are the
 * Recent block: heading "Recent" at i = 0 when recentCount > 0; at i = recentCount the heading is the
 * row's own group if it has one, else "All" (only when recentCount > 0). After that, a heading whenever
 * `group` differs from the previous row's group. Rows without a group after a grouped row get no heading.
 */
export function headingBefore(shown: readonly GroupedOption[], i: number, recentCount: number): string | null;
```

Tests: no recent, no groups → never a heading; recent only → "Recent" at 0 and "All" at `recentCount`;
groups only (`Same type` ×2, `Other spares` ×3) → headings at 0 and 2; groups with a query that leaves only
"Other spares" rows → one heading at 0; recent + groups → "Recent", then the first group's name at
`recentCount`, then the change.

### 4.2 `retention.ts` (+ test)

```ts
export const RETENTION_DAYS = 90;
export const PRUNE_BATCH = 1_000;
export const PRUNE_INTERVAL_MS = 60 * 60_000;
export function retentionCutoff(now: Date): Date;            // now − RETENTION_DAYS days (exact ms)
export function pruneDue(lastPruneAt: Date | null, now: Date): boolean; // null → true; else now − last ≥ interval
/** The page's sentence, from the constant, so the copy can never drift from the rule. */
export const RETENTION_NOTE = `Attempts older than ${RETENTION_DAYS} days are removed automatically.`;
```

Tests: cutoff arithmetic across a month end; `pruneDue(null)`, one minute short, exactly one hour.

---

## 5. Server and worker

### 5.1 `inventory/queries.ts`

- `spareOptions(preferTypeId)`: same query and ranking; map to
  `{ value, label: tag, sub: model, group: isSameType ? "Same type" : "Other spares" }` — no `note`.
- `listAssets`: the repair-mode branch becomes
  ```ts
  if (stages.length > 0) {
    const ids = (await repairStageIds(state, purchaseYear, cls)) ?? [];
    const idWhere: Prisma.AssetWhereInput = { id: { in: ids } };
    const { rows: assets, total, page, pageCount } = await pagedSnapshot(
      ENTITY_PAGE_SIZE, state.page,
      (tx) => tx.asset.count({ where: idWhere }),
      (tx, pg) => tx.asset.findMany({ where: idWhere, orderBy, skip: pg.skip, take: pg.take, include: LIST_INCLUDE }),
    );
    return { rows: assets.map(toRow), total, page, pageCount };
  }
  ```
  `repairStageIds` already intersects every other active filter and `purchaseYear`, so `buildAssetWhere`
  is not applied again. An empty id set pages to zero rows. The comment block above the branch is
  rewritten to say the cut is SQL (Phase 20) and the paging is SQL (this phase); the "must not change"
  note in HANDOVER §8 is retired by Task 10's docs.

### 5.2 `src/worker/retention.ts` (new, plain module, relative imports like every worker file)

```ts
import { prisma } from "../server/db/client";
import { PRUNE_BATCH, retentionCutoff } from "../lib/retention";

export interface PruneResult { deliveries: number; jobs: number }

/** One full pass: finished deliveries and jobs older than the cutoff, deleted in id batches. */
export async function pruneRetention(now: Date = new Date()): Promise<PruneResult> {
  const cutoff = retentionCutoff(now);
  const deliveries = await pruneTable(
    () => prisma.webhookDelivery.findMany({ where: { status: { in: ["DELIVERED", "DEAD"] }, createdAt: { lt: cutoff } }, select: { id: true }, take: PRUNE_BATCH }),
    (ids) => prisma.webhookDelivery.deleteMany({ where: { id: { in: ids } } }),
  );
  const jobs = await pruneTable(
    () => prisma.job.findMany({ where: { status: { in: ["DONE", "DEAD"] }, updatedAt: { lt: cutoff } }, select: { id: true }, take: PRUNE_BATCH }),
    (ids) => prisma.job.deleteMany({ where: { id: { in: ids } } }),
  );
  return { deliveries, jobs };
}

async function pruneTable(pick: () => Promise<{ id: string }[]>, drop: (ids: string[]) => Promise<{ count: number }>): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = (await pick()).map((r) => r.id);
    if (ids.length === 0) return total;
    total += (await drop(ids)).count;
    if (ids.length < PRUNE_BATCH) return total;
  }
}
```

A DEAD delivery cannot hold a live job (the worker dead-letters both in the same failure), so deleting it
strands nothing; a DELIVERED one's job is DONE. A job whose delivery row was pruned but which somehow ran
again is already handled: `deliverWebhook` throws `Permanent` for a missing row.

### 5.3 `src/worker/index.ts`

- After `await recoverStale();` at start: `await safePrune();`.
- In the loop, before `const worked = await tick();`: `if (pruneDue(lastPruneAt, new Date())) await safePrune();`
  where `let lastPruneAt: Date | null = null;` and
  ```ts
  async function safePrune(): Promise<void> {
    try {
      const r = await pruneRetention();
      if (r.deliveries || r.jobs) console.log(`[worker] pruned ${r.deliveries} deliver${r.deliveries === 1 ? "y" : "ies"}, ${r.jobs} job${r.jobs === 1 ? "" : "s"} older than ${RETENTION_DAYS} days`);
    } catch (err) {
      console.error(`[worker] prune failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      lastPruneAt = new Date();
    }
  }
  ```
  A prune failure never stops job processing; `--once` runs one prune at start like any start.

### 5.4 `src/worker/prune.ts` (new) and `package.json`

```ts
import { prisma } from "../server/db/client";
import { pruneRetention } from "./retention";
import { RETENTION_DAYS } from "../lib/retention";

pruneRetention()
  .then((r) => console.log(`[prune] removed ${r.deliveries} deliveries and ${r.jobs} jobs older than ${RETENTION_DAYS} days`))
  .catch((err) => { console.error(`[prune] failed: ${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```
`"worker:prune": "tsx src/worker/prune.ts"` beside `worker:once`. Not a `"use server"` module, not
importable by the app; the compose `worker` service picks the loop up unchanged (same image, same command).

### 5.5 Audit

No domain write changes. Pruned rows are operational records, not audited entities; the worker log line
is the record of each pass.

---

## 6. Screens

### 6.1 `EntityCombobox` (`src/components/patterns/entity-combobox.tsx`)

`ComboOption` gains `group?: string`. The two hard-coded heading branches (`Recent` at 0, `All` at
`recentShown.length`) are replaced by one: `const heading = headingBefore(shown, i, recentShown.length);
{heading && <li role="presentation" className=…>{heading}</li>}` — same class string, same
`role="presentation"`, so existing Recent/All behaviour and the Phase 23 e2e assertions are unchanged.
Keyboard navigation still indexes `shown`.

### 6.2 Replace dialog

No component change beyond consuming the new option shape: with `spareOptions` grouped, the list reads
"SAME TYPE" (heading), the same-type spares, "OTHER SPARES", the rest; with no same-type spare only the
"OTHER SPARES" heading and its rows. Typing filters rows and keeps whichever headings still have rows.

### 6.3 Deliveries page (`src/app/(app)/admin/webhooks/deliveries/page.tsx`)

Under the `PageHeader`, one muted line: `<p className="text-xs text-fg-muted">{RETENTION_NOTE}</p>`.

---

## 7. Error handling

| Situation | Response |
|---|---|
| Prune query fails (connection, lock) | logged `[worker] prune failed: …`; the loop continues; next attempt in an hour |
| Prune while a row is mid-retry | impossible by predicate: only `DELIVERED`/`DEAD` deliveries and `DONE`/`DEAD` jobs qualify |
| `repairStageIds` returns an empty set | `pagedSnapshot` over `id IN ()` → total 0, page 1 of 1, no rows; the empty state renders as today |
| Combobox option without `group` after grouped rows | no heading (the helper returns null) — mixed lists degrade gracefully |
| `worker:prune` run while the worker loop is also pruning | both delete by id lists; a row deleted by the other pass simply lowers this pass's count |

---

## 8. Testing

### 8.1 Unit (vitest)

- `combo-groups.test.ts`: §4.1's five cases.
- `retention.test.ts`: §4.2's cases.

### 8.2 E2E (foreground, `E2E_PORT=3100 --workers=1 --global-timeout=540000`)

In `e2e/it-gaps.spec.ts` (chunk F):
- Case 4 (updated): the Replace dialog for `BR-LT-0201` shows `role="presentation"` rows "Same type" and
  "Other spares" in that order, `BR-LT-0181` under the first and `BR-MN-0911` under the second; options no
  longer contain the words "Same type" / "Other spare".
- New: open a Replace dialog for an asset whose type has no other spare (pick from the seed, or make one
  by assigning the only other same-type spare through Prisma first and restoring after) → exactly one
  heading, "Other spares".
- New: `/inventory?stage=to-assess` (and the DEFECTIVE saved view) — the page's total equals the number of
  ids `REPAIR_STAGE_CASE_SQL` yields for that stage (computed through the e2e Prisma client with the same
  SQL string imported from `@/lib/repairs`), the table holds `min(total, ENTITY_PAGE_SIZE)` rows, and the
  rows are in `defectiveSince` order when that sort is set.
- New (retention): through the e2e Prisma client insert a `DELIVERED` delivery with `createdAt` 91 days
  ago and a `DONE` job with `updatedAt` 91 days ago, plus a fresh `DELIVERED` delivery and a fresh `DONE`
  job (all for the seeded active endpoint); `execSync("npm run worker:prune")`; the two old rows are gone,
  the two fresh rows remain, every seeded `PENDING`/`RETRYING`/`DEAD`-but-fresh row remains;
  `/admin/webhooks/deliveries` shows `RETENTION_NOTE` (imported from `@/lib/retention`); axe on that page.

### 8.3 Battery at the close

The seven chunks of Phase 23 unchanged in composition (it-gaps stays in F); counts move by the cases
above. `npx playwright test --list` governs the numbers.

---

## 9. Files

**New:** `src/lib/combo-groups.ts` (+ test), `src/lib/retention.ts` (+ test), `src/worker/retention.ts`,
`src/worker/prune.ts`.

**Modified:** `src/components/patterns/entity-combobox.tsx`, `src/server/modules/inventory/queries.ts`
(`spareOptions`, `listAssets`), `src/worker/index.ts`, `package.json` (script),
`src/app/(app)/admin/webhooks/deliveries/page.tsx`, `e2e/it-gaps.spec.ts`, `docs/HANDOVER.md`,
`docs/PICKUP.md`, `docs/HANDOVER-PENDING.md` (§6 list corrected: three items closed in Phase 20, three
shipped here).

---

## 10. Global constraints (copied into the plan)

- Dev only in a git worktree under `.claude/worktrees/` with its own `.env` (`DATABASE_URL` →
  `inventory_dev`, `APP_BASE_URL=http://192.168.203.153:3100`, no `SEED_PASSWORD`). Never the
  `inventory` database or port 3000. Never read or print `.env` (`grep -c "^NAME=" .env` only).
- Dev server for a walk: `npm run dev -- -p 3100`; ONE walker at a time; after stopping, `netstat -ano |
  findstr :3100` and `taskkill /PID <pid> /T`. Playwright: foreground, `E2E_PORT=3100 --workers=1
  --global-timeout=540000`, one process at a time, explicit file lists, port free before and after. Never
  seed while another agent walks or tests. Never run `npm run worker` against `inventory` from the worktree
  (its `.env` points at `inventory_dev`; keep it that way).
- Worker modules import relatively (no `@/`); `"use server"` modules export only async functions.
- Existing accessible names unchanged (the Replace combobox stays `Replacement`; heading rows stay
  `role="presentation"`); no new colour tokens.
- Tests first for pure modules; measured counts in commit messages; never amend; commit by explicit file
  list; `git add` new files first; never commit `.env`; scan the push range before any push.
- Reviewer subagents read-only: no `git stash`/`checkout`/`restore`/`reset`/`switch`; verify in the
  foreground; report written before the reply.
