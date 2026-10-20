import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordTabs } from "./record-tabs";
import { DocumentsPanel, type DocumentRow } from "./documents-panel";

const h = vi.hoisted(() => ({ path: "/inventory/a1/notes" }));

// The tabs read the path; the panel reaches for the router and the document actions (auth, db). Markup tests never navigate.
vi.mock("next/navigation", () => ({
  usePathname: () => h.path,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/server/modules/inventory/document-actions", () => ({ markDocumentSigned: vi.fn(), uploadDocument: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

/** The opening tag of the first element matching `re`. */
const tagWith = (html: string, re: RegExp) => html.match(re)?.[0] ?? "";

describe("RecordTabs: Notes and Attachments (Phase 47 Task 8)", () => {
  const html = (over: Partial<Parameters<typeof RecordTabs>[0]> = {}) =>
    renderToStaticMarkup(
      <RecordTabs assetId="a1" cls="IT" showSecrets counts={{ notes: 3, openNotes: 1, attachments: 2 }} {...over} />,
    );

  it("lists Notes and Attachments after Documents, linking their routes", () => {
    const out = html();
    const labels = [...out.matchAll(/<a [^>]*>(?:<span[^>]*>)?(Overview|History|Timeline|Documents|Notes|Attachments|Secrets|Reservations)/g)].map((m) => m[1]);
    expect(labels).toEqual(["Overview", "History", "Timeline", "Documents", "Notes", "Attachments", "Secrets", "Reservations"]);
    expect(out).toContain('href="/inventory/a1/notes"');
    expect(out).toContain('href="/inventory/a1/attachments"');
  });

  it("marks the open route aria-current", () => {
    const out = html();
    expect(tagWith(out, /<a [^>]*href="\/inventory\/a1\/notes"[^>]*>/)).toContain('aria-current="page"');
    expect(tagWith(out, /<a [^>]*href="\/inventory\/a1\/attachments"[^>]*>/)).not.toContain("aria-current");
  });

  it("badges: the thread count (amber while a thread is open) and the attachment count", () => {
    h.path = "/inventory/a1";
    const out = html();
    h.path = "/inventory/a1/notes";
    const notes = out.match(/<a [^>]*href="\/inventory\/a1\/notes".*?<\/a>/)?.[0] ?? "";
    const files = out.match(/<a [^>]*href="\/inventory\/a1\/attachments".*?<\/a>/)?.[0] ?? "";
    expect(notes).toMatch(/>3<\/span>/);
    expect(notes).toContain("--st-attention-bg");
    expect(files).toMatch(/>2<\/span>/);
    expect(files).not.toContain("--st-attention-bg");
  });

  it("keeps both tabs on a Purchasing asset, without Secrets or Reservations", () => {
    const out = html({ cls: "PURCHASING", showSecrets: false });
    expect(out).toContain("/inventory/a1/notes");
    expect(out).toContain("/inventory/a1/attachments");
    expect(out).not.toContain("/secrets");
    expect(out).not.toContain("/reservations");
  });
});

describe("DocumentsPanel groups attachments (Phase 47 Task 8)", () => {
  const row = (over: Partial<DocumentRow>): DocumentRow => ({
    id: "d1", kind: "receipt", fileName: "receipt.pdf", signed: false, uploadedBy: "Ana", at: "Oct 2, 2026",
    downloadHref: "/inventory/a1/documents/d1/download", ...over,
  });
  const panel = (docs: DocumentRow[], canSign = true) =>
    renderToStaticMarkup(<DocumentsPanel assetId="a1" docs={docs} canUpload={false} canSign={canSign} />);

  const docs = [
    row({}),
    row({ id: "d2", kind: "accountability-form", fileName: "form.pdf" }),
    row({ id: "d3", kind: "attachment:proof-of-payment", fileName: "gcash.png", downloadHref: "/inventory/a1/documents/d3/download" }),
    row({ id: "d4", kind: "attachment:photo", fileName: "front.jpg" }),
  ];

  it("shows the document slots first, then an Attachments heading with a link to the tab and the attachment rows", () => {
    const out = panel(docs);
    const heading = out.indexOf(">Attachments<");
    expect(heading).toBeGreaterThan(out.indexOf("form.pdf"));
    expect(out.indexOf("gcash.png")).toBeGreaterThan(heading);
    expect(out.indexOf("front.jpg")).toBeGreaterThan(heading);
    expect(out).toContain('href="/inventory/a1/attachments"');
  });

  it("labels an attachment with its kind's words, not the raw attachment:* kind", () => {
    const out = panel(docs);
    expect(out).toContain("Proof of payment");
    expect(out).not.toContain("attachment:");
  });

  it("offers Mark signed only on an unsigned accountability form, never on an attachment", () => {
    const out = panel(docs);
    expect(out.match(/Mark signed/g)).toHaveLength(1);
    const attachmentsPart = out.slice(out.indexOf(">Attachments<"));
    expect(attachmentsPart).not.toContain("Mark signed");
    // even if one were somehow flagged as an accountability-style row, an attachment kind is never signable
    const odd = panel([row({ id: "d9", kind: "attachment:other", fileName: "x.pdf" })]);
    expect(odd).not.toContain("Mark signed");
  });

  it("no Attachments heading when there are none", () => {
    expect(panel([row({})])).not.toContain(">Attachments<");
  });

  it("only attachments: still lists them under the heading, with no empty-state text", () => {
    const out = panel([docs[2]]);
    expect(out).toContain("gcash.png");
    expect(out).not.toContain("Nothing attached yet");
  });
});
