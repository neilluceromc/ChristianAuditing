import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 (Task 6 fix round 1, review Minor 5): markDocumentSigned flips `signed` on an accountability form that
 * came back signed. An attachment (`attachment:*`, spec §4.4) is not a form and is never signed — and the flip would
 * be a write onto an attachment row outside canPostOnAsset — so it is refused with nothing written.
 */

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  docs: [] as Array<Record<string, unknown>>,
  updates: [] as unknown[],
  audits: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/server/auth/guards", () => ({ actionUser: async () => h.user }));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/server/audit", () => ({ writeAudit: async (_tx: unknown, entry: Record<string, unknown>) => { h.audits.push(entry); } }));
vi.mock("@/server/uploads", () => ({ storeUpload: vi.fn(), validateUpload: vi.fn() }));
vi.mock("@/server/db/client", () => {
  const tx = { assetDocument: { update: async (args: unknown) => { h.updates.push(args); return {}; } } };
  return {
    prisma: {
      assetDocument: {
        findUnique: async ({ where }: { where: { id: string } }) => h.docs.find((d) => d.id === where.id) ?? null,
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { markDocumentSigned } from "./document-actions";

const IT = { id: "u-it", name: "Ivan Tan", role: "it_staff" };
const doc = (id: string, kind: string) => ({
  id, kind, assetId: "a-it", fileName: `${id}.pdf`, signed: false, asset: { cls: "IT" },
});

beforeEach(() => {
  h.user = IT;
  h.docs = [doc("form", "accountability-form"), ...["proof-of-payment", "quotation", "photo", "other"].map((k) => doc(k, `attachment:${k}`))];
  h.updates = [];
  h.audits = [];
  h.revalidated = [];
});

describe("markDocumentSigned", () => {
  it("still signs an accountability form", async () => {
    expect(await markDocumentSigned({ docId: "form" })).toEqual({ ok: true, data: null });
    expect(h.updates).toEqual([{ where: { id: "form" }, data: { signed: true } }]);
    expect(h.audits[0]).toMatchObject({ action: "document.signed", entityId: "a-it" });
  });

  it.each(["proof-of-payment", "quotation", "photo", "other"])("refuses the attachment kind %s, writing nothing", async (kind) => {
    expect(await markDocumentSigned({ docId: kind })).toEqual({
      ok: false, kind: "conflict", message: "Attachments can't be signed.",
    });
    expect(h.updates).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
    expect(h.revalidated).toHaveLength(0);
  });
});
