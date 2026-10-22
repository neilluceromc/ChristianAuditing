import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssetAttachmentView } from "@/lib/asset-notes";

const h = vi.hoisted(() => ({
  user: { id: "u1", role: "it_staff" } as { id: string; role: string },
  asset: { id: "a1", cls: "IT" } as { id: string; cls: string } | null,
  files: [] as AssetAttachmentView[],
  readFor: [] as string[],
}));

vi.mock("@/server/auth/guards", () => ({ requireUser: async () => h.user }));
vi.mock("@/server/modules/inventory/queries", () => ({
  getVisibleAsset: async () => h.asset,
}));
vi.mock("@/server/modules/assets/queries", () => ({
  assetAttachments: async (id: string) => { h.readFor.push(id); return h.files; },
}));
vi.mock("@/server/page-titles", () => ({ assetTagFor: async () => "BR-LT-0001" }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/server/modules/assets/attachments", () => ({ uploadAttachmentFormAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

const { default: AttachmentsPage, generateMetadata } = await import("./page");

const file = (over: Partial<AssetAttachmentView>): AssetAttachmentView => ({
  id: "d1", kind: "proof-of-payment", fileName: "gcash.png", size: 120_000,
  createdAt: new Date("2026-10-20T08:00:00Z"), uploadedAt: "2026-10-20T08:00:00.000Z", uploadedBy: "Maria Reyes", ...over,
});

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await AttachmentsPage({ params: Promise.resolve({ id: "a1" }), searchParams: Promise.resolve(sp) }));

describe("Inventory record › Attachments (Phase 47 Task 8)", () => {
  beforeEach(() => {
    h.user = { id: "u1", role: "it_staff" };
    h.asset = { id: "a1", cls: "IT" };
    h.files = [file({}), file({ id: "d2", kind: "photo", fileName: "front.jpg" })];
    h.readFor = [];
  });

  it("an IT user on an IT asset sees the list and the upload area", async () => {
    const html = await render();
    expect(h.readFor).toEqual(["a1"]);
    expect(html).toContain("gcash.png");
    expect(html).toContain("front.jpg");
    expect(html).toContain("Upload an attachment");
  });

  it("builds every link on this route, with the kind filter and selection in the URL", async () => {
    const html = await render({ ak: "photo" });
    expect(html).toContain('href="/inventory/a1/attachments?ak=photo&amp;att=d2"');
    expect(html).toContain('href="/inventory/a1/attachments"');
    expect(html).not.toContain("/finance/assets");
  });

  it("previews the selected attachment through the inventory download route", async () => {
    const html = await render({ att: "d1" });
    expect(html).toContain("/inventory/a1/documents/d1/download?inline=1");
  });

  it("renders no money for an it_staff user", async () => {
    const html = await render();
    expect(html).not.toMatch(/₱|PHP|\$\d|book value|purchase price|depreciat/i);
  });

  it("a viewer reads but sees no upload area", async () => {
    h.user = { id: "u9", role: "viewer" };
    const html = await render();
    expect(html).toContain("gcash.png");
    expect(html).not.toContain("Upload an attachment");
  });

  it("an asset the role cannot see is not found, and no attachments are read", async () => {
    h.asset = null;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.readFor).toEqual([]);
  });

  it("is titled Attachments with the asset tag", async () => {
    const m = await generateMetadata({ params: Promise.resolve({ id: "a1" }) });
    expect(m.title).toBe("Attachments · BR-LT-0001 · CRIS");
  });
});
