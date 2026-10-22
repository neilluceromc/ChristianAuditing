import { fmtDateTime } from "./format";
import { fileExtension, isPreviewable } from "./upload-meta";

/**
 * How a file shows in place (what the download routes' `?inline=1` serves, PREVIEWABLE in upload-meta.ts): a PDF in a
 * frame, a PNG or JPG as an image, or not at all. The one answer for the Preview dialog, DocPreview and the Finance
 * review viewer.
 */
export function previewKindOf(fileName: string): "pdf" | "image" | null {
  if (!isPreviewable(fileName)) return null;
  return fileExtension(fileName).toLowerCase() === ".pdf" ? "pdf" : "image";
}

/**
 * Every listed file's "Uploaded 22 Oct 2026 09:41 · A. Reyes" line (Manila time, to the minute). A row nobody
 * uploaded (a system or imported row) reads "Uploaded 22 Oct 2026 09:41", with no stand-in name; no date, no line.
 */
export function uploadedLine(uploadedAt: string | Date | null | undefined, uploadedBy: string | null | undefined): string | null {
  if (!uploadedAt) return null;
  const by = uploadedBy?.trim();
  return `Uploaded ${fmtDateTime(uploadedAt)}${by ? ` · ${by}` : ""}`;
}

/**
 * What the Preview could read from its frame once it loaded: the same-origin document's `contentType` and the
 * frame's `location.pathname`. Null (or null fields) when the frame can't be read — a cross-origin frame, which is
 * what Firefox's pdf.js viewer is (its `resource://pdf.js` principal hides a text/html viewer page).
 */
export type FrameSeen = { contentType: string | null; pathname: string | null } | null;

/**
 * Whether a loaded frame shows a failure instead of the file. Only two things count:
 * (a) a readable document whose type is text/plain — the download routes' own 404 bodies ("Not found", "File missing
 *     from the uploads volume");
 * (b) a readable frame that has navigated away from the inline URL's path — a sign-in redirect.
 * Anything else — an application/pdf document, an HTML page still at the file's own path, a frame that can't be
 * read — is a file that loaded, so a working PDF is never hidden behind "Couldn't load this file".
 * `expectedPathname` is null when there is no path to compare (a held file's object URL, which cannot redirect).
 */
export function frameLoadFailed(seen: FrameSeen, expectedPathname: string | null): boolean {
  if (!seen) return false;
  if (seen.contentType === "text/plain") return true;
  return expectedPathname !== null && seen.pathname !== null && seen.pathname !== expectedPathname;
}
