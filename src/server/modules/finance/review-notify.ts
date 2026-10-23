import type { AssetClass, Prisma, Role } from "@prisma/client";
import { teamOfRole } from "@/lib/intake-rules";
import { notify } from "@/server/notifications/notify";
import type { ReturnTeam } from "./review-writes";

/*
 * 2026-10-23 (owner: "this is not showing in my notifications … whenever we sent or return back or successfully
 * changes correction"): the bell for Finance's steps that used to be silent — accepting a correction, and taking a
 * send-back or an approval of a correction back. All CHANGED, all through notify() inside the caller's transaction, so
 * a notification is written only when the action itself commits. A plain module: it takes a transaction client.
 */

/** More than this many assets to one team in one action collapse into one notification. */
export const COLLAPSE_ABOVE = 3;

type Actor = { id: string; role: Role };

const classTeam = (cls: AssetClass): ReturnTeam => (cls === "IT" ? "IT" : "PURCHASING");
const isReturnTeam = (t: unknown): t is ReturnTeam => t === "IT" || t === "PURCHASING";

/** The team a `finance.return` entry sent the asset to (`financeReturn.to.team` in its diff), when it says. */
function returnedTeam(diff: unknown): ReturnTeam | null {
  const to = (diff as { financeReturn?: { to?: { team?: unknown } } } | null)?.financeReturn?.to;
  return isReturnTeam(to?.team) ? to.team : null;
}

/**
 * Which of these assets were corrected — they come to Finance from a resubmit (by the team, or with the PO's
 * correction) rather than fresh — and the team that corrected each. Read from the audit trail, newest first: the
 * asset's latest send-back or resubmit decides (a send-back Finance undid is skipped, as the undo put the resubmit
 * back). The team is the resubmitting person's (teamOfRole); an admin has none, so it falls back to the team the
 * asset had been sent back to, then to its class's team. Assets that weren't corrected are absent from the map.
 */
export async function correctionTeams(
  tx: Prisma.TransactionClient,
  assets: ReadonlyArray<{ id: string; cls: AssetClass }>,
): Promise<Map<string, ReturnTeam>> {
  const out = new Map<string, ReturnTeam>();
  if (assets.length === 0) return out;
  const entries = await tx.auditEntry.findMany({
    where: {
      entityType: "asset", entityId: { in: assets.map((a) => a.id) },
      action: { in: ["finance.return", "finance.resubmit", "asset.return.undone"] },
    },
    select: { id: true, entityId: true, action: true, actorId: true, diff: true, createdAt: true },
  });
  // Newest first, whatever order the store hands them back in.
  entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));

  const found: Array<{ asset: { id: string; cls: AssetClass }; actorId: string | null; returnedTo: ReturnTeam | null }> = [];
  for (const asset of assets) {
    let skip = 0;
    let resubmit: { actorId: string | null } | null = null;
    let returnedTo: ReturnTeam | null = null;
    for (const e of entries) {
      if (e.entityId !== asset.id) continue;
      if (e.action === "asset.return.undone") { skip++; continue; }
      if (e.action === "finance.return") {
        if (skip > 0) { skip--; continue; }
        if (!resubmit) break; // its latest is a send-back: not corrected
        returnedTo = returnedTeam(e.diff);
        break;
      }
      if (!resubmit) resubmit = { actorId: e.actorId };
    }
    if (resubmit) found.push({ asset, actorId: resubmit.actorId, returnedTo });
  }
  if (found.length === 0) return out;

  const ids = [...new Set(found.map((f) => f.actorId).filter((x): x is string => !!x))];
  const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } }) : [];
  const roleOf = new Map(users.map((u) => [u.id, u.role]));
  for (const f of found) {
    const role = f.actorId ? roleOf.get(f.actorId) : undefined;
    const team = role ? teamOfRole(role) : null;
    out.set(f.asset.id, isReturnTeam(team) ? team : f.returnedTo ?? classTeam(f.asset.cls));
  }
  return out;
}

/**
 * One CHANGED notification per asset to its team — or, past COLLAPSE_ABOVE assets to one team, one for that team
 * (`many(n)`, on `/inventory`, about `group`). `one(tag)` names a single asset and links to it.
 */
export async function notifyAssetsByTeam(
  tx: Prisma.TransactionClient,
  items: ReadonlyArray<{ team: ReturnTeam; id: string; tag: string }>,
  words: { one: (tag: string) => string; many: (n: number) => string },
  actor: Actor,
  opts: { body?: string | null; group: { entityType: string; entityId: string } },
): Promise<void> {
  const byTeam = new Map<ReturnTeam, Array<{ id: string; tag: string }>>();
  for (const i of items) byTeam.set(i.team, [...(byTeam.get(i.team) ?? []), i]);
  for (const [team, list] of byTeam) {
    if (list.length > COLLAPSE_ABOVE) {
      await notify(tx, {
        team, kind: "CHANGED", title: words.many(list.length), body: opts.body ?? null, href: "/inventory",
        actorId: actor.id, actorRole: actor.role, entityType: opts.group.entityType, entityId: opts.group.entityId,
      });
      continue;
    }
    for (const a of list) {
      await notify(tx, {
        team, kind: "CHANGED", title: words.one(a.tag), body: opts.body ?? null, href: `/inventory/${a.id}`,
        actorId: actor.id, actorRole: actor.role, entityType: "asset", entityId: a.id,
      });
    }
  }
}

/** The words for each of Finance's steps (Global Constraints: verbatim). */
export const FINANCE_WORDS = {
  accepted: { one: (tag: string) => `${tag}: Finance accepted the correction`, many: (n: number) => `${n} corrections accepted by Finance` },
  reopened: { one: (tag: string) => `${tag}: Finance reopened its review`, many: (n: number) => `${n} reviews reopened by Finance` },
  tookBack: { one: (tag: string) => `${tag}: Finance took back the send-back`, many: (n: number) => `${n} send-backs taken back by Finance` },
  poApproved: (refNo: string) => `${refNo}: Finance approved all its assets`,
  poSendBackUndone: (refNo: string) => `${refNo}: the send-back was taken back`,
} as const;
