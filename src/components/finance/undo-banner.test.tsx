import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UndoBanner } from "./undo-banner";
import { ReopenFooter, ReopenReview } from "./reopen-review";
import { requestReviewFocus, takeReviewFocus } from "./review-focus";

// Markup tests never press a button: the router, the toast and the server actions are stand-ins.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/server/modules/finance/undo-actions", () => ({ undoFinanceAction: vi.fn(), reopenFinanceReview: vi.fn() }));

/*
 * Finance follow-up, Task 3 (spec §4): the asset page's Undo banner and the admin's Reopen review button. Who sees
 * them is decided on the server (undoBanner, canReopenReview: finance-review-ui.test.ts); this is what they render.
 */

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

describe("UndoBanner", () => {
  const state = { kind: "approve" as const, label: "You approved this at 10:42", minutesLeft: 12, endsAt: 0, msLeft: 12 * 60_000 };

  it("reads 'You approved this at 10:42 · Undo (12 min left)', with Undo a real button", () => {
    const html = renderToStaticMarkup(<UndoBanner assetId="a1" tag="BR-LT-0201" state={state} />);
    expect(text(html)).toBe("You approved this at 10:42 · Undo (12 min left)");
    expect(html).toMatch(/<button[^>]*>[\s\S]*Undo[\s\S]*<\/button>/);
  });

  it("is not a live region: the countdown is not announced", () => {
    const html = renderToStaticMarkup(<UndoBanner assetId="a1" tag="BR-LT-0201" state={state} />);
    expect(html).not.toMatch(/aria-live|role="status"|role="alert"/);
  });

  it("renders nothing once no minutes are left", () => {
    expect(renderToStaticMarkup(<UndoBanner assetId="a1" tag="BR-LT-0201" state={{ ...state, minutesLeft: 0 }} />)).toBe("");
  });
});

describe("ReopenReview", () => {
  it("is a 'Reopen review' button; the dialog stays closed until pressed", () => {
    const html = renderToStaticMarkup(<ReopenReview id="a1" tag="BR-LT-0201" />);
    expect(text(html)).toBe("Reopen review");
    expect(html).not.toContain("role=\"dialog\"");
  });

  const cancel = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Cancel(?:(?!<\/button>)[\s\S])*<\/button>/)![0];

  it("Cancel is disabled while the reopen is on its way, and the confirm button is busy", () => {
    const html = renderToStaticMarkup(<ReopenFooter pending onCancel={() => {}} onConfirm={() => {}} />);
    expect(cancel(html)).toMatch(/<button[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*>/);
  });

  it("both buttons work when nothing is pending", () => {
    const html = renderToStaticMarkup(<ReopenFooter pending={false} onCancel={() => {}} onConfirm={() => {}} />);
    expect(html).not.toContain('disabled=""');
  });
});

describe("focus after a reopen (review-focus)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    takeReviewFocus();
  });

  it("the review box that mounts next takes focus, once", () => {
    vi.useFakeTimers();
    expect(takeReviewFocus()).toBe(false);
    requestReviewFocus();
    expect(takeReviewFocus()).toBe(true);
    expect(takeReviewFocus()).toBe(false);
  });

  it("no review box came: focus left on the body goes to #main", () => {
    vi.useFakeTimers();
    const main = { focus: vi.fn() };
    const body = {};
    vi.stubGlobal("document", { body, activeElement: body, getElementById: (id: string) => (id === "main" ? main : null) });
    requestReviewFocus(3000);
    vi.advanceTimersByTime(3000);
    expect(main.focus).toHaveBeenCalledTimes(1);
  });

  it("a review box took it: the fallback leaves focus alone", () => {
    vi.useFakeTimers();
    const main = { focus: vi.fn() };
    vi.stubGlobal("document", { body: {}, activeElement: { isConnected: true }, getElementById: () => main });
    requestReviewFocus(3000);
    takeReviewFocus();
    vi.advanceTimersByTime(3000);
    expect(main.focus).not.toHaveBeenCalled();
  });
});
