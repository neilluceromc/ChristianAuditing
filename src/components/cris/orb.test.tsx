import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CrisOrb, CrisOrbDefs } from "./orb";

describe("CrisOrbDefs", () => {
  const html = renderToStaticMarkup(<CrisOrbDefs />);
  it("holds one hidden svg with the three symbols", () => {
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="cr-defs"');
    for (const c of ["gold", "sky", "silver"]) expect(html).toContain(`<symbol id="cris-${c}"`);
  });
  it("every id is unique and every url(#…) points at one", () => {
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const refs = new Set([...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]));
    for (const r of refs) expect(ids).toContain(r);
  });
  it("tags the eye and core for the moods", () => {
    expect(html.match(/class="cr-eye"/g)).toHaveLength(3);
    expect(html.match(/class="cr-core"/g)).toHaveLength(3);
  });
});

describe("CrisOrb", () => {
  it("is one labelled svg using the colour's symbol, inside the mood and motion wrapper", () => {
    const html = renderToStaticMarkup(<CrisOrb color="sky" mood="search" motion="calm" size={116} />);
    expect(html).toContain('class="cris-orb m-search cr-calm"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Cris"');
    expect(html).toContain('href="#cris-sky"');
    expect(html).toContain('width="116"');
  });
  it("decorative: hidden from assistive tech, with no role or label", () => {
    const html = renderToStaticMarkup(<CrisOrb color="silver" mood="idle" motion="lively" size={72} decorative label="Cris" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
    expect(html).not.toContain("aria-label");
    expect(html).toContain('href="#cris-silver"');
  });
  it("takes a custom label", () => {
    const html = renderToStaticMarkup(<CrisOrb color="gold" mood="idle" motion="still" size={40} label="Open Cris" />);
    expect(html).toContain('aria-label="Open Cris"');
  });
});
