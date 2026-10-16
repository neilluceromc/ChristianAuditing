"use client";

import { useEffect } from "react";
import { slashFocusesSearch } from "@/lib/shortcuts";

/**
 * The page's search box: a field marked `data-page-search` (the shared
 * SearchBox and the list toolbars), else the first search input in <main>.
 * Hidden, disabled and inert fields are skipped — while a modal is open the
 * page behind it is inert, so "/" never reaches past the dialog.
 */
function pageSearchBox(): HTMLInputElement | null {
  const main = document.getElementById("main");
  if (!main) return null;
  const candidates = [
    ...main.querySelectorAll<HTMLInputElement>("input[data-page-search]"),
    ...main.querySelectorAll<HTMLInputElement>('input[type="search"]'),
  ];
  return candidates.find((el) => !el.disabled && el.getClientRects().length > 0 && !el.closest("[inert]")) ?? null;
}

/** Spec §2.3: "/" focuses the page's search box. It does nothing while typing in a field. */
export function PageSearchShortcut() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
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
