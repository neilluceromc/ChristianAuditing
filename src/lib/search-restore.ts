/**
 * Task 6 review I2 (spec §7.2): the search box filters as you type, and in the production build a same-page query
 * navigation can stick, so the stuck-navigation fallback (`stuck-nav.ts`) may load the page the ordinary way. If the
 * page's search box had focus then, `rememberPageSearch` notes its text and caret in sessionStorage just before the
 * load, and the reloaded `SearchBox` takes the note once on mount (`takePageSearch`) and puts focus, text and caret
 * back. The note is cleared when read, is only for the same page, and goes stale after `SEARCH_RESTORE_TTL_MS`.
 */

export const SEARCH_RESTORE_KEY = "cris:page-search-restore";
/** A reload that takes longer than this to come back is not the one the note was written for. */
export const SEARCH_RESTORE_TTL_MS = 15_000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface FieldLike {
  value: string;
  selectionStart: number | null;
  hasAttribute(name: string): boolean;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // blocked site data
  }
}
function browserActive(): FieldLike | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement as unknown as Partial<FieldLike> | null;
  return el && typeof el.value === "string" && typeof el.hasAttribute === "function" ? (el as FieldLike) : null;
}
const browserPath = () => (typeof window === "undefined" ? "" : window.location.pathname);

/** Note the page search box's text and caret, when it has focus. True when a note was written. */
export function rememberPageSearch(env: {
  storage?: StorageLike | null; active?: FieldLike | null; path?: string; now?: number;
} = {}): boolean {
  const storage = env.storage === undefined ? browserStorage() : env.storage;
  const active = env.active === undefined ? browserActive() : env.active;
  if (!storage || !active || !active.hasAttribute("data-page-search")) return false;
  const note = {
    path: env.path ?? browserPath(),
    text: active.value,
    caret: active.selectionStart ?? active.value.length,
    at: env.now ?? Date.now(),
  };
  try {
    storage.setItem(SEARCH_RESTORE_KEY, JSON.stringify(note));
    return true;
  } catch {
    return false;
  }
}

/** Take (and clear) the note for this page: the text and caret to put back, or null. */
export function takePageSearch(env: { storage?: StorageLike | null; path?: string; now?: number } = {}): {
  text: string; caret: number;
} | null {
  const storage = env.storage === undefined ? browserStorage() : env.storage;
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(SEARCH_RESTORE_KEY);
    if (raw !== null) storage.removeItem(SEARCH_RESTORE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const n = JSON.parse(raw) as { path?: unknown; text?: unknown; caret?: unknown; at?: unknown };
    const now = env.now ?? Date.now();
    if (typeof n.text !== "string" || typeof n.caret !== "number" || typeof n.at !== "number") return null;
    if (n.path !== (env.path ?? browserPath()) || now - n.at > SEARCH_RESTORE_TTL_MS || now < n.at) return null;
    return { text: n.text, caret: Math.max(0, Math.min(n.caret, n.text.length)) };
  } catch {
    return null;
  }
}
