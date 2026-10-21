import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Banner } from "./banner";

/* Task 9: a banner that is part of the page on load is a status, not an alert that interrupts on every visit. */

describe("Banner", () => {
  it("is an alert for fault and attention tones, a status otherwise, by default", () => {
    expect(renderToStaticMarkup(<Banner tone="fault" title="x" />)).toMatch(/^<div role="alert"/);
    expect(renderToStaticMarkup(<Banner tone="attention" title="x" />)).toMatch(/^<div role="alert"/);
    expect(renderToStaticMarkup(<Banner tone="neutral" title="x" />)).toMatch(/^<div role="status"/);
  });

  it("takes live=\"status\" for an attention banner that is simply part of the page", () => {
    const html = renderToStaticMarkup(<Banner tone="attention" live="status" title="No SI number yet." />);
    expect(html).toMatch(/^<div role="status"/);
    expect(html).not.toContain('role="alert"');
  });
});
