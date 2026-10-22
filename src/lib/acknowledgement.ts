import { uploadStamp } from "@/lib/upload-meta";

export interface AckItem { assetId: string; tag: string; model: string; serial: string | null }

/** Held items the last signed form does not cover. With no form on file, all of them. */
export function uncoveredItems<A extends { assetId: string; tag: string }>(held: A[], last: Array<{ assetId: string }> | null): A[] {
  if (!last) return held;
  const covered = new Set(last.map((i) => i.assetId));
  return held.filter((h) => !covered.has(h.assetId));
}

/**
 * Ruling R10: a signing date is a calendar date, not an instant. Someone
 * signing shortly after local midnight in a timezone ahead of UTC (e.g.
 * Manila, UTC+8) must still be able to pick "today" even though `now` in
 * UTC still reads as yesterday. So the refusal line is one full day out:
 * the UTC calendar date of `now + 1 day`.
 */
export function latestSigningDate(now: Date): string {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

/**
 * One signed form as the side card's Form tab lists it: its signed date, items and file name, plus when the file was
 * uploaded (`createdAt`, ISO) and who recorded it (`recordedBy`'s name, or null) for the "Uploaded …" line. Only
 * these reach the client — never the stored path or checksum.
 */
export function ackRow(row: {
  id: string; signedAt: Date; items: unknown; fileName: string; createdAt: Date; recordedBy: { name: string } | null;
}): { id: string; signedAt: Date; items: unknown; fileName: string; uploadedAt: string; uploadedBy: string | null } {
  return {
    id: row.id, signedAt: row.signedAt, items: row.items, fileName: row.fileName,
    ...uploadStamp(row.createdAt, row.recordedBy),
  };
}
