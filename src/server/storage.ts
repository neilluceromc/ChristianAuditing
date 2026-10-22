import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where uploaded documents live. Local disk (`uploads/` under the cwd) unless
 * both Supabase env vars are set, in which case the Storage REST API is used.
 * The bucket is `documents`, private; reads and writes use the service key.
 */
const BUCKET = "documents";

const STORAGE_NOT_CONFIGURED = "Storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel";

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

/** Up to 200 characters of a failed response's body, for diagnosis. Never headers, never the key. */
async function bodySnippet(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

function failure(what: string, status: number, body: string): Error {
  return new Error(`Supabase storage ${what} failed: ${status}${body ? ` ${body}` : ""}`);
}

/** Supabase sometimes reports a missing object as 400 with a body whose statusCode is "404" (or error "not_found"). */
function isMissingBody(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { statusCode?: unknown; error?: unknown } | null;
    return String(parsed?.statusCode) === "404" || parsed?.error === "not_found";
  } catch {
    return false;
  }
}

/**
 * Auth headers for the service key. Supabase's new secret keys (`sb_secret_…`) are not JWTs and go in `apikey`
 * only; the legacy `service_role` key is a JWT and goes in both `apikey` and `Authorization: Bearer`.
 */
export function authHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return key.startsWith("eyJ") ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
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
        ...authHeaders(),
        "content-type": contentType,
        "x-upsert": "false",
      },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw failure("write", res.status, await bodySnippet(res));
    return;
  }
  // On Vercel the disk is read-only and temporary: a missing Supabase variable must fail by name, not as EROFS.
  if (process.env.VERCEL) throw new Error(STORAGE_NOT_CONFIGURED);
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
      headers: authHeaders(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await bodySnippet(res);
      if (res.status === 400 && isMissingBody(body)) return null;
      throw failure("read", res.status, body);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  if (process.env.VERCEL) return null; // no local files on Vercel; see writeObject
  const abs = localAbs(relPath);
  if (!abs) return null;
  return readFile(abs).catch(() => null);
}

/**
 * Removes a stored object. Only for files nothing references yet: a save that stored its documents and then failed
 * (src/server/modules/purchases/po-files.ts). Documents on record are never deleted (append-only). A missing object
 * counts as removed.
 */
export async function deleteObject(relPath: string): Promise<void> {
  if (!isSafeRelPath(relPath)) throw new Error(`Invalid upload path: ${relPath}`);
  if (storageDriver() === "supabase") {
    const res = await fetch(objectUrl("object", relPath), { method: "DELETE", headers: authHeaders() });
    if (res.ok || res.status === 404) return;
    const body = await bodySnippet(res);
    if (res.status === 400 && isMissingBody(body)) return;
    throw failure("delete", res.status, body);
  }
  if (process.env.VERCEL) return; // nothing was written locally; see writeObject
  const abs = localAbs(relPath);
  if (!abs) throw new Error(`Invalid upload path: ${relPath}`);
  await unlink(abs).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}
