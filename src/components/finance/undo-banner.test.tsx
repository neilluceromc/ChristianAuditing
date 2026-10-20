import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UndoBanner } from "./undo-banner";
import { ReopenReview } from "./reopen-review";

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
});
