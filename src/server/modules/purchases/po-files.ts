import type { PoDocumentSlot } from "@/lib/documents";
import { storeUpload } from "@/server/uploads";
import { deleteObject } from "@/server/storage";

/*
 * PO form redesign (spec §5b.1, Review Focus 2): the PO form saves its documents with the PO in one request. The files
 * go to storage first — never inside the database transaction — and the PO and its document rows are then written in
 * one transaction. If anything after the store fails, the caller runs `cleanup()`, so no stored file is left that no
 * row points at. Not a server action: only po-actions.ts calls it, with files it has already validated.
 */

export type PoFile = { kind: PoDocumentSlot; file: File };
export type StoredFile = { kind: PoDocumentSlot; relPath: string; checksum: string; fileName: string; size: number };

/**
 * Stores each file under `requests/<poId>/<kind>/` (one folder per slot, so two slots holding the same file name
 * stored in the same millisecond never collide). A store that fails part-way removes what it had stored and rethrows.
 * `cleanup()` deletes every stored file; a delete that fails is logged, never thrown — the caller is already
 * reporting the failure that made it clean up.
 */
export async function storePoFiles(
  /** The PO's id: a new PO's is minted before the store (saveImpl), so its files sit with every other PO document. */
  poId: string,
  files: readonly PoFile[],
): Promise<{ stored: StoredFile[]; cleanup(): Promise<void> }> {
  const stored: StoredFile[] = [];
  const cleanup = async () => {
    await Promise.all(stored.map(async (s) => {
      try {
        await deleteObject(s.relPath);
      } catch (err) {
        console.error(`po-files: could not remove ${s.relPath} after a failed save`, err);
      }
    }));
  };
  try {
    for (const f of files) {
      const s = await storeUpload(`requests/${poId}/${f.kind}`, f.file);
      stored.push({ kind: f.kind, ...s });
    }
  } catch (err) {
    await cleanup();
    throw err;
  }
  return { stored, cleanup };
}
