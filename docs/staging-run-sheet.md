# Inventory v2 — Staging Laptop Run Sheet

**Date prepared:** 2026-09-07 · **Code:** `main` at `d47134c` (Phase 13 merged and pushed) · **Repo:** `github.com/neilluceromc/ChristianAuditing` (public)

This sheet sequences two documents you already have — *Deployment Laptop Setup* (the how) and *Network Setup Runbook* (the UniFi side) — into one pass, and adds what changed since they were written. Tick each box in order; every step has a check that proves it before you move on. Budget: about two hours, most of it waiting for Docker.

---

## 0. One decision before you touch anything

The dev laptop's `.env` currently has `APP_BASE_URL=http://192.168.202.141:3000`. **That address must belong to the STAGING laptop**, permanently, because it is baked into every printed label.

☐ Decide: is `192.168.202.141` the address you will reserve for the staging laptop? If yes, the staging laptop gets that reservation and the dev laptop should not keep it. If no, pick the staging laptop's address now and use it everywhere below instead.

☐ Optional but better: give it a name in UniFi's DNS (for example `inventory.lan`) and use `http://inventory.lan:3000` as the label URL. A name can be repointed later; an address cannot. The runbook, Part 3, shows how.

---

## 1. Dev laptop — nothing to build (5 min)

☐ `git status` is clean and `git rev-list --count origin/main..main` prints `0`. It did tonight; this is only a re-check.

☐ Do **not** copy the dev `.env` to the laptop. Staging needs its own secrets and one variable dev must never set (`SEED_PASSWORD`). You will create the laptop's `.env` fresh in step 3.

---

## 2. UniFi — reserve the address (10 min, runbook Part 3)

☐ Find the staging laptop's client entry (plug it into Ethernet first if you can — the runbook explains why Wi-Fi is the weaker choice).

☐ Set a **fixed IP** to the address you chose in step 0.

☐ Reconnect the laptop, then on it: `ipconfig` shows that address.

☐ If the office phones are on a separate SSID or VLAN, check the runbook's note on client isolation now, not at step 5.

---

## 3. Staging laptop — install and configure (45 min, setup PDF Parts 1–3)

☐ Install **Git** and **Docker Desktop** (WSL 2 backend). Node is not needed; everything runs in containers.

☐ Power: lid close **Do nothing**, sleep and hibernate **Never**, on mains. (Setup PDF Part 2 — a sleeping laptop is a total outage.)

☐ Windows Firewall: allow inbound TCP 3000 on the Private profile. In an elevated PowerShell:

```powershell
netsh advfirewall firewall add rule name="Inventory v2 (3000)" dir=in action=allow protocol=TCP localport=3000 profile=private
```

☐ Make sure the office network is classed **Private**, not Public, or the rule above does nothing.

☐ Clone the repository (it is public; no token needed):

```powershell
git clone https://github.com/neilluceromc/ChristianAuditing.git
cd ChristianAuditing
git branch --show-current     # must print: main
```

☐ Create `.env` from the template and fill it. Generate values in PowerShell 5.1 with:

```powershell
Copy-Item .env.example .env
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$b = New-Object byte[] 24; $rng.GetBytes($b); [Convert]::ToBase64String($b)   # POSTGRES_PASSWORD
$b = New-Object byte[] 32; $rng.GetBytes($b); [Convert]::ToBase64String($b)   # AUTH_SECRET
$b = New-Object byte[] 32; $rng.GetBytes($b); [Convert]::ToBase64String($b)   # SECRET_ENCRYPTION_KEY (must be 32 bytes)
```

Then edit `.env`:

| Variable | Set it to |
|---|---|
| `POSTGRES_PASSWORD` | the first value above; also paste it into the `DATABASE_URL` line in place of `CHANGE-ME` |
| `AUTH_SECRET` | the second value |
| `SECRET_ENCRYPTION_KEY` | the third value |
| `SEED_PASSWORD` | a password you choose — **uncomment the line**; the seed refuses to run in production without it |
| `APP_BASE_URL` | **leave the placeholder for now.** Set it in step 6, after a phone has reached the app |

☐ Never commit `.env`. It is gitignored; `git status` must not list it.

---

## 4. Staging laptop — first deploy and seed (20 min, setup PDF Part 4)

☐ Build, start, inspect:

```powershell
docker compose --profile prod build
docker compose --profile prod up -d
docker compose --profile prod ps
```

Expect five containers: `db`, `migrate`, `web`, `worker`, `backup`. **`migrate` exits 0 — that is success.** It now applies **14 migrations** (the setup PDF says 11; Phase 13 added three).

☐ Seed once, and only once:

```powershell
docker compose --profile prod exec web node_modules/.bin/tsx prisma/seed.ts
```

If it refuses naming `SEED_PASSWORD`, step 3 missed it. The seed now includes four Purchasing categories (Vehicle, Furniture, Pantry Equipment, Building) and seven Purchasing assets alongside the IT fleet.

☐ On the laptop, `http://localhost:3000` shows the login page. Sign in as `admin@thebackroomop.com` with the `SEED_PASSWORD` you chose.

---

## 5. Verify one layer at a time (15 min, setup PDF Part 5)

Do these **in order**; each failure names its own layer.

| ☐ | From | Passing proves | If it fails |
|---|---|---|---|
| ☐ | The laptop, `http://localhost:3000` | stack healthy | `docker compose --profile prod ps` and `logs web` — not the network |
| ☐ | Another PC, `http://<address>:3000` | firewall and wired path open | Windows Firewall (step 3) or the network profile — not the app |
| ☐ | A phone browser, same URL | ready for labels | wireless only: client isolation, guest SSID, VLAN (runbook Part 3) |

☐ While signed in as admin, open **Inventory → Purchasing** (the class switch above the search box) and confirm the car `BR-VH-0001` is listed. Sign in as `purchasing@thebackroomop.com` and confirm **Register assets** offers Vehicle but not Laptop. That is Phase 13 working end to end.

---

## 6. Set the label URL, restart, print (20 min, setup PDF Part 6)

☐ Only after the phone test passed: in `.env`, set `APP_BASE_URL=http://<the address or name from step 0>:3000`. Then:

```powershell
docker compose --profile prod up -d --force-recreate web
```

☐ Print one label sheet at **Scale 100 %, A4, Margins: None**.

☐ **Tape-measure the 100 mm calibration bar.** 100 mm means every label is true size. Short means the printer is scaling.

☐ **Scan one QR with a phone.** It should open `/inventory/scan/<TAG>` on the staging laptop. This has never been done on paper.

---

## 7. Before real people use it (15 min)

☐ Change the seeded passwords for every account someone will actually use (Admin → Users). Until then, `SEED_PASSWORD` is the only thing between the network and the data.

☐ Copy the first backup off the laptop. Backups land in `.\backups` daily (a dump plus an uploads archive, newest 14 kept) — on the same disk as the data they protect.

---

## Ongoing — how a change reaches staging

On the dev laptop, when a phase is merged: `git push origin main` (already the rule; nothing else changes).

On the staging laptop, whenever you want it picked up:

```powershell
.\scripts\deploy-staging.ps1            # pull, rebuild, restart, poll until the app answers
.\scripts\deploy-staging.ps1 -CheckOnly # see what is waiting; touches nothing
```

It refuses if the laptop's tree is dirty or the branch has no upstream, and it **never seeds** — a redeploy keeps staging's data. To automate, schedule the plain command on a timer; an unchanged `main` exits early and costs nothing.

**Known limits (unchanged):** no HTTPS on the LAN hop; on-site only; one machine, no failover. The USB handheld scanner path does not depend on the network.
