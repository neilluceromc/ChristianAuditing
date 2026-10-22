import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Record a signed form reaches for the router, a toast and a server action (auth, db); a markup test never presses it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/server/modules/employees/acknowledgement-actions", () => ({ recordAcknowledgement: vi.fn() }));

import { FormTab, type AckRow } from "./form-tab";

const ack = (over: Partial<AckRow> = {}): AckRow => ({
  id: "k2", signedAt: new Date("2026-10-21T00:00:00Z"), items: [{}, {}, {}], fileName: "signed-form.pdf",
  uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "A. Reyes", ...over,
});
const render = (latest: AckRow | null, history: AckRow[] = []) =>
  renderToStaticMarkup(<FormTab employeeId="e1" latest={latest} history={history} uncovered={[]} canRecord={false} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("FormTab: the signed forms", () => {
  it("the latest form: its signed date, then Uploaded <date time> · <recorded by>, Preview (the dialog) and Download", () => {
    const html = render(ack());
    const t = text(html);
    expect(t).toContain("Signed 21 Oct 2026 · covers 3 items");
    expect(t).toContain("Uploaded 22 Oct 2026 09:41 · A. Reyes");
    expect(html).toMatch(/<button[^>]*>Preview<span class="sr-only"> signed-form.pdf<\/span><\/button>/);
    expect(html).toMatch(/<a href="\/employees\/e1\/acknowledgements\/k2\/download"[^>]*>Download<\/a>/);
  });

  it("History: each older form with its signed date, the uploaded line, Preview and Download", () => {
    const older = ack({ id: "k1", signedAt: new Date("2026-03-02T00:00:00Z"), items: [{}], fileName: "old.jpg", uploadedAt: "2026-03-03T06:05:00.000Z", uploadedBy: null });
    const html = render(ack(), [older]);
    const history = html.slice(html.indexOf("History (1)"));
    const t = text(history);
    expect(t).toContain("02 Mar 2026 · 1 item · Uploaded 03 Mar 2026 14:05 ·");
    expect(t).not.toContain("Uploaded 03 Mar 2026 14:05 · null");
    expect(history).toMatch(/<button[^>]*>Preview<span class="sr-only"> old.jpg<\/span><\/button>/);
    expect(history).toMatch(/<a href="\/employees\/e1\/acknowledgements\/k1\/download"[^>]*>Download<\/a>/);
  });

  it("nothing on file: no Preview, no uploaded line", () => {
    const html = render(null);
    expect(text(html)).toContain("No signed form on file");
    expect(html).not.toContain("Preview");
    expect(html).not.toContain("Uploaded");
  });
});
