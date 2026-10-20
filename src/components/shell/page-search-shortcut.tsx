"use client";

import { useEffect } from "react";
import { readSingleKey, slashFocusesSearch } from "@/lib/shortcuts";

/**
 * The page's search box: only a field explicitly marked `data-page-search`
 * (the shared SearchBox and the list toolbars). Panel searches (spares,
 * notes, a thread) are never targeted. Hidden, disabled and inert fields are
 * skipped.
 */
function pageSearchBox(): HTMLInputElement | null {
  const main = document.getElementById("main");
  if (!main) return null;
  return (
    Array.from(main.querySelectorAll<HTMLInputElement>("input[data-page-search]")).find(
      (el) => !el.disabled && el.getClientRects().length > 0 && !el.closest("[inert]"),
    ) ?? null
  );
}

/** Spec §2.3: "/" focuses the page's search box. It does nothing while typing in a field. */
export function PageSearchShortcut() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return; // cheap exit before any DOM query
      if (!slashFocusesSearch(readSingleKey(e))) return;
      const box = pageSearchBox();
      if (!box) return; // no search on this page: leave the key alone
      e.preventDefault(); // the "/" itself must not land in the box
      box.focus();
      box.select();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
