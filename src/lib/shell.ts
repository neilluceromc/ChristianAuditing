import type { Role } from "@prisma/client";
import { filterSectionsForRole, type NavSection, type VisibleSection } from "./workspaces";

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
 * One "Go to" destination: a page, the label it lists under, and every other name the nav gives it (a view that
 * shares its link's href, like Setup's "Asset categories", or a collapsed link's single view).
 */
export interface NavDestination {
  label: string;
  href: string;
  also: string[];
}

/**
 * The command palette's "Go to" destinations (spec §4.6): every link and view a role can see, in nav order, one per
 * href. The first name for an href is its label (so /inventory lists as "Inventory"); later names for the same href
 * are kept in `also`, so every sub-page stays findable by its own name. Built from the nav definition, not the
 * visible sections, because a link collapsed to one view (a viewer's Setup) no longer carries that view's name.
 */
export function navDestinations(sections: NavSection[], role: Role): NavDestination[] {
  const visible = (x: { roles?: Role[] }) => !x.roles || x.roles.includes(role);
  const byLabel = new Map(sections.flatMap((s) => s.items).map((i) => [i.label, i]));
  const byHref = new Map<string, NavDestination>();
  const add = (label: string, href: string) => {
    const d = byHref.get(href);
    if (!d) byHref.set(href, { label, href, also: [] });
    else if (d.label !== label && !d.also.includes(label)) d.also.push(label);
  };
  for (const item of filterSectionsForRole(sections, role).flatMap((s) => s.items)) {
    add(item.label, item.href);
    for (const view of (byLabel.get(item.label)?.views ?? []).filter(visible)) add(view.label, view.href);
  }
  return [...byHref.values()];
}

/**
 * The destinations a palette query finds (case-insensitive substring), each shown under the name that matched: its
 * label when that matches, else the first matching other name ("categories" finds "Asset categories", not "Setup").
 * An empty query lists every destination under its label.
 */
export function matchDestinations(destinations: NavDestination[], query: string): Array<{ label: string; href: string }> {
  const q = query.trim().toLowerCase();
  return destinations.flatMap(({ label, href, also }) => {
    const name = !q ? label : [label, ...also].find((n) => n.toLowerCase().includes(q));
    return name ? [{ label: name, href }] : [];
  });
}

/** Spec §3: the workspace switcher reads "{n} workspaces" (singular for one), never the cookie name. */
export function workspaceCountLabel(n: number): string {
  return `${n} workspace${n === 1 ? "" : "s"}`;
}
