import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ACTION_TOAST_MS, toastLifetime } from "@/lib/toast-timing";
import { MAX_TOAST_ACTIONS, ToastCard, ToastProvider, toastExtras } from "./toast";

/*
 * Finance follow-up, Task 3 (spec §4): a toast can carry a detail line and up to two buttons (Undo, Open <tag>); the
 * old single-action call still works unchanged; a toast with a button stays 10 s.
 */

const undo = { label: "Undo", onAction: vi.fn() };
const open = { label: "Open BR-LT-0201", onAction: vi.fn() };

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

describe("toastExtras: the third argument of push", () => {
  it("nothing: no detail, no buttons", () => {
    expect(toastExtras(undefined)).toEqual({ detail: undefined, actions: [] });
  });
  it("the old single action is one button", () => {
    expect(toastExtras(undo)).toEqual({ detail: undefined, actions: [undo] });
  });
  it("a detail line and a list of buttons, at most two", () => {
    expect(MAX_TOAST_ACTIONS).toBe(2);
    const third = { label: "Third", onAction: vi.fn() };
    expect(toastExtras({ detail: "Next: BR-LT-0204 · 3 left to review", actions: [undo, open, third] })).toEqual({
      detail: "Next: BR-LT-0204 · 3 left to review", actions: [undo, open],
    });
  });
});

describe("ToastCard", () => {
  it("renders the detail line and both buttons, then Dismiss", () => {
    const html = renderToStaticMarkup(
      <ToastCard
        toast={{ id: 1, message: "Approved BR-LT-0201", tone: "settled", detail: "Depreciation starts Oct 2026\nNext: BR-LT-0204 · 3 left to review", actions: [undo, open] }}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain("Approved BR-LT-0201");
    expect(html).toContain("Depreciation starts Oct 2026\nNext: BR-LT-0204 · 3 left to review");
    expect(html).toMatch(/class="[^"]*whitespace-pre-line[^"]*"/);
    expect(buttons(html)).toEqual(["Undo", "Open BR-LT-0201", ""]);
    expect(html).toContain('aria-label="Dismiss"');
  });

  it("the old single action renders as before: the message, ·, the one button and Dismiss, no detail", () => {
    const html = renderToStaticMarkup(
      <ToastCard toast={{ id: 2, message: "Hidden until tomorrow", tone: "neutral", actions: [undo] }} onDismiss={() => {}} />,
    );
    expect(html).toContain("Hidden until tomorrow");
    expect(html).toContain('<span aria-hidden="true">·</span>');
    expect(buttons(html)).toEqual(["Undo", ""]);
    expect(html).not.toContain("whitespace-pre-line");
  });

  it("an error toast is an alert", () => {
    const html = renderToStaticMarkup(<ToastCard toast={{ id: 3, message: "Can't undo", tone: "fault", actions: [] }} onDismiss={() => {}} />);
    expect(html).toContain('role="alert"');
  });
});

describe("ToastProvider", () => {
  it("the toasts' live region is a status (Worklist H4): polite, each toast announced on its own", () => {
    const html = renderToStaticMarkup(<ToastProvider><p>page</p></ToastProvider>);
    expect(html).toMatch(/<div role="status" aria-live="polite" aria-atomic="false" class="pointer-events-none fixed/);
  });
});

describe("timing", () => {
  it("a toast with a button stays 10 s; an error stays until dismissed", () => {
    expect(ACTION_TOAST_MS).toBe(10_000);
    expect(toastLifetime("settled", true)).toBe(10_000);
    expect(toastLifetime("fault", true)).toBeNull();
  });
});
