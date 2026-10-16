"use client";

import { useEffect } from "react";
import { slashFocusesSearch } from "@/lib/shortcuts";

/**
 * Every overlay that "/" must stand aside for. Each is rendered only while
 * open: modal dialogs, drawers and the command palette (`aria-modal`), the
 * non-modal filter popups (FacetDropdown, the people facet and the column
 * chooser are `role="dialog"`), Menu popups (`role="menu"`) and combobox
 * lists (`role="listbox"`).
 */
const OVERLAY = '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]';

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
      const target = e.target instanceof HTMLElement ? e.target : null;
      const handled = slashFocusesSearch({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        defaultPrevented: e.defaultPrevented,
        targetTag: target?.tagName ?? null,
        targetType: target instanceof HTMLInputElement ? target.type : null,
        targetEditable: target?.isContentEditable ?? false,
        overlayOpen: document.querySelector(OVERLAY) !== null,
        targetInOverlay: target?.closest(OVERLAY) != null,
      });
      if (!handled) return;
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
