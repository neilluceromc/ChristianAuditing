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

/**
 * The parts of a keydown a single-key shortcut ("/", "[") reads: plain data, so the rules are testable without a
 * DOM. Only the target's tag is read, never an input's type: every input (a checkbox included) blocks the key.
 */
export interface SingleKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  /** upper-case tag name of the event target, e.g. "INPUT" */
  targetTag: string | null;
  targetEditable: boolean;
  /** a dialog, drawer, palette, menu, listbox or filter popup is open anywhere on the page */
  overlayOpen: boolean;
  /** the event target sits inside a dialog, menu or listbox */
  targetInOverlay: boolean;
}

/**
 * The one rule every single-key shortcut shares: `key` itself, not already handled, no modifier held (so Ctrl /
 * and browser shortcuts keep working), no overlay open or holding the focus, and never while typing in a field
 * (any input, textarea, select or contenteditable target).
 */
export function singleKeyShortcut(e: SingleKey, key: string): boolean {
  if (e.key !== key || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.overlayOpen || e.targetInOverlay) return false;
  if (e.targetEditable) return false;
  return e.targetTag !== "INPUT" && e.targetTag !== "TEXTAREA" && e.targetTag !== "SELECT";
}

/** A browser keydown as a SingleKey (reads the page for open overlays). */
export function readSingleKey(e: KeyboardEvent): SingleKey {
  const target = e.target instanceof HTMLElement ? e.target : null;
  return {
    key: e.key,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    defaultPrevented: e.defaultPrevented,
    targetTag: target?.tagName ?? null,
    targetEditable: target?.isContentEditable ?? false,
    overlayOpen: document.querySelector(SHORTCUT_OVERLAY) !== null,
    targetInOverlay: target?.closest(SHORTCUT_OVERLAY) != null,
  };
}

/**
 * Spec §2.3: "/" focuses the page's search box, under the single-key rule. It stands aside while any overlay is
 * open because the command palette is not portalled, so the page behind it stays live, and "/" must never pull
 * focus out of a dialog, a menu or a filter popup.
 */
export function slashFocusesSearch(e: SingleKey): boolean {
  return singleKeyShortcut(e, "/");
}

/**
 * Phase 46 spec §4.1: "[" collapses or expands the desktop sidebar, under the same single-key rule (a menu's
 * type-ahead or a dialog keeps the key).
 */
export function bracketTogglesSidebar(e: SingleKey): boolean {
  return singleKeyShortcut(e, "[");
}

/**
 * Every overlay a single-key shortcut ("/", "[") stands aside for. Each is rendered only while open: modal dialogs,
 * drawers and the command palette (`aria-modal`), the non-modal filter popups (FacetDropdown, the people facet and
 * the column chooser are `role="dialog"`), Menu popups (`role="menu"`) and combobox lists (`role="listbox"`).
 */
export const SHORTCUT_OVERLAY = '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]';
