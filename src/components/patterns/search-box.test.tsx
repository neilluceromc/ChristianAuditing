import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchBox } from "./search-box";

/*
 * Spec §7.2: the house search box. Its timing (300 ms after the last keystroke or paste, Enter at once) and its
 * echo rule are unit-tested in src/lib/live-search.test.ts; this pins the markup the callers and e2e rely on, and that
 * the field is no longer remounted on every search (which would drop focus and the caret while typing).
 */

const box = (value: string) =>
  renderToStaticMarkup(
    <SearchBox value={value} ariaLabel="Search assets" placeholder="Search tag · Enter" onSubmit={() => {}} />,
  );

describe("SearchBox", () => {
  it("is the page's search field, seeded from the URL's q", () => {
    const html = box("Carlo");
    expect(html).toContain('type="search"');
    expect(html).toContain("data-page-search");
    expect(html).toContain('aria-label="Search assets"');
    expect(html).toContain('value="Carlo"');
  });
  it("offers Clear search only while there is a search", () => {
    expect(box("Carlo")).toContain('aria-label="Clear search"');
    expect(box("")).not.toContain('aria-label="Clear search"');
  });
  it("keeps one input instance across searches: controlled, not keyed on q (focus and caret stay)", () => {
    const source = readFileSync(new URL("./search-box.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/key=\{value\}/);
    expect(source).not.toMatch(/defaultValue=/);
    expect(source).toMatch(/value=\{text\}/);
  });
  it("hands its callers the debounced search and whether Enter sent it", () => {
    const source = readFileSync(new URL("./search-box.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/debounceMs = SEARCH_DEBOUNCE_MS/);
    expect(source).toMatch(/onSubmit: \(q: string, how: SearchSubmit\) => void/);
  });
});
