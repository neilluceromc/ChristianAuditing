"use client";

import { useRouter } from "next/navigation";
import { popForBack, readStack, writeStack } from "@/lib/nav-stack";

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
