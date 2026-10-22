import { describe, expect, it } from "vitest";
import { assetDocumentRow, parseRecordAttachmentState, recordAttachmentsHref, recordTabItems, splitDocuments } from "./inventory-record";

const counts = { notes: 3, openNotes: 1, attachments: 2 };

describe("recordTabItems (Phase 47 Task 8)", () => {
  it("includes Notes and Attachments after Documents, for an IT asset", () => {
    const tabs = recordTabItems("a1", { cls: "IT", showSecrets: true, counts });
    expect(tabs.map((t) => t.label)).toEqual([
      "Overview", "History", "Timeline", "Documents", "Notes", "Attachments", "Secrets", "Reservations",
    ]);
    expect(tabs.find((t) => t.key === "notes")?.href).toBe("/inventory/a1/notes");
    expect(tabs.find((t) => t.key === "attachments")?.href).toBe("/inventory/a1/attachments");
  });

  it("keeps Notes and Attachments on a Purchasing asset without Secrets or Reservations", () => {
    const tabs = recordTabItems("a1", { cls: "PURCHASING", showSecrets: false, counts });
    expect(tabs.map((t) => t.label)).toEqual(["Overview", "History", "Timeline", "Documents", "Notes", "Attachments"]);
  });

  it("badges: thread count (amber while a thread is open) and attachment count", () => {
    const tabs = recordTabItems("a1", { cls: "IT", showSecrets: false, counts });
    const notes = tabs.find((t) => t.key === "notes")!;
    expect(notes.count).toBe(3);
    expect(notes.tone).toBe("attention");
    expect(tabs.find((t) => t.key === "attachments")).toMatchObject({ count: 2 });
    expect(tabs.find((t) => t.key === "attachments")?.tone).toBeUndefined();
  });

  it("the Notes badge is not amber once every thread is resolved, and shows 0 for none", () => {
    const tabs = recordTabItems("a1", { cls: "IT", showSecrets: false, counts: { notes: 2, openNotes: 0, attachments: 0 } });
    expect(tabs.find((t) => t.key === "notes")?.tone).toBeUndefined();
    expect(tabs.find((t) => t.key === "attachments")?.count).toBe(0);
  });

  it("the other tabs carry no badge", () => {
    const tabs = recordTabItems("a1", { cls: "IT", showSecrets: true, counts });
    for (const k of ["overview", "history", "timeline", "documents", "secrets", "reservations"]) {
      expect(tabs.find((t) => t.key === k)?.count).toBeUndefined();
    }
  });

  it("encodes the id in every href", () => {
    const tabs = recordTabItems("a/b", { cls: "IT", showSecrets: false, counts });
    expect(tabs[0].href).toBe("/inventory/a%2Fb");
  });
});

describe("attachment URL state", () => {
  it("parses ak and att; an unknown kind reads as all, an empty att as none", () => {
    expect(parseRecordAttachmentState(new URLSearchParams("ak=photo&att=d1"))).toEqual({ ak: "photo", att: "d1" });
    expect(parseRecordAttachmentState(new URLSearchParams("ak=bogus&att="))).toEqual({ ak: "all", att: null });
    expect(parseRecordAttachmentState(new URLSearchParams(""))).toEqual({ ak: "all", att: null });
  });

  it("builds hrefs scoped to the Attachments route, leaving defaults out", () => {
    const s = { ak: "all" as const, att: null };
    expect(recordAttachmentsHref("a1", s)).toBe("/inventory/a1/attachments");
    expect(recordAttachmentsHref("a1", s, { ak: "quotation" })).toBe("/inventory/a1/attachments?ak=quotation");
    expect(recordAttachmentsHref("a1", { ak: "photo", att: "d1" }, { att: null })).toBe("/inventory/a1/attachments?ak=photo");
    expect(recordAttachmentsHref("a1", { ak: "photo", att: "d1" })).toBe("/inventory/a1/attachments?ak=photo&att=d1");
  });
});

describe("splitDocuments", () => {
  it("separates attachment:* rows from the document slots, keeping order", () => {
    const rows = [
      { id: "1", kind: "receipt" }, { id: "2", kind: "attachment:photo" },
      { id: "3", kind: "accountability-form" }, { id: "4", kind: "attachment:future-kind" },
    ];
    const { documents, attachments } = splitDocuments(rows);
    expect(documents.map((r) => r.id)).toEqual(["1", "3"]);
    expect(attachments.map((r) => r.id)).toEqual(["2", "4"]);
  });
});

describe("assetDocumentRow (the Documents page loader; document preview Task 1)", () => {
  const at = new Date("2026-10-22T01:41:00Z");
  const doc = { id: "d1", kind: "invoice", fileName: "si.pdf", signed: false, createdAt: at };

  it("carries the upload time (ISO) and the uploader's name, and keeps the date and the download link", () => {
    expect(assetDocumentRow("a1", { ...doc, uploadedBy: { name: "Ana Reyes" } })).toEqual({
      id: "d1", kind: "invoice", fileName: "si.pdf", signed: false,
      uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "Ana Reyes", at: "22 Oct 2026",
      downloadHref: "/inventory/a1/documents/d1/download",
    });
  });

  it("a row nobody uploaded (system or import) has a null uploader", () => {
    expect(assetDocumentRow("a1", { ...doc, uploadedBy: null }).uploadedBy).toBeNull();
  });
});
