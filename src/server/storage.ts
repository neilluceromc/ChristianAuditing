import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where uploaded documents live. Local disk (`uploads/` under the cwd) unless
 * both Supabase env vars are set, in which case the Storage REST API is used.
 * The bucket is `documents`, private; reads and writes use the service key.
 */
const BUCKET = "documents";

export function storageDriver(): "supabase" | "local" {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local";
}

/** A relPath is safe when it has no `..` segment, no leading `/` and no backslash. */
function isSafeRelPath(relPath: string): boolean {
  if (!relPath || relPath.startsWith("/") || relPath.includes("\\") || relPath.includes("\0")) return false;
  return !relPath.split("/").includes("..");
}

function localAbs(relPath: string): string | null {
  const root = path.resolve(process.cwd(), "uploads");
  const abs = path.resolve(root, relPath);
  return abs.startsWith(root + path.sep) ? abs : null;
}

function objectUrl(kind: "object" | "object/authenticated", relPath: string): string {
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/${kind}/${BUCKET}/${encoded}`;
}

export async function writeObject(relPath: string, bytes: Buffer, contentType: string): Promise<void> {
  if (!isSafeRelPath(relPath)) throw new Error(`Invalid upload path: ${relPath}`);
  if (storageDriver() === "supabase") {
    const res = await fetch(objectUrl("object", relPath), {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": contentType,
        "x-upsert": "false",
      },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new Error(`Supabase storage write failed: ${res.status}`);
    return;
  }
  const abs = localAbs(relPath);
  if (!abs) throw new Error(`Invalid upload path: ${relPath}`);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
}

/** The stored bytes, or null when the object is missing or the path is not safe. */
export async function readUpload(relPath: string): Promise<Buffer | null> {
  if (!isSafeRelPath(relPath)) return null;
  if (storageDriver() === "supabase") {
    const res = await fetch(objectUrl("object/authenticated", relPath), {
      headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Supabase storage read failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const abs = localAbs(relPath);
  if (!abs) return null;
  return readFile(abs).catch(() => null);
}
