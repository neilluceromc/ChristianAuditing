import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkUploadMeta, fileExtension, UPLOAD_MAX_BYTES, UPLOAD_TYPES } from "./upload-meta";
import * as server from "@/server/uploads";
import { slotFileAllowed } from "@/components/inventory/document-slots";

describe("upload-meta: the one client-safe upload check", () => {
  it("imports nothing from node, so client components can use it", () => {
    const src = readFileSync(path.join(__dirname, "upload-meta.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'](node:|fs|path|crypto)/);
    expect(src).not.toMatch(/\bimport\b/);
  });

  it("is what src/server/uploads.ts re-exports, so the server's callers are unchanged", () => {
    expect(server.checkUploadMeta).toBe(checkUploadMeta);
    expect(server.UPLOAD_MAX_BYTES).toBe(UPLOAD_MAX_BYTES);
    expect(server.UPLOAD_TYPES).toBe(UPLOAD_TYPES);
  });

  it("finds the extension exactly as node's path.posix.extname does", () => {
    const names = [
      "a.pdf", "a.PDF", ".pdf", "..pdf", "...pdf", "pdf", "a.", "a..pdf", "...", "..", ".", "a.b.PNG",
      "x/.pdf", "dir.x/file", "a.pdf/", "IMG_2041.jpeg", "",
    ];
    for (const n of names) expect(fileExtension(n), n).toBe(path.posix.extname(n));
  });

  it("refuses a dotfile named like an extension, as the server always has", () => {
    expect(checkUploadMeta({ name: ".pdf", type: "application/pdf", size: 10 })).toBe("That type isn't allowed. Accepted: PDF, PNG, JPG.");
    expect(checkUploadMeta({ name: "pdf", type: "application/pdf", size: 10 })).toBe("That type isn't allowed. Accepted: PDF, PNG, JPG.");
  });
});

describe("the Documents slots use the same check (document-slots.tsx)", () => {
  it("takes what the server takes", () => {
    expect(slotFileAllowed({ name: "invoice.pdf", type: "application/pdf", size: 10 })).toBe(true);
    expect(slotFileAllowed({ name: "warranty.JPG", type: "image/jpeg", size: UPLOAD_MAX_BYTES })).toBe(true);
    expect(slotFileAllowed({ name: "dr.png", type: "", size: 10 })).toBe(true);
  });

  it("refuses what the server refuses: empty, over the cap, another type, a MIME mismatch", () => {
    expect(slotFileAllowed({ name: "invoice.pdf", type: "application/pdf", size: 0 })).toBe(false);
    expect(slotFileAllowed({ name: "photo.jpg", type: "image/jpeg", size: UPLOAD_MAX_BYTES + 1 })).toBe(false);
    expect(slotFileAllowed({ name: "scan.gif", type: "image/gif", size: 10 })).toBe(false);
    expect(slotFileAllowed({ name: "invoice.pdf", type: "image/png", size: 10 })).toBe(false);
  });
});

describe("the Attachments upload pre-checks with it (attachment-upload.tsx)", () => {
  const src = readFileSync(path.join(__dirname, "..", "components", "assets", "attachment-upload.tsx"), "utf8");

  it("checks every chosen file before staging it, and again before sending", () => {
    expect(src).toMatch(/import \{ checkUploadMeta \} from "@\/lib\/upload-meta"/);
    expect(src).toMatch(/<FileDrop [^>]*onFile=\{pick\}/);
    expect(src).toMatch(/function pick\([^)]*\) \{[\s\S]*?stageUploadFile(<File>)?\(/);
    expect(src).toMatch(/function upload\(\) \{[\s\S]*?checkUploadMeta\(file\)[\s\S]*?return;[\s\S]*?action\(data\)/);
  });
});
