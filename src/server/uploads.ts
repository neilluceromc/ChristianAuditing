import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};

/** Pure: the same three refusals uploadDocument has always made, in one place. */
export function checkUploadMeta(meta: { name: string; type: string; size: number }): string | null {
  if (meta.size === 0) return "Pick a file first";
  if (meta.size > UPLOAD_MAX_BYTES) return "Too big — the cap is 10 MB";
  const ext = path.extname(meta.name).toLowerCase();
  if (!UPLOAD_TYPES[ext] || (meta.type && meta.type !== UPLOAD_TYPES[ext])) return "That type isn't allowed. Accepted: PDF, PNG, JPG.";
  return null;
}

export function validateUpload(value: unknown): { ok: true; file: File } | { ok: false; error: string } {
  if (!(value instanceof File)) return { ok: false, error: "Pick a file first" };
  const error = checkUploadMeta({ name: value.name, type: value.type, size: value.size });
  return error ? { ok: false, error } : { ok: true, file: value };
}

/**
 * Ruling R11: `content-disposition: attachment; filename="<name>"` throws at
 * the http layer when `<name>` carries a char outside Latin-1, or a raw
 * CR/LF (header injection). Emit the RFC 6266 pair instead: an ASCII-safe
 * `filename` fallback plus a `filename*` carrying the real name.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  const encoded = encodeURIComponent(fileName.replace(/[\r\n\0]/g, ""));
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Writes under uploads/<relDir>/<timestamp>-<safeName>; returns the relative posix path the row stores. */
export async function storeUpload(relDir: string, file: File): Promise<{ relPath: string; checksum: string; fileName: string }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const safeName = path.basename(file.name).replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const relPath = path.posix.join(relDir, `${Date.now()}-${safeName}`);
  await mkdir(path.join(process.cwd(), "uploads", ...relDir.split("/")), { recursive: true });
  await writeFile(path.join(process.cwd(), "uploads", relPath), bytes);
  return { relPath, checksum, fileName: path.basename(file.name) };
}
