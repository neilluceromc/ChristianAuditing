import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssetNoteThread } from "@/lib/asset-notes";

const h = vi.hoisted(() => ({
  user: { id: "u1", role: "it_staff" } as { id: string; role: string },
  asset: { id: "a1", cls: "IT" } as { id: string; cls: string } | null,
  threads: [] as AssetNoteThread[],
  notesFor: [] as string[],
}));

vi.mock("@/server/auth/guards", () => ({ requireUser: async () => h.user }));
vi.mock("@/server/modules/inventory/queries", () => ({
  getVisibleAsset: async () => h.asset,
}));
vi.mock("@/server/modules/assets/queries", () => ({
  assetNotes: async (id: string) => { h.notesFor.push(id); return h.threads; },
}));
vi.mock("@/server/page-titles", () => ({ assetTagFor: async () => "BR-LT-0001" }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/server/modules/assets/notes", () => ({ postNoteFormAction: vi.fn(), setNoteResolved: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

const { default: NotesPage, generateMetadata } = await import("./page");

const thread = (over: Partial<AssetNoteThread> = {}): AssetNoteThread => ({
  id: "n1", authorId: "u2", authorLabel: "Maria Reyes", authorRole: "finance_staff",
  body: "Please confirm the serial before we capitalise this.", createdAt: new Date("2026-10-20T08:00:00Z"),
  resolvedAt: null, resolvedByLabel: null, replies: [], ...over,
});

const render = async () => renderToStaticMarkup(await NotesPage({ params: Promise.resolve({ id: "a1" }) }));

describe("Inventory record › Notes (Phase 47 Task 8)", () => {
  beforeEach(() => {
    h.user = { id: "u1", role: "it_staff" };
    h.asset = { id: "a1", cls: "IT" };
    h.threads = [thread()];
    h.notesFor = [];
  });

  it("an IT user on an IT asset reads the shared notes and can post and resolve", async () => {
    const html = await render();
    expect(h.notesFor).toEqual(["a1"]);
    expect(html).toContain("Please confirm the serial before we capitalise this.");
    expect(html).toContain("Maria Reyes");
    expect(html).toContain("Add a note");
    expect(html).toContain("Mark resolved");
  });

  it("renders no money for an it_staff user", async () => {
    const html = await render();
    expect(html).not.toMatch(/₱|PHP|\$\d|book value|purchase price|depreciat/i);
  });

  it("a viewer reads but cannot post, reply or resolve", async () => {
    h.user = { id: "u9", role: "viewer" };
    const html = await render();
    expect(html).toContain("Please confirm the serial before we capitalise this.");
    expect(html).toContain("You can read these notes.");
    expect(html).not.toContain("Add a note");
    expect(html).not.toContain("Mark resolved");
    expect(html).not.toContain("<textarea");
  });

  it("Purchasing on an IT asset reads but cannot post", async () => {
    h.user = { id: "u5", role: "purchasing_staff" };
    const html = await render();
    expect(html).toContain("You can read these notes.");
    expect(html).not.toContain("<textarea");
  });

  it("an asset the role cannot see is not found, and no notes are read", async () => {
    h.asset = null;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.notesFor).toEqual([]);
  });

  it("is titled Notes with the asset tag", async () => {
    const m = await generateMetadata({ params: Promise.resolve({ id: "a1" }) });
    expect(m.title).toBe("Notes · BR-LT-0001 · CRIS");
  });
});
