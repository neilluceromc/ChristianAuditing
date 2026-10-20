import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ roles: [] as string[][] }));

vi.mock("@/server/auth/guards", () => ({
  requireRole: async (...roles: string[]) => {
    h.roles.push(roles);
    return { id: "u1", role: "finance_staff" };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

const { default: DisposalPage, metadata } = await import("./page");

describe("Finance › Disposal (Phase 47 spec §5.2: a placeholder)", () => {
  it("is guarded like the other Finance pages", async () => {
    await DisposalPage();
    expect(h.roles).toEqual([["admin", "finance_staff"]]);
  });

  it("keeps its h1 and shows the Cris at Work scene (Task 10), its heading an h2 under it", async () => {
    const html = renderToStaticMarkup(await DisposalPage());
    expect(html).toMatch(/<h1[^>]*>Disposal<\/h1>/);
    expect(html).toContain('class="caw"');
    expect(html).toMatch(/<h2[^>]*>Currently working on it<\/h2>/);
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("<h2"));
    expect(html).toContain("Recording disposals and their value will come here.");
    expect(html).not.toContain("Still in development");
  });

  it("is titled Disposal · CRIS", () => {
    expect(metadata.title).toBe("Disposal · CRIS");
  });
});
