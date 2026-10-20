/*
 * The upload limits and the pure meta check, in one client-safe place (no node imports): the server's
 * `validateUpload` (src/server/uploads.ts re-exports these) and the browser's pre-checks share them, so the cap
 * and the allowed types cannot drift.
 */

// Decimal 4 MB, just under the 4 MiB server-action body limit (next.config.ts), so the multipart
// boundaries and form fields around a maximum-size file still fit.
export const UPLOAD_MAX_BYTES = 4_000_000;
export const UPLOAD_TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};

/** The same answer as node's `path.posix.extname` (".pdf" and ".." have none; trailing slashes are ignored). */
export function fileExtension(name: string): string {
  const trimmed = name.replace(/\/+$/, "");
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (base === "..") return "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

/** Pure: the same three refusals uploadDocument has always made, in one place. */
export function checkUploadMeta(meta: { name: string; type: string; size: number }): string | null {
  if (meta.size === 0) return "Pick a file first";
  if (meta.size > UPLOAD_MAX_BYTES) return "Too big — the cap is 4 MB";
  const ext = fileExtension(meta.name).toLowerCase();
  if (!UPLOAD_TYPES[ext] || (meta.type && meta.type !== UPLOAD_TYPES[ext])) return "That type isn't allowed. Accepted: PDF, PNG, JPG.";
  return null;
}
