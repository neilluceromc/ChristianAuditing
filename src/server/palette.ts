"use server";

import { z } from "zod";
import { prisma } from "./db/client";
import { actionUser } from "./auth/guards";
import { pathAllowedForRole } from "@/lib/workspaces";
import { visibleClassWhere } from "@/lib/asset-class";
import {
  PALETTE_LIMIT,
  assetHint,
  assetSearchWhere,
  exactTagFirst,
  holdsHint,
  searchRateDecision,
} from "@/lib/palette";

export interface PaletteHit {
  label: string;
  sub: string;
  href: string;
  /** Phase 40 (spec §4): why it matched or what they hold — "serial …", "held by {name}", "holds {tag}". */
  hint?: string;
}

export interface PaletteResults {
  assets: PaletteHit[];
  people: PaletteHit[];
  requests: PaletteHit[];
  suppliers: PaletteHit[];
  stock: PaletteHit[];
  /** Set when this search was refused by the rate window; every group is then empty. */
  rateLimited?: { retryAfterSec: number };
}

const EMPTY: PaletteResults = { assets: [], people: [], requests: [], suppliers: [], stock: [] };

// Rule and numbers in src/lib/palette.ts (searchRateDecision). Process-local:
// a DB RateEvent per keystroke would be write amplification on a read path.
const recentByUser = new Map<string, number[]>();

function searchRate(userId: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const decision = searchRateDecision(recentByUser.get(userId) ?? [], Date.now());
  recentByUser.set(userId, decision.recent);
  return decision.allowed ? { allowed: true } : { allowed: false, retryAfterSec: decision.retryAfterSec };
}

const ASSET_SELECT = {
  id: true, tag: true, model: true, serial: true, assignee: { select: { name: true } },
} as const;

const querySchema = z.string().max(100);

export async function paletteSearch(query: unknown): Promise<PaletteResults> {
  const user = await actionUser();
  if (!user) return EMPTY;
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return EMPTY;
  const q = parsed.data.trim();
  if (q.length < 2) return EMPTY;
  const rate = searchRate(user.id);
  if (!rate.allowed) return { ...EMPTY, rateLimited: { retryAfterSec: rate.retryAfterSec } };

  // Query-level gating: don't even run the query for groups whose target
  // routes this role can't reach (entry criterion #5).
  const canAssets = pathAllowedForRole("/inventory/x", user.role);
  const canPeople = pathAllowedForRole("/employees/x", user.role);
  const canRequests = pathAllowedForRole("/purchases/x", user.role);
  const canSuppliers = pathAllowedForRole("/purchases/suppliers", user.role);
  const canStock = pathAllowedForRole("/stock", user.role);
  // The asset class this role may see bounds every asset row AND every tag a person's hint names.
  const visibleAssets = visibleClassWhere(user.role);

  const [assets, exact, people, requests, suppliers, stock] = await Promise.all([
    canAssets
      ? prisma.asset.findMany({
          where: { AND: [assetSearchWhere(q), visibleAssets] },
          select: ASSET_SELECT,
          take: PALETTE_LIMIT,
          orderBy: { tag: "asc" },
        })
      : [],
    // Spec §4: the exact tag leads, even when the bounded contains query above stopped short of it.
    canAssets
      ? prisma.asset.findFirst({
          where: { AND: [{ tag: { equals: q, mode: "insensitive" } }, visibleAssets] },
          select: ASSET_SELECT,
          orderBy: { tag: "asc" },
        })
      : null,
    canPeople
      ? prisma.employee.findMany({
          where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { employeeNo: { contains: q, mode: "insensitive" } }] },
          select: { id: true, name: true, employeeNo: true },
          take: PALETTE_LIMIT,
          orderBy: { name: "asc" },
        })
      : [],
    canRequests
      ? prisma.purchaseRequest.findMany({
          where: { refNo: { contains: q, mode: "insensitive" } },
          take: PALETTE_LIMIT,
          orderBy: { refNo: "desc" },
        })
      : [],
    canSuppliers
      ? prisma.vendor.findMany({
          where: {
            archivedAt: null,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { registeredName: { contains: q, mode: "insensitive" } },
            ],
          },
          take: PALETTE_LIMIT,
          orderBy: { name: "asc" },
        })
      : [],
    canStock
      ? prisma.stockItem.findMany({
          where: {
            archivedAt: null,
            OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }],
          },
          take: PALETTE_LIMIT,
          orderBy: { code: "asc" },
        })
      : [],
  ]);

  // Spec §4: a person's hint is the first tag they hold — one grouped query for
  // all of them (at most PALETTE_LIMIT rows), never one per person, and only
  // over assets this role may see.
  const firstTag = new Map<string, string>();
  if (canAssets && people.length > 0) {
    const held = await prisma.asset.groupBy({
      by: ["assigneeId"],
      where: { AND: [{ assigneeId: { in: people.map((p) => p.id) } }, visibleAssets] },
      _min: { tag: true },
    });
    for (const h of held) if (h.assigneeId && h._min.tag) firstTag.set(h.assigneeId, h._min.tag);
  }

  return {
    assets: exactTagFirst(exact, assets).map((a) => {
      const hint = assetHint({ ...a, holderName: a.assignee?.name ?? null }, q);
      return { label: a.tag, sub: a.model, href: `/inventory/${a.id}`, ...(hint ? { hint } : {}) };
    }),
    people: people.map((e) => {
      const tag = firstTag.get(e.id);
      return { label: e.name, sub: e.employeeNo, href: `/employees/${e.id}`, ...(tag ? { hint: holdsHint(tag) } : {}) };
    }),
    requests: requests.map((r) => ({ label: r.refNo, sub: r.state, href: `/purchases/${r.id}` })),
    suppliers: suppliers.map((v) => ({
      label: v.name, sub: v.category ?? v.contactPerson ?? "supplier", href: `/purchases/suppliers/${v.id}`,
    })),
    stock: stock.map((s) => ({ label: s.code, sub: s.name, href: `/stock/items/${s.id}` })),
  };
}
