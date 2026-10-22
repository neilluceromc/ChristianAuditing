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
