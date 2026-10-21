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

type RememberEnv = Parameters<typeof rememberPageSearch>[0];
type Listen = (type: "pagehide" | "beforeunload", fn: () => void) => void;

/**
 * Final review I2: the old page keeps taking keystrokes until the reload commits (one server render of the list).
 * While this is set — from the fallback's note until this document unloads, at most `SEARCH_RESTORE_TTL_MS` — the
 * note follows the box: every keystroke rewrites it (`followPageSearch`), and so do pagehide and beforeunload.
 */
let follow: { env: Omit<NonNullable<RememberEnv>, "active" | "now">; until: number; now: () => number } | null = null;
let listening = false;

function browserListen(): Listen | null {
  return typeof window === "undefined" ? null : (type, fn) => window.addEventListener(type, fn);
}

/**
 * `rememberPageSearch` for the stuck-navigation fallback, and keep the note up to date until the page unloads: on
 * every keystroke (`followPageSearch`) and once more at pagehide / beforeunload, so it holds the latest text and
 * caret rather than a snapshot. True when a note was written.
 */
export function rememberPageSearchUntilUnload(
  env: Omit<NonNullable<RememberEnv>, "now"> & { listen?: Listen | null; clock?: () => number } = {},
): boolean {
  const { listen: listenOpt, clock, storage, path, active } = env;
  const now = clock ?? (() => Date.now());
  const at = now();
  if (!rememberPageSearch({ storage, path, active, now: at })) return false;
  follow = { env: { storage, path }, until: at + SEARCH_RESTORE_TTL_MS, now };
  const listen = listenOpt === undefined ? browserListen() : listenOpt;
  if (listen && !listening) {
    listening = true;
    const last = () => void followPageSearch();
    listen("pagehide", last);
    listen("beforeunload", last);
  }
  return true;
}

/**
 * A keystroke in the page's search box (or the page unloading): while a fallback reload is under way, rewrite the
 * note with `field`'s text and caret (default: the focused field). False, writing nothing, at any other time.
 */
export function followPageSearch(field?: FieldLike | null): boolean {
  if (!follow) return false;
  const now = follow.now();
  if (now > follow.until) {
    follow = null;
    return false;
  }
  return rememberPageSearch({ ...follow.env, active: field, now });
}

/** For tests: forget a follow left by an earlier case (a real document ends with its page). */
export function stopFollowingPageSearch(): void {
  follow = null;
  listening = false;
}

/**
 * What the reloaded box shows (final review I2): text typed into the server-rendered field before hydration (its
 * value differs from the URL's q the server rendered) wins over the note — it is newer than anything the old page
 * saw; otherwise the note. Null with no note.
 */
export function pickRestoredSearch(
  note: { text: string; caret: number } | null,
  field: { value: string; selectionStart: number | null },
  serverValue: string,
): { text: string; caret: number } | null {
  if (!note) return null;
  if (field.value !== serverValue) return { text: field.value, caret: field.selectionStart ?? field.value.length };
  return note;
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
