import { Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";
import { headingBefore } from "@/lib/combo-groups";
import { ComboPopup, type ComboOption } from "./entity-combobox";

/*
 * The listbox is a presentational component so its markup can be rendered closed-over-open in a node test.
 * Keyboard and focus behaviour (Tab into the footer, Escape returning focus) is exercised by the Task 9 browser run.
 */

const plain = (n: string, extra: Partial<ComboOption> = {}): ComboOption => ({ value: n.toLowerCase(), label: n, ...extra });

const render = (props: Partial<Parameters<typeof ComboPopup>[0]> & { shown: ComboOption[] }) =>
  renderToStaticMarkup(
    <ComboPopup listId="L" recentCount={0} active={0} value={null} query="" close={() => {}} onActive={() => {}} onPick={() => {}} {...props} />,
  );

// The listbox JSX exactly as it was inline in EntityCombobox before the extraction — the reference for "unchanged".
function legacyList(shown: ComboOption[], recentCount: number, active: number, value: string | null, emptyText?: string, busy?: boolean) {
  let groupHeadingId: string | undefined;
  const rows = shown.map((option, i) => {
    const heading = headingBefore(shown, i, recentCount);
    const headingId = `L-h${i}`;
    if (heading !== null) groupHeadingId = heading === option.group ? headingId : undefined;
    return { option, heading, headingId, describedBy: option.group !== undefined ? groupHeadingId : undefined };
  });
  return renderToStaticMarkup(
    <ul
      id="L"
      role="listbox"
      aria-busy={busy || undefined}
      className="absolute z-40 mt-1 max-h-[220px] w-full overflow-y-auto rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop"
      style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
    >
      {shown.length === 0 && <li className="px-2 py-1.5 text-xs text-fg-muted">{emptyText ?? "No matches."}</li>}
      {rows.map(({ option, heading, headingId, describedBy }, i) => (
        <Fragment key={option.value || "none"}>
          {heading && (
            <li id={headingId} role="presentation" className="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-[0.06em] text-fg-faint">{heading}</li>
          )}
          <li
            id={`L-${option.value || "none"}`}
            role="option"
            aria-selected={option.value === value}
            aria-describedby={describedBy}
            className={cn("cursor-pointer rounded-[5px] px-2 py-1.5 text-xs", i === active ? "bg-accent-tint text-fg" : "text-fg-secondary")}
          >
            <span className="font-medium">{option.label}</span>
            {option.sub && <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{option.sub}</span>}
          </li>
        </Fragment>
      ))}
    </ul>,
  );
}

describe("ComboPopup: existing callers", () => {
  it("renders a plain list byte-for-byte as before", () => {
    const shown = [plain("Alpha", { sub: "A-1" }), plain("Beta"), plain("", { label: "No supplier" })];
    expect(render({ shown, active: 1, value: "beta" })).toBe(legacyList(shown, 0, 1, "beta"));
  });
  it("renders grouped and recent headings byte-for-byte as before", () => {
    const shown = [plain("Alpha", { group: "Same type" }), plain("Beta", { group: "Same type" }), plain("Gamma", { group: "Other spares" })];
    expect(render({ shown })).toBe(legacyList(shown, 0, 0, null));
    const withRecent = [plain("Beta"), plain("Alpha"), plain("Gamma")];
    expect(render({ shown: withRecent, recentCount: 1 })).toBe(legacyList(withRecent, 1, 0, null));
  });
  it("renders the empty and busy states byte-for-byte as before", () => {
    expect(render({ shown: [] })).toBe(legacyList([], 0, 0, null));
    expect(render({ shown: [], emptyText: "Type to search", busy: true })).toBe(legacyList([], 0, 0, null, "Type to search", true));
  });
  it("adds no footer wrapper without a footer", () => {
    expect(render({ shown: [plain("Alpha")] }).startsWith('<ul id="L" role="listbox"')).toBe(true);
  });
});

describe("ComboPopup: groups", () => {
  const shown = [plain("Router", { group: "IT gear" }), plain("Chair", { group: "Office" })];
  it("shows each group heading with its hint on the right", () => {
    const html = render({ shown, groupHint: { "IT gear": "→ IT checks", Office: "→ ready to register" } });
    expect(html).toContain("IT gear");
    expect(html).toContain("→ IT checks");
    expect(html).toContain("→ ready to register");
    expect(html).toMatch(/<li id="L-h0" role="presentation"[^>]*>.*IT gear.*→ IT checks/);
  });
  it("leaves a heading without a hint as the plain heading", () => {
    const html = render({ shown, groupHint: { "IT gear": "→ IT checks" } });
    expect(html).toContain('text-fg-faint">Office</li>');
  });
  it("does not hint the Recent block", () => {
    const html = render({ shown: [plain("Router", { group: "IT gear" }), plain("Chair", { group: "Office" })], recentCount: 1, groupHint: { Recent: "x" } });
    expect(html).not.toContain(">x<");
  });
});

describe("ComboPopup: icon and tag", () => {
  it("renders the leading icon before the label and the tag after it", () => {
    const html = render({ shown: [plain("Network cable", { icon: <b data-i="1">NC</b>, tag: "New" })] });
    expect(html).toContain('<b data-i="1">NC</b>');
    expect(html).toContain(">New<");
    expect(html.indexOf("NC")).toBeLessThan(html.indexOf("Network cable"));
    expect(html.indexOf("Network cable")).toBeLessThan(html.indexOf(">New<"));
  });
  it("leaves a row without icon or tag as the plain row", () => {
    const html = render({ shown: [plain("Alpha")] });
    expect(html).not.toContain("flex items-center");
  });
});

describe("ComboPopup: footer", () => {
  it("hands the footer the typed query and a close function, under the list", () => {
    const seen: { query?: string; close?: unknown } = {};
    const close = () => {};
    const html = render({
      shown: [],
      query: "Patch lead",
      close,
      footer: (query, c) => { seen.query = query; seen.close = c; return <button type="button">Create “{query}” as… IT gear</button>; },
    });
    expect(seen.query).toBe("Patch lead");
    expect(seen.close).toBe(close);
    expect(html).toContain("IT gear");
    expect(html.indexOf('role="listbox"')).toBeLessThan(html.indexOf("<button"));
  });
  it("keeps the footer outside the listbox and the list out of the Tab order", () => {
    const html = render({ shown: [plain("Alpha")], footer: () => <button type="button">Go</button> });
    expect(html).toMatch(/<ul[^>]*role="listbox"[^>]*tabindex="-1"/);
    expect(html.indexOf("</ul>")).toBeLessThan(html.indexOf("<button"));
  });
  it("renders no footer area when the footer returns nothing", () => {
    expect(render({ shown: [plain("Alpha")], footer: () => null })).toBe(render({ shown: [plain("Alpha")] }));
  });
});
