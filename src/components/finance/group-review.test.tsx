import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Markup tests never press a button: the router, the toast and the server actions are stand-ins.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/server/modules/finance/group-actions", () => ({ approveGroup: vi.fn() }));
vi.mock("@/server/modules/finance/undo-actions", () => ({ reopenGroup: vi.fn(), undoGroupAction: vi.fn() }));
vi.mock("@/server/modules/inventory/document-actions", () => ({ uploadBatchDocument: vi.fn() }));
vi.mock("@/server/modules/inventory/actions", () => ({ updateAsset: vi.fn() }));
vi.mock("@/server/modules/purchases/po-actions", () => ({ sendBackPurchaseOrder: vi.fn(), undoPoSendBack: vi.fn(), fixPurchaseOrder: vi.fn() }));

import { GroupReview, type GroupReviewAsset } from "./group-review";

/*
 * Task 9 fix round 1: why a group can't be approved yet ("No SI number yet…", "PO-… is with Purchasing…") is part of
 * the page every time it opens — a status, not an alert that interrupts a screen reader on each visit.
 */

const asset: GroupReviewAsset = {
  id: "a1", tag: "BR-LT-7790", serial: "SN-1", brand: null, model: "Latitude 5420", cls: "IT", cost: 48_000,
  reg: "with-finance", regLabel: "With Finance", returnLine: null, resubmitNote: null, money: null,
};

function render(blocked: string | null) {
  return renderToStaticMarkup(
    <GroupReview
      recordId="r1" refNo="PO-0990" registeredByRole="it_staff" blocked={blocked} assets={[asset]}
      undo={null} canReopen={false} vendors={[]}
    />,
  );
}

describe("GroupReview — why it can't be approved", () => {
  it("says it in a status region, never an alert", () => {
    const html = render("No SI number yet. Add it before approving.");
    expect(html).toMatch(/<div role="status"[^>]*>(?:(?!<\/div>).)*No SI number yet\. Add it before approving\./s);
    expect(html).not.toContain('role="alert"');
  });

  it("shows nothing of the kind when the group can be approved", () => {
    const html = render(null);
    expect(html).not.toContain("No SI number yet");
    expect(html).not.toContain('role="alert"');
  });
});
