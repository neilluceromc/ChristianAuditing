# Purchase Orders, the three-team intake and the notification bell (design)

**Date:** 2026-10-21

**Status:** the owner's answers in chat. Calls I made are marked **(my call)**.

**Numbering:** the phase number is assigned when this is scheduled. Client staff stays Phase 48.

## 1. Intent

A wrong SI number or price today bounces between teams. The owner's last example took **three** round trips. Three things cause it:

- **Finance can't fix anything.** It can only tick what's wrong and send the asset back.
- **IT can't hand a money problem back to Purchasing.** It can only edit it itself.
- **Nobody is told when something comes back.** A returned asset shows only as a red banner when someone happens to open Inventory.

This design does four things:

1. Each team either **fixes what it can itself, giving a reason**, or **sends it back to the team that owns the field**.
2. It replaces Purchase Requests with **Purchase Orders**, which record what was already bought.
3. Finance reviews **a whole PO in one go**.
4. It adds a **notification bell plus a "Sent back" tab**, so nothing waits unseen.

**Success:** a wrong number is fixed in at most one hand-off, usually none. Every fix says who changed what and why.

**Anti-goals:**
- A fix that leaves no trace.
- Finance changing IT's details (serials, models).
- A bell so noisy people stop reading it.

## 2. Who owns which fields

| Owner | Fields |
|---|---|
| **Purchasing (money)** | supplier, SI / sales invoice no. (`invoiceRef`), official receipt no. (`receiptRef`), purchase date, unit price / cost, fees, item description, quantity |
| **IT (the device)** | serial number, brand, model, category, specs, warranty (until, covered by, who to call) **(my call: warranty sits with IT, who handles repairs)** |
| **Finance** | approval, "not capitalised", depreciation settings (unchanged) |
| **Documents** (sales invoice, OR, warranty slip, delivery receipt, other) | **Purchasing, IT and Finance can all upload or re-upload** |

**Non-IT items (my call):** on a PURCHASING-class asset, serial, brand, model, category and warranty belong to **Purchasing**, which registers those items. Finance sends problems with them back to Purchasing and can't edit them itself.

**Editing rules:**
- **Purchasing editing its own fields while the item is with Purchasing:** no reason needed. That covers before IT has checked, while a PO is sent back, and in way 2 until it's registered. **(My call)** When Purchasing corrects a sent-back PO, its reply note is the reason.
- **Once assets are registered and with Finance (my call):** Purchasing and IT stop editing money fields directly. Finance fixes them (with a reason) or sends them back.
- **Fixing a field another team owns:** needs a **reason of 5–300 characters**. This applies to IT fixing Purchasing's money fields, and to Finance fixing money fields.
- **Finance never edits IT-owned fields.** It sends those back to IT.

## 3. Purchase Orders replace Purchase Requests

**There is no Purchase Request any more.** The pre-purchase approval flow goes: IT review / reject, Finance request-info / complete, and the draft state.

**A PO records something already bought:**
- **one supplier**, an **SI number**, an optional OR number, the **purchase date**, and an optional department it's for;
- **lines**, each with a description, specs, quantity and unit price, plus fees;
- its documents and its notes thread (the existing append-only thread carries over).

**Each line is IT gear or not (my call).** Each line takes its class from the category chosen for it (IT or PURCHASING), as assets do today. A PO may mix IT and non-IT lines: IT lines follow §4 way 1 and the others follow way 2. The PO is "fully registered" when every line is.

**Existing data:**
- **Every existing purchase request becomes a PO.** Keep the number and change the prefix: PR-0188 becomes **PO-0188** **(my call)**. Units become lines; notes, documents and linked assets carry over.
- **State mapping (my call):**

  | Old state | New state |
  |---|---|
  | DRAFT | *Sent back to Purchasing* (editable, never sent) |
  | SUBMITTED | *With IT* |
  | IT_REVIEWED | *With IT* |
  | COMPLETED | *Registered*, or *Approved* if all its linked assets are approved |
  | CANCELLED | stays *Cancelled* |

- Old requests have no SI number. The PO shows it as missing, and Finance can't approve until it's there.
- **Legacy lines (my call):**
  - Old units have no category, so their IT or non-IT class is chosen at Register time, from the category picked for each asset.
  - We can't tell which old units were already registered (the unit link was never set). So **Register stays available on any legacy PO that isn't cancelled**, and the PO shows "N assets linked" so people can see what's been done.

**Wording:**
- "Purchase request(s)" becomes **"Purchase order(s)"** everywhere: breadcrumbs, sidebar, copy, exports and Cris answers.
- The Purchasing sidebar's **"Register purchase"** (which today opens a request draft) becomes **"New purchase order"**.
- **Webhooks (my call):** `purchase_request.completed` becomes `purchase_order.approved`. The old name is still sent alongside it until the next phase, so no receiver breaks.

## 4. The three ways an asset gets in

### Way 1: IT gear with a PO
1. **Purchasing saves the PO.** There are no drafts: saving sends it. It lands in IT's queue (state *With IT*), and **IT's bell rings**.
2. **IT checks the money details** against the documents:
   - **Fix it:** edit with a reason.
   - **Send back to Purchasing:** tick the wrong fields and add a note (as today's Finance checklist). The PO goes to *Sent back to Purchasing*, and the **Purchasing team's bell rings**.
   - When Purchasing corrects it and saves, it goes back to IT with a reply note (as today's resubmit), and **IT's bell rings**.
3. **IT presses Register on the PO.** The register form is pre-filled from the PO lines: tags, class and money details per unit. IT adds the **serial and IT details per unit**. Saving creates the assets, linked to the PO and its line. The PO's IT lines become *Registered*, they go to Finance (*With Finance*), and the **Finance team's bell rings**.

### Way 2: Non-IT items with a PO
1. Purchasing saves the PO, then **presses Register on it themselves**. This is the same pre-filled form with no IT step and the serial optional.
2. The assets go **straight to Finance**, and the **Finance team's bell rings**.

### Way 3: IT registers directly, with no PO
- IT presses **Register**, which is today's `/inventory/register` page, and enters everything: money and IT details.
- The registration batch (today's `PurchaseRecord`, one per Register submit) goes to Finance as **one group**, and the **Finance team's bell rings**.
- **Purchasing registers only from a PO (my call).** The direct Register page becomes IT/admin only for IT gear. Admin keeps everything.

**Assets already in flight at cut-over (my call):** they keep their current state. In Finance's queue they appear grouped by their existing `PurchaseRecord`, or as a single-asset group when they have none.

### Partial deliveries (owner, 2026-10-21)
- **IT (or Purchasing, in way 2) can register part of a line now and the rest when it arrives.** For example, 3 of 5 laptops today and 2 next week.
- **Counts:** each line shows "3 of 5 registered". The PO is *Partly registered* until every line's quantity is registered, then *Registered*.
- **Each Register submit is its own group** for Finance, and rings Finance's bell once. So one PO can reach Finance as several groups.
- **Later groups (my call):** they copy the PO's money values. If an earlier group was already approved, those values are locked (§5), so the later units arrive with the same SI number, supplier and date.
- **Cancelling the rest (my call):** if the rest never arrives, Purchasing can **close the line short** with a reason, for example "supplier cancelled 2 units". The PO then counts as fully registered.

## 5. Finance reviews a group in one go

**What a group is:** Finance's **To review** queue lists **groups**, either a PO's registered lines (ways 1 and 2) or a direct registration batch (way 3). This replaces one row per asset. The Finance → Assets list from Phase 47 stays for browsing.

**What the review page shows:**
- the PO's money details;
- its documents, with preview;
- every asset in the group (tag, serial, model, cost);
- the computed totals.

**On the review page Finance can:**
- **Approve all.** This approves every asset in the group in one action. Today's per-asset effect, audit and depreciation start apply to each asset.
  - **"Not capitalised"** is chosen per group, with a per-asset override **(my call)**.
- **Fix money details** (with a reason). A PO-level fix, such as the SI number, supplier, date or a line's unit price, flows to every asset from it.
- **Flag or comment on a single asset**, for example "serial on BR-LT-0207 doesn't match the photo". Flagged assets are held back from "Approve all".
  - **(My call)** The rest can still be approved. The flagged ones are sent back to the right team.
- **Send back:**
  - **money problems** go to **Purchasing**, on the PO;
  - **IT problems** (serial, model, etc.) go to **IT**, per asset or for the group.

  Finance picks the team, and the fields ticked decide it.

**Undo and reopen:**
- Undo for 15 minutes (the Phase 47 follow-up) covers **Approve all** and the new send-backs as one action each. The same person, nothing changed since.
- Admin **Reopen review** stays per asset, and is also available for a whole group **(my call)**.

**Where money values live (my call):** on the PO. They are copied onto each asset at Register, and every later PO-level fix is copied again. A PO's money fields **lock as soon as any of its assets is approved**. From then on, only a Finance fix with a reason changes them. That fix flows to every asset from the PO, approved ones included, without reopening them; the audit records it on each asset. So a PO's assets always share one SI number, supplier and date.

**Way 3 send-backs (my call):** a group with no PO goes back to **the team that registered it**. That is IT for way 3. Legacy batches registered by Purchasing go to Purchasing, appear in its Sent back tab, and ring its bell.

**After approval the money details lock:**
- Purchasing and IT can no longer change cost, SI number, OR number, supplier, purchase date or fees.
- A later correction is a **Finance fix with a reason**, or an **admin reopen**.
- Today's "a cost added to an approved no-cost asset reopens it" path stays for not-capitalised assets **(my call)**. That is Finance's own approval still being honest.

## 6. Every fix leaves a trace

A fix to another team's field writes an audit entry recording:
- the **field, the old value, the new value**;
- the **reason**;
- the person, their team and `source: "web"`.

Where it shows:
- the asset's **Financial history** and Activity, which read "<name> (Finance) changed the SI number from 0012 to 0021: 'typo on receipt'";
- the PO's notes thread, which records PO-level fixes and send-backs;
- **Purchasing is notified when another team changes its numbers** (§7).

## 7. Notifications: the bell, the Sent back tab and the Home card

**The owner's choice is both.** The bell tells you the moment something comes to you; the tab is where you work through it.

**Who gets it:**
- **The whole team** the item lands with: Purchasing staff, IT staff or Finance staff, by role.
- **Read and unread is per person (my call).** Opening an item marks it read for you only.
- **Admins (my call):** no rings by default, so they aren't flooded. They can open the full notifications page for any team.

**What rings:**

| Event | Who gets it |
|---|---|
| **Sent back to you** | IT → Purchasing; Finance → Purchasing; Finance → IT |
| **New to check** | a PO saved (→ IT for IT lines); a group registered (→ Finance); a corrected PO resubmitted (→ whoever sent it back) |
| **Changed by another team** | IT or Finance fixed Purchasing's money fields (→ Purchasing) |

- **A batch is one notification (my call).** For example: "PO-0214 · 5 laptops from Purchasing to check", not five.

**The bell:**
- In the top bar on every page, desktop and mobile, with an unread count.
- The panel has tabs: **Sent back · To check · Changed · All**.
- Each item shows the asset or PO, who did it, their reason or note, and the time. It links to the record.
- **"See all"** opens a full notifications page.
- Items older than 90 days are pruned by the maintenance worker **(my call)**.

**The Sent back tab:**
- Purchasing's PO list, IT's Inventory and the IT PO queue each get a **Sent back** tab.
- The sidebar shows a **red count** for it.
- An item **leaves the tab once someone on the team fixes it and sends it on** **(my call)**. Reading the notification doesn't remove it.

**The Home card:** each team's Home shows "**N sent back to you**" and "**N to check**", linking to the tabs.

**Accessibility:**
- The bell is a real button with "Notifications, 3 unread" as its label.
- New items are announced politely, once per arrival, not per poll.

## 8. Data (left to the builder within these limits)

**Migration:**
- One migration renames the request models and states to PO models and states.
- It adds the SI number and OR number to the PO, and adds notifications with per-person read state.
- It maps existing rows per §3.
- Table renames versus model `@@map` is the builder's choice. The data must survive intact, so take a Supabase dump before the push.

**Links:** `Asset.purchaseRequestId` and `purchaseUnitId` become the PO and PO-line links. Way-1 and way-2 registrations must set **both**; today the unit link is never set.

**Notifications** are written in the same transaction as the action that causes them, so they can't drift.

**No change to:** depreciation maths, the audit append-only rule, or the asset tag format.

## 9. Left to the builder

- Component and route names. For example, keep `/purchases` and show "Purchase orders".
- How the pre-filled register form lays out units: one row per unit, as today's register form does.
- Polling interval for the bell's count. Keep it cheap on Vercel Hobby and Supabase Free, for example on navigation plus a slow interval.
- Test shapes. They must cover:
  - **each send-back route** and the team that's notified;
  - **reason rules:** cross-team fixes need one, Purchasing's own edits before the IT check don't;
  - **Finance can't edit IT fields;**
  - **money fields lock after approval;**
  - **"Approve all" with a flagged asset held back;**
  - **the PR → PO migration mapping;**
  - **batch = one notification;**
  - **read state is per person;**
  - **the Sent back tab clears on fix, not on read.**

## 10. Not in this design

- Pre-purchase approval: there is no request step any more.
- Email or phone push. The bell is in-app only.
- Changing who can see which workspace.
