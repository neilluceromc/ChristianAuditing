import type { Role } from "@prisma/client";
import type { VisibleSection } from "./workspaces";

const pathOf = (href: string) => href.split("?")[0];
const matches = (path: string, pathname: string) =>
  path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/");

/**
 * The phone top bar's page name (spec §3, Phase 42 §4.6): the link or view whose path is the longest prefix of
 * the current path, so a record (/inventory/abc/history) reads as its link ("Inventory"). Hrefs' query strings are
 * ignored. Home ("/") matches only the root itself. On a tie between a link and one of its own views, the view's
 * label wins only when it is that link's sole view on the path (Setup's "Asset categories"); a list page shared by
 * several filter views (/inventory: All, Spare, …) reads as the link. Null when nothing fits — the caller shows
 * the workspace name instead.
 */
export function navLabelFor(pathname: string, sections: VisibleSection[]): string | null {
  const candidates = sections.flatMap((s) => s.items).flatMap((item) => [
    { label: item.label, path: pathOf(item.href), rank: 0 },
    ...item.views.map((view) => {
      const path = pathOf(view.href);
      const alone = item.views.filter((v) => pathOf(v.href) === path).length === 1;
      return { label: view.label, path, rank: alone ? 1 : -1 };
    }),
  ]);
  let best: { label: string; path: string; rank: number } | null = null;
  for (const c of candidates) {
    if (!matches(c.path, pathname)) continue;
    if (!best || c.path.length > best.path.length || (c.path.length === best.path.length && c.rank > best.rank)) {
      best = c;
    }
  }
  return best?.label ?? null;
}

/**
 * The command palette's "Go to" destinations (spec §4.6): every link and view, in nav order, role-filtered (views
 * carry `roles`) and de-duplicated by href, the first label winning (so /inventory reads "Inventory", not "All").
 */
export function navDestinations(sections: VisibleSection[], role: Role): Array<{ label: string; href: string }> {
  const seen = new Set<string>();
  const out: Array<{ label: string; href: string }> = [];
  for (const item of sections.flatMap((s) => s.items)) {
    const views = item.views.filter((v) => !v.roles || v.roles.includes(role));
    for (const { label, href } of [item, ...views]) {
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({ label, href });
    }
  }
  return out;
}

/** Spec §3: the workspace switcher reads "{n} workspaces" (singular for one), never the cookie name. */
export function workspaceCountLabel(n: number): string {
  return `${n} workspace${n === 1 ? "" : "s"}`;
}
