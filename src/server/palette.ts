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

export async function paletteSearch(query: string): Promise<PaletteResults> {
  const user = await requireUser();
  const q = query.trim();
  if (q.length < 2) return { assets: [], people: [], requests: [] };

  const [assets, people, requests] = await Promise.all([
    prisma.asset.findMany({
      where: { OR: [{ tag: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } }] },
      take: 5,
      orderBy: { tag: "asc" },
    }),
    prisma.employee.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { employeeNo: { contains: q, mode: "insensitive" } }] },
      take: 5,
      orderBy: { name: "asc" },
    }),
    prisma.purchaseRequest.findMany({
      where: { refNo: { contains: q, mode: "insensitive" } },
      take: 5,
      orderBy: { refNo: "desc" },
    }),
  ]);

  const gate = (href: string) => pathAllowedForRole(href, user.role);
  return {
    assets: assets
      .map((a) => ({ label: a.tag, sub: a.model, href: `/inventory/${a.id}` }))
      .filter((h) => gate(h.href)),
    people: people
      .map((e) => ({ label: e.name, sub: e.employeeNo, href: `/employees/${e.id}` }))
      .filter((h) => gate(h.href)),
    requests: requests
      .map((r) => ({ label: r.refNo, sub: r.state, href: `/purchases/${r.id}` }))
      .filter((h) => gate(h.href)),
  };
}
