import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS, createLiveSearch } from "./live-search";

/*
 * Spec §7.2: the house search box filters as you type. The box's timing and its "is this the URL catching up with me,
 * or someone else changing the search?" rule live in a plain controller, so they are tested here without a DOM.
 */

let submit: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  submit = vi.fn();
});
afterEach(() => vi.useRealTimers());

const make = (initial = "") => createLiveSearch({ initial, debounceMs: SEARCH_DEBOUNCE_MS, submit });

describe("createLiveSearch — when it fires", () => {
  it("waits 300 ms after the last keystroke, then fires once with the latest text", () => {
    const s = make();
    s.input("E");
    vi.advanceTimersByTime(200);
    s.input("El");
    vi.advanceTimersByTime(200);
    s.input("Ell");
    expect(submit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(submit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("Ell", { enter: false });
  });

  it("a single letter is enough", () => {
    const s = make();
    s.input("E");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(submit).toHaveBeenCalledWith("E", { enter: false });
  });

  it("a paste (one change carrying the whole text) fires after the pause too", () => {
    const s = make();
    s.input("MAC-51");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("MAC-51", { enter: false });
  });

  it("Enter fires at once, marked as Enter, and cancels the pending keystroke search", () => {
    const s = make();
    s.input("BR-LT-0148");
    s.enter("BR-LT-0148");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("BR-LT-0148", { enter: true });
    vi.advanceTimersByTime(1000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("Enter fires even when the text is already the search (a scanner re-reading the same label)", () => {
    const s = make("BR-LT-0148");
    s.enter("BR-LT-0148");
    expect(submit).toHaveBeenCalledWith("BR-LT-0148", { enter: true });
  });

  it("an emptied box clears the search", () => {
    const s = make("Carlo");
    s.input("");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(submit).toHaveBeenCalledWith("", { enter: false });
  });

  it("Clear × clears at once", () => {
    const s = make("Carlo");
    s.input("Carl");
    s.clear();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("", { enter: false });
    vi.advanceTimersByTime(1000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("typing back to the search in force, or adding only spaces, does not navigate", () => {
    const s = make("Carlo");
    s.input("Carl");
    s.input("Carlo ");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(submit).not.toHaveBeenCalled();
  });

  it("cancel (unmount) drops a pending search", () => {
    const s = make();
    s.input("E");
    s.cancel();
    vi.advanceTimersByTime(1000);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("createLiveSearch — the URL catching up keeps the box (focus and caret stay)", () => {
  it("the URL echoing what the box sent is not adopted, even while the person has typed on", () => {
    const s = make();
    s.input("E");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    s.input("El"); // still typing when the first search lands
    expect(s.onValue("E")).toBe(false);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(s.onValue("El")).toBe(false);
  });

  it("a change from elsewhere (Clear filters, Back) is adopted and drops the pending search", () => {
    const s = make("Carlo");
    s.input("Carl");
    expect(s.onValue("")).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(submit).not.toHaveBeenCalled();
  });

  it("an emptied search that was once typed is still adopted from elsewhere later", () => {
    const s = make();
    s.input("a");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    s.input("");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    s.input("b");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(s.onValue("a")).toBe(false);
    expect(s.onValue("")).toBe(false);
    expect(s.onValue("b")).toBe(false);
    // now Clear filters sets q="" — not an echo any more
    expect(s.onValue("")).toBe(true);
  });

  it("is idempotent for a value it has already seen", () => {
    const s = make("Carlo");
    expect(s.onValue("Carlo")).toBe(false);
    expect(s.onValue("")).toBe(true);
    expect(s.onValue("")).toBe(false);
  });
});
