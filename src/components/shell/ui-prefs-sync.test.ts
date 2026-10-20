import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 spec §5.4: UiPrefsSync's loop guard. Unit tests are node-only (no DOM renderer runs effects), so React's
 * useRef and useEffect are replaced by a tiny one-instance hooks harness: refs persist across renders of one mount,
 * and an effect runs when its deps change, as React would. restoreUiPrefs and the router are mocked.
 */

type Prefs = { theme: "light" | "dark"; density: string } | null;

const h = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  refAt: 0,
  effects: [] as Array<unknown[]>,
  effectAt: 0,
  restore: vi.fn<() => Promise<Prefs>>(),
  refresh: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (init: unknown) => {
    const i = h.refAt++;
    h.refs[i] ??= { current: init };
    return h.refs[i];
  },
  useEffect: (fn: () => void, deps: unknown[]) => {
    const i = h.effectAt++;
    const prev = h.effects[i];
    if (prev && deps.length === prev.length && deps.every((d, j) => Object.is(d, prev[j]))) return;
    h.effects[i] = deps;
    fn();
  },
}));
const router = { refresh: h.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/server/ui-prefs", () => ({ restoreUiPrefs: h.restore }));

const { UiPrefsSync } = await import("./ui-prefs-sync");

/** One render of the mounted component. */
function render(userId: string, cookieUid: string | undefined) {
  h.refAt = 0;
  h.effectAt = 0;
  return UiPrefsSync({ userId, cookieUid });
}
/** Let the restore's promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const html = { dataset: {} as Record<string, string> };

beforeEach(() => {
  h.refs = [];
  h.effects = [];
  h.restore.mockReset().mockResolvedValue({ theme: "dark", density: "compact" });
  h.refresh.mockReset();
  html.dataset = {};
  vi.stubGlobal("document", { documentElement: html });
});
afterEach(() => vi.unstubAllGlobals());

describe("UiPrefsSync's loop guard (Review Focus #4)", () => {
  it("restores once and refreshes once when the browser holds someone else's settings, and never again on a re-render", async () => {
    expect(render("u1", "u2")).toBeNull();
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(html.dataset).toEqual({ theme: "dark", density: "compact" });

    render("u1", "u2");
    await settle();
    // A re-render whose br.uid still isn't this person's (say the restore's cookie hadn't landed): the `tried` ref holds.
    render("u1", undefined);
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("restores for a browser that holds nobody's settings yet", async () => {
    render("u1", undefined);
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the restore returns nothing (signed out)", async () => {
    h.restore.mockResolvedValue(null);
    render("u1", "u2");
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(html.dataset).toEqual({});
  });

  it("does nothing when the settings are already this person's", async () => {
    render("u1", "u1");
    render("u1", "u1");
    await settle();
    expect(h.restore).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("does not retry in a loop after a failed restore", async () => {
    h.restore.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render("u1", "u2");
    await settle();
    render("u1", undefined);
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
