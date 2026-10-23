# Document preview and upload times Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any uploaded image or PDF can be viewed inside the app without downloading it, and every listed file shows when it was uploaded, to the minute, and by whom.

**Owner's request (2026-10-23):** "implement that we can do preview for the images or documents we uploaded so theres no need to download, and timestamp when they got uploaded. proceed until deployment".

**Calls I made (the owner asked to proceed without questions):**
- One shared **Preview dialog** (a modal, not a new tab) is used everywhere. It shows a PDF in a frame and a PNG or JPG as an image, both fitted to the dialog. Its header gives the file's title and name, then "Uploaded 22 Oct 2026 09:41 · A. Reyes". It has **Open in new tab**, **Download** and **Close** buttons, and Esc also closes it.
- Upload uses PDF, PNG and JPG only (`src/lib/upload-meta.ts`), so every stored file can be previewed. Anything else the dialog meets (for example an old row from an import) shows "This file type can't be shown here" and offers Download.
- **Time format:** the app's existing `fmtDateTime` ("22 Oct 2026 09:41", Asia/Manila). Every list labels it "Uploaded …".
- **Held files** (picked on the PO form but not yet saved) open in the same dialog through an object URL. Their line reads "Not saved yet".
- **Signed forms** (employee acknowledgements) keep their signed date. They add "Uploaded <date time> · <recorded by>" from `createdAt` and `recordedBy`.
- No schema change, because every document model already has `createdAt` and an uploader. No migration.

**Architecture:**
- A server helper builds the file response. It returns `inline` for PDF, PNG and JPG when `?inline=1` is present, and always sends `nosniff`. All five download routes use it.
- A client `FilePreviewDialog`, built on `src/components/ui/dialog.tsx`, plus a small `PreviewButton` that owns its open state.
- Each list's query returns `uploadedAt` as an ISO string and `uploadedBy` as a name, and the components format them with `fmtDateTime`.
- The existing in-page viewers (`DocPreview` on the asset pages, and the Finance review viewer) gain the same "Uploaded …" line.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6, Tailwind v4, vitest (node, `renderToStaticMarkup`), Playwright.

## Global Constraints
- Copy, verbatim:
  - "Preview", "Open in new tab", "Download", "Close";
  - "Uploaded {fmtDateTime} · {name}", or "Uploaded {fmtDateTime}" when there is no uploader;
  - "Not saved yet";
  - "This file type can't be shown here".
- Previewable: `.pdf` (iframe, `title` = the file name) and `.png`/`.jpg`/`.jpeg` (img, `alt` = the file name). Matching is case-insensitive.
- Auth, ownership and class checks in every route stay exactly as they are. Only the disposition changes.
- The dialog meets WCAG 2.1 AA: focus moves into it, Esc closes it, focus returns to the Preview button, and the dialog's name is the file title.
- House rules are the same as in the PO-form plan. Never read `.env`. Use no destructive git commands. CRLF files stay CRLF. Browser tests run only in the last task: on port 3100, with `--workers=1`, in chunks of 4 files or fewer.

## Review Focus
1. A file whose stored object is missing gets a 404. The dialog shows its frame and img errors as "Couldn't load this file", plus Download.
2. A file name with non-Latin-1 characters or quotes. `contentDisposition` already handles this, and the helper must keep using it.
3. A large PDF on a phone (375 px). The dialog fills the screen, and both "Open in new tab" and Download stay reachable.
4. A user without access to a vendor's or lot's page. The route's existing gate still refuses them, and inline disposition doesn't bypass it.
5. The PO form's held-file object URLs are revoked when the dialog closes, so none leak.

---

### Task 1: Inline responses on every download route, and upload times in every list's data

**Files:**
- Modify: `src/server/uploads.ts`. Add `fileResponse(bytes: Uint8Array, fileName: string, req: Request): Response`. It sends `content-type` from `UPLOAD_TYPES`, then `contentDisposition(fileName, inline ? "inline" : "attachment")`, with inline only when `?inline=1` and the extension is previewable, and always `x-content-type-options: nosniff`. Also export `PREVIEWABLE` from `src/lib/upload-meta.ts` as the single list.
- Modify these five download routes to use `fileResponse`:
  - `purchases/[id]/documents/[docId]/download`
  - `purchases/suppliers/[id]/documents/[docId]/download`
  - `inventory/[id]/(record)/documents/[docId]/download`
  - `stock/lots/[id]/documents/[docId]/download`
  - `employees/[id]/acknowledgements/[ackId]/download`
- Modify the queries so each listed file carries `uploadedAt` (an ISO string of `createdAt`) and `uploadedBy` (a display name or null), leaving the existing `at`/date fields where other code uses them:
  - `server/modules/purchases/queries.ts`
  - `suppliers/queries.ts`
  - `stock/queries.ts`
  - `finance/groups.ts`
  - the inventory documents page loader
  - the asset attachments and Finance asset panel loaders
  - the acknowledgement history loader (from `createdAt` and `recordedBy`)
- Tests:
  - `src/server/uploads.test.ts` gets `fileResponse` cases: an inline PDF; an inline JPG with an upper-case `.JPG`; `?inline=1` on a `.docx` still being an attachment; no `inline` meaning attachment; nosniff always present; a non-Latin-1 name.
  - Route tests where they exist (`inventory/.../download/route.test.ts`): add the vendor, lot and acknowledgement inline cases.
  - Query tests assert `uploadedAt` and `uploadedBy`.
- Commit: `feat(files): every download route can show a PDF or image in place; lists carry the upload time and uploader`.

### Task 2: The Preview dialog everywhere, with the upload time on every row

**Files:**
- Create `src/components/files/file-preview-dialog.tsx`:
  - `FilePreviewDialog({ open, onClose, title?, fileName, href, inlineHref, uploadedAt?, uploadedBy?, note? })`. `note` replaces the uploaded line, for example "Not saved yet".
  - `PreviewButton({ ...same file props, label?: "Preview", className? })` owns its open state and returns focus.
  - `uploadedLine(uploadedAt, uploadedBy)` in `src/lib/file-preview.ts` is a pure helper, unit-tested. `previewKindOf(fileName)` lives there too and replaces `previewKind`'s duplicate.
- Wire it into all 11 surfaces from the survey:
  1. The PO page slots in `request-documents-card.tsx`. Preview opens the dialog instead of a new tab, and the slot line reads "Uploaded … · name".
  2. The same card's "Other documents" table: add Preview, and show the date column as date and time.
  3. The PO form `documents-card.tsx`:
     - A saved slot gets Preview (the dialog) and an "Uploaded …" line, using `onFile.uploadedAt`/`uploadedBy` from the edit page loader.
     - A held file opens Preview in the dialog through an object URL, created on open and revoked on close, with "Not saved yet".
  4. The Finance review viewer: add the uploaded line above the frame.
  5. The Finance review's plain table: add Preview and date-time.
  6. Vendor documents table: add Preview and date-time.
  7. Inventory `documents-panel.tsx` `DocList`:
     - Make the file name open Preview, and keep a Download icon.
     - Show date-time.
  8. `attachments-tab.tsx`: show date-time in the meta line. Its existing `?att=` preview gains the uploaded line through `DocPreview`.
  9. `DocPreview`: add optional `uploadedAt`/`uploadedBy`, rendered as the uploaded line, and pass them from the Finance asset panel and the attachments tab.
  10. Stock `lots-card.tsx` document rows: add Preview, and "Uploaded … · name".
  11. Employee `form-tab.tsx`: the latest form and the History rows get Preview, and the "Uploaded … · name" line next to the signed date.
- Tests (vitest, `renderToStaticMarkup`):
  - `uploadedLine`, with and without a name and with a null date.
  - `previewKindOf`, covering pdf, png, JPG, docx and no extension.
  - The dialog markup when open: the iframe for a PDF with `title`, the img with `alt`, the unsupported-type copy, and the Download href.
  - Each touched list renders a Preview button and the uploaded line. Update existing snapshots and string tests that pinned the old date-only text.
- Commit: `feat(files): preview any uploaded image or PDF in place, and see when and by whom it was uploaded`.

### Task 3: Browser tests, docs, deploy (controller-run deploy)

- Create `e2e/file-preview.spec.ts`. For a PO slot, a vendor document, an asset document, a stock-lot document and a signed form:
  - Preview opens a dialog named after the file.
  - The frame or img loads with a 200, and the response is `content-disposition: inline`.
  - The "Uploaded" line matches `/Uploaded \d{1,2} \w{3} \d{4} \d{2}:\d{2}/`.
  - Esc closes the dialog and focus returns to the Preview button.
  - A held file on the new-PO form previews with "Not saved yet".
  - axe passes on the open dialog, in light and dark, and at 375 px.
- Repair specs that asserted the old date-only text or the new-tab Preview link. Run the affected specs and axe-sweep, in chunks.
- Docs: add a `docs/HANDOVER.md` entry (ax) and update the `docs/PICKUP.md` status lines.
- Commits:
  - `test(e2e): previews and upload times`
  - `docs(handover): document preview and upload times`
- Deploy: the owner pre-approved it. No migration. Scan for secrets, merge with `--no-ff`, push, then run the smoke check and a live Preview check.
