import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CrisAtWork } from "./cris-at-work";
import { CAW_FADE_MS, CAW_PACE_MS, CAW_TASKS, cawShown, createPhaseCycle } from "./cris-at-work-logic";

/* Markup only (vitest runs in node): the words, the ids, and the phase cycle's timers through fake timers. */

describe("CrisAtWork markup", () => {
  const html = renderToStaticMarkup(<CrisAtWork />);

  it("shows the heading as an h2, the first doing-line, the bubble's first line and the muted line", () => {
    expect(html).toMatch(/<h2[^>]*>Currently working on it<\/h2>/);
    expect(html).toContain(">Cris is coding the new screens.</p>");
    expect(html).toContain("Nearly there…");
    expect(html).toContain("Recording disposals and their value will come here.");
    expect(html).toContain("IN DEVELOPMENT");
  });

  it("keeps the scene one labelled image, and nothing in it is a live region", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Cris, the gold orb, at her desk inside a softly moving liquid shape');
    expect(html).not.toContain("aria-live");
    expect(html.match(/<svg[^>]*role="img"/g)).toHaveLength(1);
  });

  it("starts on the coding phase, words faded in", () => {
    expect(html).toContain("caw-ph-coding");
    expect(html).not.toContain("is-out");
  });

  it("every class it draws is the component's own (caw-), so the app's cris.css never reaches it", () => {
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
    expect(classes.length).toBeGreaterThan(50);
    for (const c of classes) expect(c === "caw" || c.startsWith("caw-") || c === "is-out", c).toBe(true);
  });

  it("ids are unique across two instances, and every url(#…) points at one of the same instance's", () => {
    const two = renderToStaticMarkup(
      <>
        <CrisAtWork />
        <CrisAtWork />
      </>,
    );
    const ids = [...two.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(2 * 14);
    expect(new Set(ids).size).toBe(ids.length);
    const refs = [...two.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(ids).toContain(r);
    expect(two).not.toMatch(/href="#/);
    // ids are plain (no colons or guillemets from useId), so url(#…) works in every browser
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("cawShown — the task and the bubble line per step", () => {
  it("walks coding, error, reading, coffee, limit, then the next line of each", () => {
    expect([0, 1, 2, 3, 4].map((s) => cawShown(s, false).task.key)).toEqual(["coding", "error", "reading", "coffee", "limit"]);
    expect(cawShown(0, false).quote).toBe("Nearly there…");
    expect(cawShown(5, false).quote).toBe("Just one more function.");
    expect(cawShown(11, false).quote).toBe("Who wrote this? Oh. Me.");
    expect(cawShown(15, false).quote).toBe("Nearly there…");
  });

  it("keeps the source's doing-lines word for word", () => {
    expect(CAW_TASKS.map((t) => `Cris is ${t.doing}.`)).toEqual([
      "Cris is coding the new screens.",
      "Cris is debugging a stubborn error.",
      "Cris is reading up on the rules.",
      "Cris is taking a quick coffee break.",
      "Cris is waiting for her Claude limit to reset.",
    ]);
  });

  it("under reduced motion it is always the calm reading phase", () => {
    for (const s of [0, 1, 3, 7, 22]) {
      expect(cawShown(s, true).task.key).toBe("reading");
      expect(cawShown(s, true).quote).toBe("Hmm, says here…");
    }
  });
});

describe("createPhaseCycle — the timers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reduced motion: schedules no timer at all", () => {
    const onFadeOut = vi.fn();
    const onNext = vi.fn();
    const c = createPhaseCycle({ reduced: true, onFadeOut, onNext });
    c.resume();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(CAW_PACE_MS * 5);
    expect(onFadeOut).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("every pace it fades the words out, then steps after the fade", () => {
    const onFadeOut = vi.fn();
    const onNext = vi.fn();
    const c = createPhaseCycle({ reduced: false, onFadeOut, onNext });
    c.resume();
    c.resume(); // a second resume does not double the interval
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(CAW_PACE_MS - 1);
    expect(onFadeOut).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFadeOut).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CAW_FADE_MS);
    expect(onNext).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CAW_PACE_MS * 2);
    expect(onNext).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it("unmount (stop) clears every timer, mid-fade too, and calls nothing more", () => {
    const onFadeOut = vi.fn();
    const onNext = vi.fn();
    const c = createPhaseCycle({ reduced: false, onFadeOut, onNext });
    c.resume();
    vi.advanceTimersByTime(CAW_PACE_MS + 100); // the fade is under way
    expect(vi.getTimerCount()).toBe(2);
    c.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(CAW_PACE_MS * 3);
    expect(onNext).not.toHaveBeenCalled();
    expect(onFadeOut).toHaveBeenCalledTimes(1);
  });

  it("a hidden tab (pause) clears the timers and finishes a fade under way; visible again (resume) restarts", () => {
    const onFadeOut = vi.fn();
    const onNext = vi.fn();
    const c = createPhaseCycle({ reduced: false, onFadeOut, onNext });
    c.resume();
    vi.advanceTimersByTime(CAW_PACE_MS + 100);
    c.pause();
    expect(vi.getTimerCount()).toBe(0);
    expect(onNext).toHaveBeenCalledTimes(1); // never left faded out
    vi.advanceTimersByTime(CAW_PACE_MS * 3);
    expect(onFadeOut).toHaveBeenCalledTimes(1);
    c.resume();
    vi.advanceTimersByTime(CAW_PACE_MS + CAW_FADE_MS);
    expect(onNext).toHaveBeenCalledTimes(2);
    c.stop();
  });
});

describe("cris-at-work.css — scoped, nothing global", () => {
  const css = readFileSync(path.join(__dirname, "cris-at-work.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("every rule's selectors sit under .caw (or the html theme on .caw); every keyframe is caw-", () => {
    const blocks = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => s && !s.startsWith("@media"));
    const selectors = blocks.filter((s) => !s.startsWith("@keyframes") && !/^(from|to|[\d.,%\s]+)$/.test(s));
    expect(selectors.length).toBeGreaterThan(20);
    for (const group of selectors)
      for (const sel of group.split(",").map((s) => s.trim()))
        expect(sel.startsWith(".caw") || sel.startsWith(':root[data-theme="dark"] .caw'), sel).toBe(true);
    const frames = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThan(5);
    for (const f of frames) expect(f.startsWith("caw-"), f).toBe(true);
  });

  it("keeps the reduced-motion rule: no animation and no transition anywhere in the scene", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.caw \*,\s*\.caw \*::after\s*\{\s*animation:\s*none\s*!important;\s*transition:\s*none\s*!important;?\s*\}/);
  });
});
