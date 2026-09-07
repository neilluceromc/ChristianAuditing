# Pick up here — new device, new session

**Written 2026-09-07** at `main` = `origin/main`, Phases 1–13 merged and pushed. This is the short front
door. The long reference is [`HANDOVER.md`](HANDOVER.md) (≈2,500 lines; read its §0 once you are running).
Everything below that is a *decision* rather than a fact about the code lived only in one machine's
assistant memory until now — that is why this file exists.

---

## 1. Where the code stands

| | |
|---|---|
| Repository | `github.com/neilluceromc/ChristianAuditing` — **public**, by choice. Never commit `.env` or any real secret; scan before every push. |
| Branch | `main`, level with `origin/main`. Phase branches (`phase-10-polish` … `phase-13-asset-classes`) exist only on the old dev laptop and are fully contained in `main`; nothing on them is needed. |
| Stack | Next.js 15 App Router · Prisma 6 · PostgreSQL 16 (Docker) · Auth.js v5 · Tailwind v4 · Playwright · vitest. Node ≥ 22, npm ≥ 11 (dev machine ran Node 24). |
| Database | 14 migrations, additive only. `prisma migrate reset` is **not** used in this project. |
| Battery, last run 2026-09-07 | `tsc` clean · `lint` clean · **908 unit / 51 files** · `npm run build` · `docker compose --profile prod build` · **187 e2e / 14 files** in five foreground parts (52 · 47 · 59 · 23 · 6). Commands and history: `HANDOVER.md` §0 item 9. |
| Last two phases | **Phase 12** — register already-purchased assets (`/inventory/register`, auto-numbered tags) with Finance confirm / send-back / mark-corrected; `main` also carries the deploy-hardening branch (uploads backup, env-driven seed password). **Phase 13** — asset classes: one register, two classes (`IT`, `PURCHASING`), each with its own status vocabulary, class-gated write paths and pages, `?cls=` views, Finance tabs, Home pinned to IT, import refuses Purchasing rows by name. Spec `superpowers/specs/2026-09-06-asset-classes-design.md`, plan `superpowers/plans/2026-09-06-phase-13-asset-classes.md` (19 amendments, `D-1`…`D-19`, each a lesson). |

## 2. Dev environment on the new device

Nothing that matters travels except the repository: `.env`, `node_modules`, `.next`, the Docker database
volume, `uploads/` and `backups/` are all local to the old machine, and all are regenerated.

```bash
git clone https://github.com/neilluceromc/ChristianAuditing.git
cd ChristianAuditing
cp .env.example .env         # then fill it — see below
docker compose up -d db
npm ci                       # from the committed lockfile; the only npm *install* that is safe on Windows
npx prisma generate          # required; the postinstall hook is not reliable
npx prisma migrate deploy    # applies the 14 migrations
npm run db:seed              # 25 IT + 7 Purchasing assets, 5 accounts — see below
npm run dev                  # http://localhost:3000
```

**Filling `.env` for development** (the comments in `.env.example` are the source of truth):

- `POSTGRES_PASSWORD` — any long random string **without `/ + =`** (it is spliced unescaped into a URL). Also paste it into the `DATABASE_URL` line.
- `AUTH_SECRET`, `SECRET_ENCRYPTION_KEY` — random 24 and 32 bytes, base64. New values are fine: the old dev database does not come along, so there is nothing encrypted under the old key.
- `SEED_PASSWORD` — **leave unset for local development.** Set, it makes every Playwright login fail (the reason is in `.env.example`). Seeded accounts then use the documented default `admin123`.
- `APP_BASE_URL` — the dev machine had `http://192.168.202.141:3000`. This is only read when printing labels; for development leave the placeholder or use your own LAN address. **See §4 before this value goes anywhere near a printer.**

Seeded accounts, all `@thebackroomop.com`: `admin@` (sysadmin, both asset classes) · `it@` · `purchasing@` · `finance@` · `viewer@`.

Then prove the machine works before changing anything:

```bash
npx tsc --noEmit && npm run lint && npm run test      # expect 908 / 51
npx playwright install                                # once
npx playwright test e2e/auth-shell.spec.ts --workers=1   # ~1 min, 16 tests — the cheapest e2e smoke
```

The full e2e battery does not fit one command; the five-part split is in `HANDOVER.md` §0 item 9. Run
parts in the **foreground** with `--global-timeout`, never backgrounded, and read the count line — a run
that hits the timeout prints "N did not run" and still looks like a pass.

**Windows-specific, learned the hard way:** never run `npm run build` while `npm run dev` is running (they
share `.next`); never install a package with plain `npm install` on Windows — it drops the Linux optional
dependencies from the lockfile and breaks the Alpine production image (`HANDOVER.md` §7 has the recovery);
Docker Desktop must be started by hand from the desktop session.

## 3. Decisions that are not written in the code

These were made with the user and would be invisible to anyone reading only the repository.

- **"Admin" in the stakeholder notes means the Purchasing department.** In the codebase `admin` is the
  sysadmin role; Purchasing is the `purchasing` workspace and the `purchasing_staff` role. `HANDOVER.md` §9
  carries the warning.
- **Finance confirmation is a label, not a gate.** An unconfirmed asset is fully live. Do not "fix" this into
  a hold.
- **Each class is registered, created, edited and requested by its own department; everything else is
  shared.** Assign/return through `/employees`, offboarding, approvals and Finance review are deliberately
  not class-gated. Approvers stay `admin`/`it_staff` for both classes — the first follow-up (§5).
- **Deployment is a prototype on the office LAN.** The Cloudflare Tunnel idea was withdrawn; the label URL
  is a reserved LAN address or a UniFi DNS name. Staging runs on a dedicated laptop and is updated by pushing
  `main` from dev and running `scripts/deploy-staging.ps1` on the laptop. Comparison of hosting options that
  led here: `superpowers/specs/2026-09-03-staging-hosting-comparison.md`.
- **Merging and pushing are separate, explicit decisions by the user.** Neither happens unprompted. Only
  `main` is ever pushed; phase branches stay local.
- **Working method:** brainstorm → spec → plan → subagent-driven execution, a fresh implementer per task
  with a spec-compliance review and then a code-quality review that asks *"is the rule right?"*, not *"does
  the diff match?"* Every plan amendment is committed as `docs(plan): …` so the plan never lies. Use the
  cheapest model that can do each job: mechanical work to a small model, implementers and spec review to a
  mid model, judgment reviews to the strongest. Long mechanical runs (the battery) belong in the controller's
  own foreground calls — a subagent dies with the session.
- **Review the rule, not the diff.** Across Phases 7–13 almost every real defect was in the *plan* and was
  transcribed faithfully by the implementer; the reviews are where correctness comes from. The 119 rules
  distilled from this are `HANDOVER.md` §6a.

## 4. What is next, in order

1. **Deploy the prototype to the staging laptop and let Purchasing and Finance use it.** Chosen by the user
   on 2026-09-07 as the next step before any more features. The ordered checklist is
   [`staging-run-sheet.md`](staging-run-sheet.md) (also delivered as a PDF). It hinges on one decision only
   the user can make — **which machine owns the reserved address `192.168.202.141`**, or whether to use a
   DNS name instead — because that value is printed onto every label. Physical steps nobody else can do:
   the UniFi DHCP reservation, the phone reachability test, the printed sheet (tape-measure the 100 mm bar,
   scan one QR).
2. **Two visual checks never done by a human:** the inventory class-switch chips and Finance's IT/Purchasing
   tabs by eye, and the Register form signed in as `purchasing@`. Both are asserted by e2e and axe, never
   looked at.
3. **Phase 13 follow-ups** (`HANDOVER.md` §8, Phase 13 block), in value order:
   - **Purchasing-owned approvals** — today IT staff approve lifecycle changes on cars and desks. Smallest,
     most visible gap. Brainstorm first; it is permissions plus a queue view.
   - **A Purchasing assign / return surface** — a car is assigned only at create time; only an admin can
     return it, because `/employees` is IT's workspace.
   - **Class-aware document permissions** — Purchasing cannot attach a car's papers; IT can.
   - Smaller: an unassigned-holder detector for Purchasing (IT's Home has one), a label-sheet path for
     Purchasing assets, the year-chip "0 active filters" empty state, one markup for the two class switches.
4. **The §9 subsystems from the Admin meeting** — vendor master data, purchasing extensions, consumables.
   Consumables is a second domain, not an extension of assets; it needs its own brainstorm and must not be
   modelled as an `Asset`.

## 5. Known gaps to keep in view

- **No HTTPS** on the LAN; on-site only; one machine, no failover. Acceptable for the prototype, written up in
  the run sheet.
- `SEED_PASSWORD` is the only credential on staging until the seeded accounts' passwords are changed.
- Two server-side gates are unreachable from the UI and covered by the database trigger and review only:
  a wrong-class register request and a mixed-class bulk request (`D-13`); likewise `updateAsset`'s
  cross-class guard (`D-15`).
- Home's leaver card pins IT holdings while the offboarding queue does not; no test drives a Purchasing
  approval through the real approve action (`D-19`).
- Backups land on the same disk as the data; copy them off periodically.

## 6. If you are an assistant reading this

Start with this file, then `HANDOVER.md` §0. Follow §3 above as standing instructions. Before proposing
work, check `HANDOVER.md` §8 and §9 for what is deferred and why. Do not merge or push without being asked,
do not seed a database people are using (the seed truncates every table), and when a plan and the code
disagree, the code wins and the plan gets amended.
