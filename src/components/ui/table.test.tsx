import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Table } from "./table";

const card = (props: { stickyHeader?: boolean; fitsCard?: boolean }) =>
  renderToStaticMarkup(<Table {...props}><tbody /></Table>).match(/^<div[^>]*>/)![0];

describe("Table stickyHeader", () => {
  it("stops clipping from 1280 px when the table fits its card, unmarked", () => {
    const div = card({ stickyHeader: true });
    expect(div).toContain("xl:overflow-visible");
    expect(div).not.toContain("xl:overflow-auto");
    expect(div).not.toContain("data-scrolls-in-card");
  });

  it("keeps scrolling inside a card it does not fit, marked data-scrolls-in-card", () => {
    const div = card({ stickyHeader: true, fitsCard: false });
    expect(div).toContain("xl:overflow-auto");
    expect(div).not.toContain("xl:overflow-visible");
    expect(div).toContain('data-scrolls-in-card=""');
  });

  it("leaves a plain table alone, whatever fitsCard says", () => {
    const div = card({ fitsCard: false });
    expect(div).not.toContain("list-sticky-head");
    expect(div).not.toContain("data-scrolls-in-card");
  });

  it("offsets the head by the window toolbar only from xl in a card that is not a scroll container", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    // every other case (below xl, or scrolling inside the card) measures the head's top from the card: 0
    expect(css).toMatch(/\.list-sticky-head thead \{\s*top: 0;/);
    expect(css).toMatch(
      /\.list-sticky-head:not\(\[data-scrolls-in-card\]\) thead \{\s*@variant xl \{\s*top: var\(--list-sticky-top, 0px\);/,
    );
    expect(css.match(/top: var\(--list-sticky-top/g)).toHaveLength(1);
  });
});
