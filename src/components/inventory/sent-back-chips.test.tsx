import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SentBackChips } from "./sent-back-chips";

/* 2026-10-23: the quiet "Sent back · N" chip that replaced Inventory's red banner. */

const IT = { team: "IT" as const, count: 2, href: "/inventory?reg=needs-correction&to=IT" };
const PUR = { team: "PURCHASING" as const, count: 5, href: "/inventory?reg=needs-correction&to=PURCHASING" };
const render = (p: Partial<Parameters<typeof SentBackChips>[0]> = {}) =>
  renderToStaticMarkup(<SentBackChips chips={[IT]} active={null} clearHref="/inventory" showTeam={false} {...p} />);

describe("SentBackChips", () => {
  it("a link to the team's Sent back view, the sidebar's own, reading \"Sent back · N\"", () => {
    const html = render();
    expect(html).toContain('href="/inventory?reg=needs-correction&amp;to=IT"');
    expect(html).toContain("Sent back · 2");
    expect(html).not.toContain("aria-current");
  });

  it("is quiet: the chip row's neutral style and the attention dot, nothing red", () => {
    const html = render();
    expect(html).toContain("border-border-strong bg-surface text-fg-secondary");
    expect(html).toContain("var(--st-attention-dot)");
    expect(html).not.toMatch(/fault/);
    expect(html).not.toContain('role="status"');
  });

  it("selected while its view is open, and clicking it again clears the view", () => {
    const html = render({ active: "IT", clearHref: "/inventory" });
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/inventory"');
    expect(html).not.toContain("to=IT");
  });

  it("nothing at all when no team has anything sent back", () => {
    expect(render({ chips: [] })).toBe("");
  });

  it("an admin's chips say whose they are; a team's own does not", () => {
    const admin = render({ chips: [IT, PUR], showTeam: true, active: "PURCHASING" });
    expect(admin).toMatch(/Sent back · 2<\/span><span[^>]*>· IT<\/span>/);
    expect(admin).toMatch(/Sent back · 5<\/span><span[^>]*>· Purchasing<\/span>/);
    // only the open view's chip is selected
    expect(admin.match(/aria-current="page"/g)).toHaveLength(1);
    expect(admin).toContain('href="/inventory?reg=needs-correction&amp;to=IT"');
    expect(render()).not.toContain("· IT");
  });
});
