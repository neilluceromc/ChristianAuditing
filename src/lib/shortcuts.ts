/** Apple platforms (macOS, iPadOS, iOS) — read from navigator platform or user-agent text. */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Spec §2.3 / §4: the search shortcut reads "⌘K" on Mac and "Ctrl K" everywhere else. */
export function searchShortcutLabel(platform: string): "⌘K" | "Ctrl K" {
  return isMacPlatform(platform) ? "⌘K" : "Ctrl K";
}

/** The browser's platform string, best source first; "" on the server. */
export function currentPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
}

/** The parts of a keydown the "/" shortcut reads — plain data, so the rule is testable without a DOM. */
export interface SlashKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  /** upper-case tag name of the event target, e.g. "INPUT" */
  targetTag: string | null;
  targetType: string | null;
  targetEditable: boolean;
}

/**
 * Spec §2.3: "/" focuses the page's search box, and does nothing while typing
 * in a field — any input, textarea, select or contenteditable target — or
 * with a modifier held (so Ctrl / and browser shortcuts keep working).
 */
export function slashFocusesSearch(e: SlashKey): boolean {
  if (e.key !== "/" || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.targetEditable) return false;
  return e.targetTag !== "INPUT" && e.targetTag !== "TEXTAREA" && e.targetTag !== "SELECT";
}
