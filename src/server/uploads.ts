import { createHash } from "node:crypto";
import path from "node:path";
import { checkUploadMeta, isPreviewable, UPLOAD_TYPES } from "@/lib/upload-meta";
import { writeObject } from "./storage";

// The limits and the pure meta check live in src/lib (client-safe, so the browser pre-checks with the same rules);
// re-exported here so server callers are unchanged.
export { checkUploadMeta, PREVIEWABLE, UPLOAD_MAX_BYTES, UPLOAD_TYPES } from "@/lib/upload-meta";

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
export function contentDisposition(fileName: string, disposition: "attachment" | "inline" = "attachment"): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  const encoded = encodeURIComponent(fileName.replace(/[\r\n\0]/g, ""));
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Every download route's response, once its own auth and ownership checks have passed: `content-type` from
 * UPLOAD_TYPES (else octet-stream), `inline` only for `?inline=1` on a PREVIEWABLE type (else `attachment`), the
 * name through `contentDisposition` (R11), and always `nosniff` so a browser never guesses a type into HTML.
 */
export function fileResponse(bytes: Uint8Array, fileName: string, req: Request): Response {
  const inline = isPreviewable(fileName) && new URL(req.url).searchParams.get("inline") === "1";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": UPLOAD_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": contentDisposition(fileName, inline ? "inline" : "attachment"),
      "x-content-type-options": "nosniff",
    },
  });
}

/** Writes under uploads/<relDir>/<timestamp>-<safeName>; returns the relative posix path the row stores. */
export async function storeUpload(relDir: string, file: File): Promise<{ relPath: string; checksum: string; fileName: string; size: number }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const safeName = path.basename(file.name).replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const relPath = path.posix.join(relDir, `${Date.now()}-${safeName}`);
  await writeObject(relPath, bytes, UPLOAD_TYPES[path.extname(safeName).toLowerCase()] ?? "application/octet-stream");
  return { relPath, checksum, fileName: path.basename(file.name), size: bytes.length };
}
