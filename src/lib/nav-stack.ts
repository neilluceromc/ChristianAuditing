/**
 * Phase 28: this tab's in-app navigation history, kept in sessionStorage so the Back control can
 * tell "there is a previous page in this app" (→ router.back(), which restores the list exactly as
 * it was — filters, search, page) from "this is the first page" (→ the breadcrumb's parent). The
 * browser's own history is the source of truth for WHERE back goes; this stack only answers WHETHER.
 */
export const NAV_STACK_KEY = "br.nav-stack";
export const NAV_STACK_MAX = 50;

/** Append a path unless it is already on top (a re-render or a return via Back lands on the same path). */
export function pushPath(stack: readonly string[], path: string): string[] {
  if (stack[stack.length - 1] === path) return [...stack];
  return [...stack, path].slice(-NAV_STACK_MAX);
}

/** Drop the current page; Back is possible only when a previous in-app page remains. */
export function popForBack(stack: readonly string[]): { stack: string[]; canGoBack: boolean } {
  if (stack.length < 2) return { stack: [...stack], canGoBack: false };
  return { stack: stack.slice(0, -1), canGoBack: true };
}

/**
 * Phase 30 (review R9): leave the current page (a sub-page such as an Edit form) for `target`. When
 * the previous in-app page IS the target, step back to it (`back: true` → router.back()), so the
 * target's own Back still reaches whatever came before it; otherwise replace the current page with
 * the target (`back: false` → router.replace()), so the sub-page never sits under it in history.
 * Either way the current page leaves the stack.
 */
export function leaveFor(stack: readonly string[], target: string): { stack: string[]; back: boolean } {
  const { stack: rest, canGoBack } = popForBack(stack);
  if (canGoBack && rest[rest.length - 1] === target) return { stack: rest, back: true };
  return { stack: stack.slice(0, -1), back: false };
}

export function readStack(storage: Pick<Storage, "getItem">): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(NAV_STACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function writeStack(storage: Pick<Storage, "setItem">, stack: readonly string[]): void {
  try {
    storage.setItem(NAV_STACK_KEY, JSON.stringify(stack));
  } catch {
    // storage unavailable (private mode, quota) — Back degrades to the parent link, never throws
  }
}
