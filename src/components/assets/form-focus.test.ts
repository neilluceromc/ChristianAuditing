import { describe, expect, it, vi } from "vitest";
import { RESOLVE_TOGGLE_ATTR, focusResolveToggle, settleNoteResult, settleUploadResult, stageUploadFile } from "./form-focus";
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

describe("stageUploadFile: the browser refuses what the server would, before anything is sent", () => {
  const handles = () => ({ stage: vi.fn(), refuse: vi.fn() });

  it("an oversized phone photo is refused in the server's words and never staged", () => {
    const h = handles();
    const photo = { name: "IMG_2041.jpg", type: "image/jpeg", size: 6_500_000 };
    expect(stageUploadFile(photo, h)).toBe(false);
    expect(h.refuse).toHaveBeenCalledWith("Too big — the cap is 4 MB");
    expect(h.stage).toHaveBeenCalledWith(null);
  });

  it("the cap is the server's: 4,000,000 bytes is staged, one more is refused", () => {
    const at = handles();
    expect(stageUploadFile({ name: "a.pdf", type: "application/pdf", size: 4_000_000 }, at)).toBe(true);
    const over = handles();
    expect(stageUploadFile({ name: "a.pdf", type: "application/pdf", size: 4_000_001 }, over)).toBe(false);
    expect(over.refuse).toHaveBeenCalledWith("Too big — the cap is 4 MB");
  });

  it("refuses an empty file and a disallowed type", () => {
    const empty = handles();
    stageUploadFile({ name: "a.pdf", type: "application/pdf", size: 0 }, empty);
    expect(empty.refuse).toHaveBeenCalledWith("Pick a file first");
    expect(empty.stage).toHaveBeenCalledWith(null);
    const gif = handles();
    stageUploadFile({ name: "a.gif", type: "image/gif", size: 10 }, gif);
    expect(gif.refuse).toHaveBeenCalledWith("That type isn't allowed. Accepted: PDF, PNG, JPG.");
    expect(gif.stage).toHaveBeenCalledWith(null);
  });

  it("an accepted file is staged and clears an earlier refusal", () => {
    const h = handles();
    const file = { name: "quote.png", type: "image/png", size: 1200 };
    expect(stageUploadFile(file, h)).toBe(true);
    expect(h.refuse).toHaveBeenCalledWith(null);
    expect(h.stage).toHaveBeenCalledWith(file);
  });
});
