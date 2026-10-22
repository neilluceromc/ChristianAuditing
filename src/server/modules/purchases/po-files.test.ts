import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * PO form redesign (spec §5b.1, Review Focus 2): the save stores its files first, then writes the PO in one
 * transaction; when anything after the store fails, cleanup removes every file it stored.
 */

const h = vi.hoisted(() => ({
  objects: {} as Record<string, string>,
  deleted: [] as string[],
  failWriteOn: null as string | null,
}));

vi.mock("@/server/storage", () => ({
  writeObject: async (relPath: string, bytes: Buffer) => {
    if (h.failWriteOn && relPath.includes(h.failWriteOn)) throw new Error("bucket unavailable");
    h.objects[relPath] = bytes.toString();
  },
  deleteObject: async (relPath: string) => {
    h.deleted.push(relPath);
    delete h.objects[relPath];
  },
}));

import { storePoFiles } from "./po-files";

const file = (name: string, type = "application/pdf") => new File([`bytes of ${name}`], name, { type });

beforeEach(() => {
  h.objects = {};
  h.deleted = [];
  h.failWriteOn = null;
});

describe("storePoFiles", () => {
  it("stores each file under the PO, one folder per kind, and cleanup deletes them all", async () => {
    const { stored, cleanup } = await storePoFiles("po-1", [
      { kind: "invoice", file: file("scan.pdf") },
      { kind: "official-receipt", file: file("scan.pdf") },
    ]);
    expect(stored.map((s) => [s.kind, s.fileName])).toEqual([["invoice", "scan.pdf"], ["official-receipt", "scan.pdf"]]);
    expect(stored[0].relPath).toMatch(/^requests\/po-1\/invoice\/\d+-scan\.pdf$/);
    expect(stored[1].relPath).toMatch(/^requests\/po-1\/official-receipt\/\d+-scan\.pdf$/);
    expect(stored.every((s) => /^[0-9a-f]{64}$/.test(s.checksum))).toBe(true);
    expect(Object.keys(h.objects).sort()).toEqual(stored.map((s) => s.relPath).sort());

    await cleanup();
    expect(h.objects).toEqual({});
    expect(h.deleted.sort()).toEqual(stored.map((s) => s.relPath).sort());
  });

  it("a store that fails part-way removes what it already stored, and rethrows", async () => {
    h.failWriteOn = "warranty-slip";
    await expect(storePoFiles("po-1", [
      { kind: "invoice", file: file("si.pdf") },
      { kind: "warranty-slip", file: file("ws.png", "image/png") },
    ])).rejects.toThrow("bucket unavailable");
    expect(h.objects).toEqual({});
    expect(h.deleted).toHaveLength(1);
  });

  it("no files: nothing stored, and cleanup is a no-op", async () => {
    const { stored, cleanup } = await storePoFiles("po-1", []);
    expect(stored).toEqual([]);
    await cleanup();
    expect(h.deleted).toEqual([]);
  });
});
