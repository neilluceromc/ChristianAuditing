"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import type { NavBadges } from "@/lib/nav-badges";
import { currentNav } from "@/lib/nav-match";
import type { VisibleSection } from "@/lib/workspaces";
import { NavTree } from "./nav-tree";

interface NavListProps {
  sections: VisibleSection[];
  badges: NavBadges;
  /** the viewer's default asset class: `/inventory` drops `cls` from its URLs when it is this (spec §4.2) */
  defaultCls: AssetClass;
  /** the mobile drawer closes itself on navigation */
  onNavigate?: () => void;
}

/**
 * Phase 42 spec §4.1 / §4.2: the nav tree for the current URL. After mount, and whenever the current link or view
 * changes, the current entry is scrolled into the nav's visible part (`block: "nearest"`, no animation). The
 * sidebar's own scroll region is the nearest scroller; the sticky column keeps it on screen, so the window stays.
 */
export function NavList(props: NavListProps) {
  // useSearchParams needs a Suspense boundary wherever a page could prerender; until the params are known, the
  // tree reads the path alone.
  return (
    <Suspense fallback={<PathOnlyNav {...props} />}>
      <CurrentNav {...props} />
    </Suspense>
  );
}

function CurrentNav(props: NavListProps) {
  const search = useSearchParams();
  return <ScrolledNav {...props} search={search} />;
}

function PathOnlyNav(props: NavListProps) {
  return <ScrolledNav {...props} search={null} />;
}

function ScrolledNav({
  sections,
  badges,
  defaultCls,
  onNavigate,
  search,
}: NavListProps & { search: URLSearchParams | null }) {
  const pathname = usePathname();
  const current = currentNav(sections, pathname, new URLSearchParams(search?.toString()), defaultCls);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nav = ref.current?.querySelector('nav[aria-label="Workspace"]');
    // The current page's entry; on a page under an open link that no view matches (a record), the link itself.
    (nav?.querySelector('[aria-current="page"]') ?? nav?.querySelector("[data-nav-current]"))
      ?.scrollIntoView({ block: "nearest" });
  }, [current.item, current.view]);

  return (
    <div ref={ref} className="contents">
      <NavTree sections={sections} current={current} badges={badges} onNavigate={onNavigate} />
    </div>
  );
}
