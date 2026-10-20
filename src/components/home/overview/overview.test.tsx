import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KpiTile as Tile, Overview } from "@/lib/overview";
import { KpiTile } from "./kpi-tile";
import { LineChart } from "./line-chart";
import { MakeUpBar } from "./make-up-bar";
import { NeedsYou } from "./needs-you";
import { OverviewHome } from "./overview";
import { RankedBars } from "./ranked-bars";

const tile = (over: Partial<Tile> = {}): Tile => ({
  key: "it.spare", label: "Spare", value: 12, hint: "Ready to assign", upIs: "neutral",
  spark: [1, 2, 3, 4, 5, 6, 7, 12], delta: { kind: "count", value: 3 }, ...over,
});

/** Visible-ish text: tags stripped, entities decoded, whitespace squeezed. */
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

/** The text a sighted reader sees: sr-only spans removed first. */
const seen = (html: string) => text(html.replace(/<span class="sr-only">[^<]*<\/span>/g, ""));

const overview: Overview = {
  kpis: [
    tile({ href: "/inventory?status=SPARE" }),
    tile({ key: "it.deployed", label: "Deployed", href: "/inventory?status=DEPLOYED" }),
    tile({ key: "flags.on", label: "Flags on", value: 6, display: "6 of 9", spark: [], delta: { kind: "none" } }),
  ],
  needsYou: [
    { tone: "bad", icon: "alert", title: "BR-LT-0001 · ThinkPad", meta: "missing 3 d", action: "Open", href: "/inventory/a1" },
    { tone: "info", icon: "scan", title: "Check BR-LT-0002", meta: "registered", action: "Check", href: "/inventory/a2" },
  ],
  needsYouHref: "/inventory/work",
  trend: {
    title: "Asset movements per week", unit: "assets", period: "week",
    labels: ["29 Sep", "6 Oct", "13 Oct", "20 Oct"],
    series: [{ name: "Assigned", values: [1, 2, 3, 4] }, { name: "Returned", values: [0, 1, 1, 2] }],
  },
  makeUp: {
    title: "Fleet by status", unit: "assets", note: "Spare covers next week's hires.",
    rows: [
      { label: "Deployed", value: 30, tone: "chart-1", href: "/inventory?status=DEPLOYED" },
      { label: "Missing", value: 2, tone: "bad", href: "/inventory?status=MISSING" },
    ],
  },
  breakdown: { title: "Missing kit by client", sub: "top 7", rows: [{ label: "Acme", value: 4, href: "/employees?gaps=1" }, { label: "Internal teams", value: 2 }] },
};

describe("KpiTile", () => {
  it("a tile with an href is one link to that page", () => {
    const html = renderToStaticMarkup(<KpiTile tile={tile({ href: "/inventory?status=SPARE" })} />);
    expect(html).toMatch(/^<a [^>]*href="\/inventory\?status=SPARE"/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("a tile without an href is a plain card — no link, no button", () => {
    const html = renderToStaticMarkup(<KpiTile tile={tile()} />);
    expect(html).toMatch(/^<div /);
    expect(html).not.toMatch(/<a |<button/);
  });

  it("shows the label, the formatted value (₱ for money, `display` over both) and the hint", () => {
    expect(text(renderToStaticMarkup(<KpiTile tile={tile({ value: 1204 })} />))).toContain("1,204");
    expect(text(renderToStaticMarkup(<KpiTile tile={tile({ value: 1500, money: true })} />))).toContain("₱1,500");
    const flags = text(renderToStaticMarkup(<KpiTile tile={tile({ display: "6 of 9" })} />));
    expect(flags).toContain("6 of 9");
    expect(flags).toContain("Spare");
    expect(flags).toContain("Ready to assign");
  });

  it.each([
    [{ kind: "count", value: 8 } as const, "▲ 8 vs last week", "up"],
    [{ kind: "count", value: -2 } as const, "▼ 2 vs last week", "down"],
    [{ kind: "pct", value: 12 } as const, "▲ 12% vs last week", "up"],
    [{ kind: "week", value: 12, unit: "pct" } as const, "▲ 12% this week vs last week", "up"],
    [{ kind: "week", value: -3, unit: "count" } as const, "▼ 3 this week vs last week", "down"],
    [{ kind: "new" } as const, "▲ new this week", "up"],
    [{ kind: "count", value: 0 } as const, "— no change", null],
    [{ kind: "pct", value: -0 } as const, "— no change", null],
  ])("delta %j reads %s, with the arrow also said in words", (delta, words, dir) => {
    const html = renderToStaticMarkup(<KpiTile tile={tile({ delta })} />);
    expect(seen(html)).toContain(words);
    // the arrow glyph is hidden from assistive tech; the direction is a word
    expect(html).toMatch(/<span aria-hidden="true">[▲▼—]<\/span>/);
    if (dir) expect(html).toContain(`<span class="sr-only">${dir} </span>`);
  });

  it("the delta's tone follows deltaTone: up is bad on a bad-up tile, good on a good-up one, flat when neutral", () => {
    expect(renderToStaticMarkup(<KpiTile tile={tile({ upIs: "bad" })} />)).toContain('data-delta="bad"');
    expect(renderToStaticMarkup(<KpiTile tile={tile({ upIs: "good" })} />)).toContain('data-delta="good"');
    expect(renderToStaticMarkup(<KpiTile tile={tile({ upIs: "neutral" })} />)).toContain('data-delta="flat"');
  });

  it('says "collecting history" when the delta is none', () => {
    const html = renderToStaticMarkup(<KpiTile tile={tile({ delta: { kind: "none" } })} />);
    expect(text(html)).toContain("collecting history");
    expect(text(html)).not.toContain("vs last week");
  });

  it('says "collecting history", and draws no sparkline, with fewer than 2 collected points', () => {
    const html = renderToStaticMarkup(
      <KpiTile tile={tile({ spark: [null, null, null, null, null, null, null, 12], delta: { kind: "count", value: 1 } })} />,
    );
    expect(text(html)).toContain("collecting history");
    expect(html).not.toContain("data-sparkline");
  });

  it("draws the sparkline from 2 collected points, breaking the line at a missing week", () => {
    const html = renderToStaticMarkup(<KpiTile tile={tile({ spark: [1, 2, null, 4, 5, null, null, 9] })} />);
    expect(html).toContain("data-sparkline");
    expect(html.match(/stroke-chart-1/g)).toHaveLength(3); // three runs: [1,2] [4,5] [9]
    expect(text(html)).not.toContain("collecting history");
  });

  it("compacts money from ₱1M so a 6-across tile never overflows; the exact amount stays in the title and for screen readers", () => {
    const html = renderToStaticMarkup(<KpiTile tile={tile({ value: 12_345_678, money: true, display: "₱12,345,678" })} />);
    expect(html).toMatch(/title="₱12,345,678"[^>]*data-kpi-value=""><span aria-hidden="true">₱12.3M<\/span><span class="sr-only">₱12,345,678<\/span>/);
    expect(seen(html)).not.toContain("₱12,345,678");
    // under ₱1M the whole-peso amount fits and is shown as is, with no second copy
    const small = renderToStaticMarkup(<KpiTile tile={tile({ value: 999_999, money: true })} />);
    expect(seen(small)).toContain("₱999,999");
    expect(small).not.toContain('class="sr-only">₱');
  });

  it("the tile is a size container and the value scales between 18 and 26 px with it", () => {
    const html = renderToStaticMarkup(<KpiTile tile={tile()} />);
    expect(html).toMatch(/^<div class="@container /);
    expect(html).toContain("text-[length:clamp(18px,20cqi,26px)]");
  });

  it("a history-less tile (empty spark, e.g. Flags on) shows neither a sparkline nor collecting history", () => {
    const html = renderToStaticMarkup(<KpiTile tile={tile({ display: "6 of 9", spark: [], delta: { kind: "none" } })} />);
    expect(html).not.toContain("data-sparkline");
    expect(text(html)).not.toContain("collecting history");
    expect(html).not.toContain("data-delta");
    // keyed on the empty spark alone, whatever the delta says
    const counted = renderToStaticMarkup(<KpiTile tile={tile({ spark: [], delta: { kind: "count", value: 2 } })} />);
    expect(counted).not.toContain("data-delta");
  });
});

describe("NeedsYou", () => {
  it("lists the items with their action links and a See all link", () => {
    const html = renderToStaticMarkup(<NeedsYou items={overview.needsYou} href="/inventory/work" />);
    expect(html).toContain('href="/inventory/work"');
    expect(seen(html)).toContain("See all →");
    expect(html).toContain('href="/inventory/a1"');
    // the action names its item for a screen reader; the tone is a word too
    expect(text(html)).toContain("Open : BR-LT-0001 · ThinkPad");
    expect(text(html)).toContain("Urgent:");
    expect(seen(html)).toContain("1 urgent");
  });

  it("shows at most 6 items", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...overview.needsYou[1], title: `Item ${i}`, href: `/x/${i}` }));
    const html = renderToStaticMarkup(<NeedsYou items={many} href="/x" />);
    expect(html.match(/<li /g)).toHaveLength(6);
  });

  it("says so when nothing needs you", () => {
    expect(text(renderToStaticMarkup(<NeedsYou items={[]} href="/x" />))).toContain("Nothing needs you right now.");
  });
});

describe("LineChart", () => {
  const html = renderToStaticMarkup(<LineChart trend={overview.trend} />);

  it("is one named image with the latest values in its name", () => {
    expect(html).toMatch(/<svg [^>]*role="img"/);
    expect(html).toContain('aria-label="Asset movements per week, last 4 weeks. Latest week (20 Oct): Assigned 4, Returned 2."');
  });

  it("has a legend, direct end labels and a Show table toggle wired to a hidden table", () => {
    expect(html).toContain("data-legend");
    expect(text(html)).toContain("Assigned 4");
    expect(text(html)).toContain("Returned 2");
    const button = html.match(/<button [^>]*>Show table<\/button>/)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    const controls = button.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toMatch(new RegExp(`<div id="${controls}"[^>]*hidden=""`));
  });

  it("the table holds every point: a period column, one column per series, one row per label", () => {
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(table).toContain('<th scope="col"');
    expect(text(table)).toContain("Week ending Assigned Returned");
    expect(table.match(/<tr>/g)).toHaveLength(5);
    expect(text(table)).toContain("20 Oct 4 2");
  });

  it("formats a ₱ trend as money and says when the period is empty", () => {
    const money = renderToStaticMarkup(
      <LineChart trend={{ title: "Capitalized per month", unit: "₱", period: "month", labels: ["Sep 2026", "Oct 2026"], series: [{ name: "Capitalized", values: [0, 0] }] }} />,
    );
    expect(text(money)).toContain("nothing in this period");
    expect(text(money)).toContain("₱0");
  });
});

describe("MakeUpBar", () => {
  const html = renderToStaticMarkup(<MakeUpBar makeUp={overview.makeUp} />);

  it("links each segment and its legend word to the filter; the segment names itself with the unit", () => {
    expect(html).toContain('<span class="sr-only">Deployed: 30 assets</span>');
    // the legend link's name is the word alone (it-nav.spec.ts: name "Deployed" → /inventory?status=DEPLOYED)
    expect(html).toMatch(/<a [^>]*href="\/inventory\?status=DEPLOYED"[^>]*>Deployed<\/a>/);
    expect(html.match(/href="\/inventory\?status=DEPLOYED"/g)).toHaveLength(2);
  });

  it("one tab stop per row: the segment leaves the tab order but keeps its name", () => {
    expect(html).toMatch(/<a [^>]*tabindex="-1"[^>]*><span class="sr-only">Deployed: 30 assets<\/span><\/a>/);
    expect(html).toMatch(/<a class="truncate[^"]*" href="\/inventory\?status=DEPLOYED">Deployed<\/a>/);
  });

  it("a neutral row is a plain grey, not a status token", () => {
    const neutral = renderToStaticMarkup(<MakeUpBar makeUp={{ title: "T", rows: [{ label: "Drafts", value: 1, tone: "neutral" }] }} />);
    expect(neutral).toContain("bg-border-strong");
    expect(neutral).not.toContain("--st-");
  });

  it("puts 2 px between segments and gives status rows an icon beside their word", () => {
    expect(html).toMatch(/<div class="[^"]*\bgap-0\.5\b[^"]*" data-make-up-bar=""/);
    const missing = html.slice(html.lastIndexOf("<li ", html.indexOf(">Missing</a>")), html.indexOf(">Missing</a>"));
    expect(missing).toContain("<svg");
  });

  it("shows the values and the note", () => {
    expect(text(html)).toContain("Deployed 30");
    expect(text(html)).toContain("Spare covers next week's hires.");
  });
});

describe("RankedBars", () => {
  it("one row per entry in one colour, linked where an href exists", () => {
    const html = renderToStaticMarkup(<RankedBars ranked={overview.breakdown} />);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html.match(/bg-chart-1/g)).toHaveLength(2);
    expect(html).not.toMatch(/bg-chart-[23]/);
    expect(html).toContain('href="/employees?gaps=1"');
    expect(html).toMatch(/<span class="[^"]*">Internal teams<\/span>/);
  });
});

describe("OverviewHome", () => {
  it("renders the KPI row, Needs you, the trend, the make-up and the breakdown", () => {
    const html = renderToStaticMarkup(<OverviewHome overview={overview} focus={false} />);
    expect(html.match(/data-kpi=/g)).toHaveLength(3);
    expect(html).toContain("data-needs-you");
    expect(html).toContain("data-chart=");
    expect(html).toContain('data-row="b"');
  });

  it("focus mode keeps the KPI row and Needs you, and hides Row A's chart and Row B", () => {
    const html = renderToStaticMarkup(<OverviewHome overview={overview} focus />);
    expect(html.match(/data-kpi=/g)).toHaveLength(3);
    expect(html).toContain("data-needs-you");
    expect(html).not.toContain("data-chart");
    expect(html).not.toContain('data-row="b"');
    expect(html).not.toContain("data-make-up-bar");
    expect(html).not.toContain("data-ranked");
  });
});
