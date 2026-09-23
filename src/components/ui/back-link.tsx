"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { leaveFor, popForBack, readStack, writeStack } from "@/lib/nav-stack";

/**
 * Phase 28: one Back control for every page with a parent. Where the operator came from when this tab
 * has a previous in-app page (router.back() restores the list with its filters, search and page);
 * otherwise the breadcrumb's parent — a deep link, a fresh tab, a scanned QR.
 */
export function BackLink({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  function go() {
    const { stack, canGoBack } = popForBack(readStack(window.sessionStorage));
    if (canGoBack) {
      writeStack(window.sessionStorage, stack);
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }
  return (
    <button
      type="button"
      onClick={go}
      className="inline-flex items-center gap-1 rounded-(--radius-ctl) text-xs text-fg-muted hover:text-accent"
    >
      <span aria-hidden>←</span>
      Back
    </button>
  );
}

/**
 * Phase 30 (review R9): leave this page for `target` the way Back would — step back when the previous
 * in-app page is the target, else replace — so a form's Save or Cancel never leaves itself under the
 * page it returns to, and that page's own Back still goes where it went before (`leaveFor`).
 */
export function useLeaveTo(): (target: string) => void {
  const router = useRouter();
  return useCallback(
    (target: string) => {
      const { stack, back } = leaveFor(readStack(window.sessionStorage), target);
      writeStack(window.sessionStorage, stack);
      if (back) router.back();
      else router.replace(target);
    },
    [router],
  );
}
