import { describe, expect, it, vi } from "vitest";
import { RESOLVE_TOGGLE_ATTR, focusResolveToggle, settleNoteResult, settleUploadResult } from "./form-focus";
import type { ActionResult } from "@/server/action-result";

/*
 * Phase 47 (Task 7 review, Important 1): focus after a note, reply, resolve or upload. The tests run in node, so a
 * tiny stand-in document tracks `activeElement` the way a browser would.
 */

function fakeDocument() {
  const doc = {
    activeElement: null as unknown,
    elements: new Map<string, { name: string; focus(): void }>(),
    querySelector(selector: string) {
      return doc.elements.get(selector) ?? null;
    },
  };
  const element = (name: string, selector?: string) => {
    const el = { name, focus() { doc.activeElement = el; } };
    if (selector) doc.elements.set(selector, el);
    return el;
  };
  // the submit button disabled while it worked: the browser dropped focus to <body>
  const body = element("body");
  doc.activeElement = body;
  return { doc, element, body };
}

const ok: ActionResult<{ id: string }> = { ok: true, data: { id: "n1" } };
const refused: ActionResult<{ id: string }> = { ok: false, kind: "validation", message: "Fix", fieldErrors: { body: "Write a note first" } };
const limited: ActionResult<{ id: string }> = { ok: false, kind: "rate_limited", message: "Slow down", retryAfterSec: 30 };

describe("after a note or reply is posted", () => {
  it("saved: the box clears and has focus again", () => {
    const { doc, element } = fakeDocument();
    const box = element("textarea");
    const clear = vi.fn();
    settleNoteResult(ok, { clear, rateLimited: vi.fn(), box });
    expect(clear).toHaveBeenCalledOnce();
    expect(doc.activeElement).toBe(box);
  });
  it("refused: the text stays and the box has focus, to fix it", () => {
    const { doc, element } = fakeDocument();
    const box = element("textarea");
    const clear = vi.fn();
    settleNoteResult(refused, { clear, rateLimited: vi.fn(), box });
    expect(clear).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(box);
  });
  it("rate-limited: the countdown shows and the box has focus", () => {
    const { doc, element } = fakeDocument();
    const box = element("textarea");
    const rateLimited = vi.fn();
    settleNoteResult(limited, { clear: vi.fn(), rateLimited, box });
    expect(rateLimited).toHaveBeenCalledWith(30);
    expect(doc.activeElement).toBe(box);
  });
  it("no result yet: focus is left alone", () => {
    const { doc, element, body } = fakeDocument();
    settleNoteResult(null, { clear: vi.fn(), rateLimited: vi.fn(), box: element("textarea") });
    expect(doc.activeElement).toBe(body);
  });
});

describe("after an upload", () => {
  it("saved: the staged file clears, \"Uploaded <name>\" is announced, and Choose file has focus", () => {
    const { doc, element } = fakeDocument();
    const choose = element("choose"), upload = element("upload");
    const clear = vi.fn(), announce = vi.fn();
    settleUploadResult(ok, "quote.pdf", { clear, announce, rateLimited: vi.fn(), choose, upload });
    expect(clear).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith("Uploaded quote.pdf");
    expect(doc.activeElement).toBe(choose);
  });
  it("refused: the staged file stays and Upload has focus again", () => {
    const { doc, element } = fakeDocument();
    const choose = element("choose"), upload = element("upload");
    const clear = vi.fn(), announce = vi.fn();
    settleUploadResult(refused, "quote.pdf", { clear, announce, rateLimited: vi.fn(), choose, upload });
    expect(clear).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(upload);
  });
});

describe("after Mark resolved / Reopen", () => {
  it("focus returns to that thread's toggle, found again by its note id", () => {
    const { doc, element } = fakeDocument();
    element("other", `[${RESOLVE_TOGGLE_ATTR}="n2"]`);
    const toggle = element("toggle", `[${RESOLVE_TOGGLE_ATTR}="n1"]`);
    expect(focusResolveToggle(doc, "n1")).toBe(true);
    expect(doc.activeElement).toBe(toggle);
  });
  it("not rendered (yet): nothing moves, and the caller tries again on the next render", () => {
    const { doc, body } = fakeDocument();
    expect(focusResolveToggle(doc, "n1")).toBe(false);
    expect(doc.activeElement).toBe(body);
  });
  it("escapes the id inside the selector", () => {
    const { doc, element } = fakeDocument();
    const toggle = element("toggle", `[${RESOLVE_TOGGLE_ATTR}="a\\"b"]`);
    expect(focusResolveToggle(doc, 'a"b')).toBe(true);
    expect(doc.activeElement).toBe(toggle);
  });
});
