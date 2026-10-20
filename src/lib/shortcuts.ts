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

/** The parts of a keydown the Ctrl K / ⌘K shortcut reads. */
export interface PaletteKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  /** an `aria-modal` overlay other than the palette itself (a Dialog or Drawer) is open */
  otherModalOpen: boolean;
}

/**
 * Spec §2.3 / §4 with final review M1: Ctrl K / ⌘K opens the command palette — but not while a Dialog or Drawer
 * is open. Those portal above the palette, so it would open underneath, take the focus and be typed into unseen.
 */
export function paletteShortcutOpens(e: PaletteKey): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return false;
  return !e.otherModalOpen;
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
  /** a dialog, drawer, palette, menu, listbox or filter popup is open anywhere on the page */
  overlayOpen: boolean;
  /** the event target sits inside a dialog, menu or listbox */
  targetInOverlay: boolean;
}

/**
 * Spec §2.3: "/" focuses the page's search box, and does nothing while typing
 * in a field — any input, textarea, select or contenteditable target — or
 * with a modifier held (so Ctrl / and browser shortcuts keep working). It
 * also stands aside while any overlay is open — the command palette is not
 * portalled, so the page behind it stays live, and "/" must never pull focus
 * out of a dialog, a menu or a filter popup.
 */
export function slashFocusesSearch(e: SlashKey): boolean {
  if (e.key !== "/" || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.overlayOpen || e.targetInOverlay) return false;
  if (e.targetEditable) return false;
  return e.targetTag !== "INPUT" && e.targetTag !== "TEXTAREA" && e.targetTag !== "SELECT";
}

/**
 * Phase 46 spec §4.1: "[" collapses or expands the desktop sidebar. Like "/", it does nothing while typing in a
 * field (any input, textarea, select or contenteditable), with a modifier held, or while an overlay is open or
 * holds the focus (a menu's type-ahead or a dialog must keep the key).
 */
export function bracketTogglesSidebar(e: SlashKey): boolean {
  if (e.key !== "[" || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.overlayOpen || e.targetInOverlay) return false;
  if (e.targetEditable) return false;
  return e.targetTag !== "INPUT" && e.targetTag !== "TEXTAREA" && e.targetTag !== "SELECT";
}

/**
 * Every overlay a single-key shortcut ("/", "[") stands aside for. Each is rendered only while open: modal dialogs,
 * drawers and the command palette (`aria-modal`), the non-modal filter popups (FacetDropdown, the people facet and
 * the column chooser are `role="dialog"`), Menu popups (`role="menu"`) and combobox lists (`role="listbox"`).
 */
export const SHORTCUT_OVERLAY = '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]';
