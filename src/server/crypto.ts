import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  const b64 = process.env.SECRET_ENCRYPTION_KEY;
  if (!b64) throw new Error("SECRET_ENCRYPTION_KEY is not set — add it to .env (never commit it)");
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) throw new Error("SECRET_ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}

/**
 * AES-256-GCM → base64(version || iv || tag || data) — the AssetSecret.ciphertext
 * format (v1). `aad` binds the ciphertext to its row identity (callers pass
 * `${assetId}:${label}`) so a value lifted from one row refuses to decrypt in
 * another; the version byte makes key rotation a data migration instead of an
 * archaeology dig.
 */
export function encryptSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(ciphertext: string, aad: string): string {
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < 1 + IV_LEN + TAG_LEN || raw[0] !== VERSION) {
    throw new Error("Unsupported ciphertext format");
  }
  const iv = raw.subarray(1, 1 + IV_LEN);
  const tag = raw.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const data = raw.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
