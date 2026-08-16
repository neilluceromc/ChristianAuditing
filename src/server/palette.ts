"use server";

import { prisma } from "./db/client";
import { requireUser } from "./auth/guards";
import { pathAllowedForRole } from "@/lib/workspaces";

export interface PaletteHit {
  label: string;
  sub: string;
  href: string;
}

export interface PaletteResults {
  assets: PaletteHit[];
  people: PaletteHit[];
  requests: PaletteHit[];
}

const EMPTY: PaletteResults = { assets: [], people: [], requests: [] };

// In-memory sliding window: 30 searches / 10 s per user. A DB RateEvent per
// keystroke would be write amplification on a read path; process-local is
// fine on a single-machine deploy.
const WINDOW_MS = 10_000;
const MAX_IN_WINDOW = 30;
const recentByUser = new Map<string, number[]>();

function searchAllowed(userId: string): boolean {
  const now = Date.now();
  const recent = (recentByUser.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_IN_WINDOW) {
    recentByUser.set(userId, recent);
    return false;
  }
  recent.push(now);
  recentByUser.set(userId, recent);
  return true;
}

export async function paletteSearch(query: string): Promise<PaletteResults> {
  const user = await requireUser();
  const q = query.trim();
  if (q.length < 2 || !searchAllowed(user.id)) return EMPTY;

  // Query-level gating: don't even run the query for groups whose target
  // routes this role can't reach (entry criterion #5).
  const canAssets = pathAllowedForRole("/inventory/x", user.role);
  const canPeople = pathAllowedForRole("/employees/x", user.role);
  const canRequests = pathAllowedForRole("/purchases/x", user.role);

  const [assets, people, requests] = await Promise.all([
    canAssets
      ? prisma.asset.findMany({
          where: { OR: [{ tag: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } }] },
          take: 5,
          orderBy: { tag: "asc" },
        })
      : [],
    canPeople
      ? prisma.employee.findMany({
          where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { employeeNo: { contains: q, mode: "insensitive" } }] },
          take: 5,
          orderBy: { name: "asc" },
        })
      : [],
    canRequests
      ? prisma.purchaseRequest.findMany({
          where: { refNo: { contains: q, mode: "insensitive" } },
          take: 5,
          orderBy: { refNo: "desc" },
        })
      : [],
  ]);

  return {
    assets: assets.map((a) => ({ label: a.tag, sub: a.model, href: `/inventory/${a.id}` })),
    people: people.map((e) => ({ label: e.name, sub: e.employeeNo, href: `/employees/${e.id}` })),
    requests: requests.map((r) => ({ label: r.refNo, sub: r.state, href: `/purchases/${r.id}` })),
  };
}
